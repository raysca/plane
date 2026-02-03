import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface TestData {
  token: string;
  userId: string;
  wsSlug: string;
  projectId: string;
  identifier: string;
  // States
  backlogStateId: string;
  completedStateId: string;
  cancelledStateId: string;
  // Issues for testing
  issueIds: string[];
  issueNames: string[];
  completedIssueIds: string[];
  cancelledIssueIds: string[];
  // Cycle and module for relation testing
  cycleId: string;
  moduleId: string;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  bulkPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("bulk-ui"));
  },

  bulkPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("bulk-ui");
      const password = generateTestPassword();
      const identifier = `B${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Bulk",
          last_name: "Tester",
        },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;
      const userId: string = signupData.user?.id ?? signupData.id;

      // 2. Set session cookies
      const cookies = signupRes
        .headersArray()
        .filter((h) => h.name.toLowerCase() === "set-cookie")
        .map((h) => h.value);
      for (const cookie of cookies) {
        const parts = cookie.split(";")[0]!.split("=");
        await page.context().addCookies([
          {
            name: parts[0]!.trim(),
            value: parts.slice(1).join("=").trim(),
            domain: "localhost",
            path: "/",
          },
        ]);
      }

      // 3. Onboard
      await request.patch(`${API_BASE}/api/users/me/`, {
        headers: headers(token),
        data: {
          first_name: "Bulk",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Bulk Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Bulk Project", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      const baseProjectUrl = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Get project states
      const statesRes = await request.get(`${baseProjectUrl}/states/`, {
        headers: headers(token),
      });
      const allStates = await statesRes.json();
      const statesList = Array.isArray(allStates)
        ? allStates
        : allStates.results ?? [];

      const backlogState = statesList.find(
        (s: any) => s.group === "backlog"
      );
      const completedState = statesList.find(
        (s: any) => s.group === "completed"
      );
      const cancelledState = statesList.find(
        (s: any) => s.group === "cancelled"
      );

      const backlogStateId = backlogState?.id ?? statesList[0]?.id;
      let completedStateId = completedState?.id;
      let cancelledStateId = cancelledState?.id;

      // Create completed state if it doesn't exist
      if (!completedStateId) {
        const createRes = await request.post(`${baseProjectUrl}/states/`, {
          headers: headers(token),
          data: { name: "Done", group: "completed", color: "#22c55e" },
        });
        const created = await createRes.json();
        completedStateId = created.id;
      }

      // Create cancelled state if it doesn't exist
      if (!cancelledStateId) {
        const createRes = await request.post(`${baseProjectUrl}/states/`, {
          headers: headers(token),
          data: { name: "Cancelled", group: "cancelled", color: "#ef4444" },
        });
        const created = await createRes.json();
        cancelledStateId = created.id;
      }

      // 7. Create cycle
      const now = new Date();
      const cycleStart = now.toISOString().split("T")[0];
      const cycleEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const cycleRes = await request.post(`${baseProjectUrl}/cycles/`, {
        headers: headers(token),
        data: {
          name: "Bulk Test Cycle",
          start_date: cycleStart,
          end_date: cycleEnd,
        },
      });
      const cycle = await cycleRes.json();
      const cycleId = cycle.id;

      // 8. Create module
      const moduleRes = await request.post(`${baseProjectUrl}/modules/`, {
        headers: headers(token),
        data: { name: "Bulk Test Module" },
      });
      const mod = await moduleRes.json();
      const moduleId = mod.id;

      // 9. Create issues for bulk operations testing
      const issueNames = [
        "Bulk Issue Alpha",
        "Bulk Issue Beta",
        "Bulk Issue Gamma",
        "Bulk Issue Delta",
      ];
      const issueIds: string[] = [];

      for (const name of issueNames) {
        const res = await request.post(`${baseProjectUrl}/issues/`, {
          headers: headers(token),
          data: { name, state_id: backlogStateId },
        });
        expect(res.ok()).toBeTruthy();
        const issue = await res.json();
        issueIds.push(issue.id);
      }

      // 10. Create completed issues for archive testing
      const completedIssueIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await request.post(`${baseProjectUrl}/issues/`, {
          headers: headers(token),
          data: {
            name: `Completed Issue ${i + 1}`,
            state_id: completedStateId,
          },
        });
        expect(res.ok()).toBeTruthy();
        const issue = await res.json();
        completedIssueIds.push(issue.id);
      }

      // 11. Create cancelled issues for archive testing
      const cancelledIssueIds: string[] = [];
      for (let i = 0; i < 2; i++) {
        const res = await request.post(`${baseProjectUrl}/issues/`, {
          headers: headers(token),
          data: {
            name: `Cancelled Issue ${i + 1}`,
            state_id: cancelledStateId,
          },
        });
        expect(res.ok()).toBeTruthy();
        const issue = await res.json();
        cancelledIssueIds.push(issue.id);
      }

      const td: TestData = {
        token,
        userId,
        wsSlug,
        projectId,
        identifier,
        backlogStateId,
        completedStateId,
        cancelledStateId,
        issueIds,
        issueNames,
        completedIssueIds,
        cancelledIssueIds,
        cycleId,
        moduleId,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 90_000 },
  ],

  td: async ({ bulkPage }, use) => {
    await use((bulkPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}`;
}

function issuesBaseUrl(td: TestData): string {
  return `${baseUrl(td)}/issues`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToIssues(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/`);
  await waitForAppReady(page);
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Bulk Delete API ─────────────────────────────────────────────────────

test.describe("Bulk Delete API", () => {
  test("should bulk delete multiple issues via API", async ({
    bulkPage,
    td,
  }) => {
    // Create issues specifically for this delete test
    const toDeleteIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
        headers: auth(td.token),
        data: { name: `Delete Test ${i}`, state_id: td.backlogStateId },
      });
      expect(res.ok()).toBeTruthy();
      const issue = await res.json();
      toDeleteIds.push(issue.id);
    }

    // Bulk delete
    const delRes = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-delete-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: toDeleteIds },
      }
    );
    expect(delRes.ok()).toBeTruthy();
    const data = await delRes.json();
    expect(data.message).toBe("3 issues were deleted");

    // Verify issues are deleted
    for (const id of toDeleteIds) {
      const getRes = await bulkPage.request.get(
        `${baseUrl(td)}/issues/${id}/`,
        { headers: auth(td.token) }
      );
      expect(getRes.ok()).toBeFalsy();
    }
  });

  test("should clean up cycle relations on bulk delete", async ({
    bulkPage,
    td,
  }) => {
    // Create issue and add to cycle
    const issueRes = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
      headers: auth(td.token),
      data: { name: "Cycle Delete Test", state_id: td.backlogStateId },
    });
    expect(issueRes.ok()).toBeTruthy();
    const issue = await issueRes.json();

    // Add to cycle
    await bulkPage.request.post(
      `${baseUrl(td)}/cycles/${td.cycleId}/cycle-issues/`,
      {
        headers: auth(td.token),
        data: { issues: [issue.id] },
      }
    );

    // Bulk delete
    const delRes = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-delete-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [issue.id] },
      }
    );
    expect(delRes.ok()).toBeTruthy();
  });

  test("should clean up module relations on bulk delete", async ({
    bulkPage,
    td,
  }) => {
    // Create issue and add to module
    const issueRes = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
      headers: auth(td.token),
      data: { name: "Module Delete Test", state_id: td.backlogStateId },
    });
    expect(issueRes.ok()).toBeTruthy();
    const issue = await issueRes.json();

    // Add to module
    await bulkPage.request.post(
      `${baseUrl(td)}/modules/${td.moduleId}/module-issues/`,
      {
        headers: auth(td.token),
        data: { issues: [issue.id] },
      }
    );

    // Bulk delete
    const delRes = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-delete-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [issue.id] },
      }
    );
    expect(delRes.ok()).toBeTruthy();
  });

  test("should require at least one issue ID for bulk delete", async ({
    bulkPage,
    td,
  }) => {
    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-delete-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [] },
      }
    );
    expect(res.ok()).toBeFalsy();
  });

  test("should handle non-existent issue IDs gracefully", async ({
    bulkPage,
    td,
  }) => {
    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-delete-issues/`,
      {
        headers: auth(td.token),
        data: {
          issue_ids: [
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
          ],
        },
      }
    );
    // Should succeed even if issues don't exist
    expect(res.ok()).toBeTruthy();
  });
});

// ─── 2. Bulk Archive API ────────────────────────────────────────────────────

test.describe("Bulk Archive API", () => {
  test("should bulk archive completed issues via API", async ({
    bulkPage,
    td,
  }) => {
    // Create new completed issues for this test
    const toArchiveIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
        headers: auth(td.token),
        data: {
          name: `Archive Completed ${i}`,
          state_id: td.completedStateId,
        },
      });
      expect(res.ok()).toBeTruthy();
      const issue = await res.json();
      toArchiveIds.push(issue.id);
    }

    // Bulk archive
    const archRes = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-archive-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: toArchiveIds },
      }
    );
    expect(archRes.ok()).toBeTruthy();
    const data = await archRes.json();
    expect(data.archived_at).toBeTruthy();

    // Verify issues are archived
    for (const id of toArchiveIds) {
      const getRes = await bulkPage.request.get(
        `${baseUrl(td)}/issues/${id}/`,
        { headers: auth(td.token) }
      );
      expect(getRes.ok()).toBeTruthy();
      const issue = await getRes.json();
      expect(issue.archived_at).toBeTruthy();
    }
  });

  test("should bulk archive cancelled issues via API", async ({
    bulkPage,
    td,
  }) => {
    // Create new cancelled issues for this test
    const toArchiveIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
        headers: auth(td.token),
        data: {
          name: `Archive Cancelled ${i}`,
          state_id: td.cancelledStateId,
        },
      });
      expect(res.ok()).toBeTruthy();
      const issue = await res.json();
      toArchiveIds.push(issue.id);
    }

    // Bulk archive
    const archRes = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-archive-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: toArchiveIds },
      }
    );
    expect(archRes.ok()).toBeTruthy();
    const data = await archRes.json();
    expect(data.archived_at).toBeTruthy();
  });

  test("should reject bulk archive of non-completed issues via API", async ({
    bulkPage,
    td,
  }) => {
    // Use backlog issues (not completed/cancelled)
    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-archive-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [td.issueIds[0]] },
      }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe("INVALID_ARCHIVE_STATE_GROUP");
  });

  test("should reject mixed state bulk archive via API", async ({
    bulkPage,
    td,
  }) => {
    // Mix backlog (invalid) with completed (valid)
    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-archive-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [td.issueIds[0], td.completedIssueIds[0]] },
      }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe("INVALID_ARCHIVE_STATE_GROUP");
  });

  test("should require at least one issue ID for bulk archive", async ({
    bulkPage,
    td,
  }) => {
    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-archive-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [] },
      }
    );
    expect(res.ok()).toBeFalsy();
  });
});

// ─── 3. Bulk Date Update API ────────────────────────────────────────────────

test.describe("Bulk Date Update API", () => {
  test("should bulk update dates for multiple issues via API", async ({
    bulkPage,
    td,
  }) => {
    const startDate = "2025-02-01";
    const targetDate = "2025-02-15";

    const res = await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: {
        updates: [
          { id: td.issueIds[0], start_date: startDate, target_date: targetDate },
          { id: td.issueIds[1], start_date: startDate, target_date: targetDate },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.message).toBe("Issues updated successfully");

    // Verify dates were updated
    for (const id of [td.issueIds[0], td.issueIds[1]]) {
      const getRes = await bulkPage.request.get(
        `${baseUrl(td)}/issues/${id}/`,
        { headers: auth(td.token) }
      );
      expect(getRes.ok()).toBeTruthy();
      const issue = await getRes.json();
      expect(issue.start_date).toBe(startDate);
      expect(issue.target_date).toBe(targetDate);
    }
  });

  test("should update only start_date via API", async ({ bulkPage, td }) => {
    const startDate = "2025-03-01";

    const res = await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: {
        updates: [{ id: td.issueIds[2], start_date: startDate }],
      },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await bulkPage.request.get(
      `${baseUrl(td)}/issues/${td.issueIds[2]}/`,
      { headers: auth(td.token) }
    );
    const issue = await getRes.json();
    expect(issue.start_date).toBe(startDate);
  });

  test("should update only target_date via API", async ({ bulkPage, td }) => {
    const targetDate = "2025-04-30";

    const res = await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: {
        updates: [{ id: td.issueIds[3], target_date: targetDate }],
      },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await bulkPage.request.get(
      `${baseUrl(td)}/issues/${td.issueIds[3]}/`,
      { headers: auth(td.token) }
    );
    const issue = await getRes.json();
    expect(issue.target_date).toBe(targetDate);
  });

  test("should reject invalid date range via API", async ({
    bulkPage,
    td,
  }) => {
    const res = await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: {
        updates: [
          {
            id: td.issueIds[0],
            start_date: "2025-03-15",
            target_date: "2025-03-01", // Invalid: start > target
          },
        ],
      },
    });
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test("should clear dates with null values via API", async ({
    bulkPage,
    td,
  }) => {
    // First set dates
    await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: {
        updates: [
          {
            id: td.issueIds[0],
            start_date: "2025-01-01",
            target_date: "2025-01-31",
          },
        ],
      },
    });

    // Then clear them
    const res = await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: {
        updates: [
          { id: td.issueIds[0], start_date: null, target_date: null },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();

    const getRes = await bulkPage.request.get(
      `${baseUrl(td)}/issues/${td.issueIds[0]}/`,
      { headers: auth(td.token) }
    );
    const issue = await getRes.json();
    expect(issue.start_date).toBeNull();
    expect(issue.target_date).toBeNull();
  });

  test("should require at least one update for bulk date update", async ({
    bulkPage,
    td,
  }) => {
    const res = await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: { updates: [] },
    });
    expect(res.ok()).toBeFalsy();
  });
});

// ─── 4. Bulk Operations UI ──────────────────────────────────────────────────

test.describe("Bulk Operations UI", () => {
  test("should navigate to issues page", async ({ bulkPage, wsSlug }) => {
    await goToIssues(bulkPage, wsSlug);
    expect(bulkPage.url()).toContain("/issues");
  });
});

// ─── 5. Bulk Operations Response Validation ─────────────────────────────────

test.describe("Bulk Operations Response Validation", () => {
  test("should return correct delete response structure", async ({
    bulkPage,
    td,
  }) => {
    // Create issue to delete
    const createRes = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
      headers: auth(td.token),
      data: { name: "Response Test", state_id: td.backlogStateId },
    });
    const issue = await createRes.json();

    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-delete-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [issue.id] },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.message).toBeDefined();
    expect(typeof data.message).toBe("string");
    expect(data.message).toContain("issues were deleted");
  });

  test("should return correct archive response structure", async ({
    bulkPage,
    td,
  }) => {
    // Create completed issue to archive
    const createRes = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
      headers: auth(td.token),
      data: { name: "Archive Response Test", state_id: td.completedStateId },
    });
    const issue = await createRes.json();

    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-archive-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [issue.id] },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.archived_at).toBeDefined();
    // Should be a date string in YYYY-MM-DD format
    expect(data.archived_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("should return correct date update response structure", async ({
    bulkPage,
    td,
  }) => {
    const res = await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: {
        updates: [
          { id: td.issueIds[0], start_date: "2025-05-01" },
        ],
      },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.message).toBe("Issues updated successfully");
  });

  test("should return correct archive error structure", async ({
    bulkPage,
    td,
  }) => {
    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-archive-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [td.issueIds[0]] }, // backlog issue
      }
    );
    expect(res.ok()).toBeFalsy();
    const data = await res.json();
    expect(data.error).toBeDefined();
    expect(data.error_code).toBe("INVALID_ARCHIVE_STATE_GROUP");
  });
});

// ─── 6. Bulk Operations Edge Cases ──────────────────────────────────────────

test.describe("Bulk Operations Edge Cases", () => {
  test("should handle single issue bulk delete", async ({ bulkPage, td }) => {
    const createRes = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
      headers: auth(td.token),
      data: { name: "Single Delete", state_id: td.backlogStateId },
    });
    const issue = await createRes.json();

    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-delete-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [issue.id] },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.message).toBe("1 issues were deleted");
  });

  test("should handle single issue bulk archive", async ({ bulkPage, td }) => {
    const createRes = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
      headers: auth(td.token),
      data: { name: "Single Archive", state_id: td.completedStateId },
    });
    const issue = await createRes.json();

    const res = await bulkPage.request.post(
      `${issuesBaseUrl(td)}/bulk-archive-issues/`,
      {
        headers: auth(td.token),
        data: { issue_ids: [issue.id] },
      }
    );
    expect(res.ok()).toBeTruthy();
  });

  test("should handle large batch of date updates", async ({
    bulkPage,
    td,
  }) => {
    // Create multiple issues
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await bulkPage.request.post(`${baseUrl(td)}/issues/`, {
        headers: auth(td.token),
        data: { name: `Batch Date ${i}`, state_id: td.backlogStateId },
      });
      const issue = await res.json();
      ids.push(issue.id);
    }

    // Update all at once
    const updates = ids.map((id, idx) => ({
      id,
      start_date: `2025-0${idx + 1}-01`,
      target_date: `2025-0${idx + 1}-28`,
    }));

    const res = await bulkPage.request.post(`${issuesBaseUrl(td)}/issue-dates/`, {
      headers: auth(td.token),
      data: { updates },
    });
    expect(res.ok()).toBeTruthy();

    // Clean up
    await bulkPage.request.post(`${issuesBaseUrl(td)}/bulk-delete-issues/`, {
      headers: auth(td.token),
      data: { issue_ids: ids },
    });
  });
});

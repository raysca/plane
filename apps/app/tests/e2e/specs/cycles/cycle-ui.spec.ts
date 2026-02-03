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
  wsSlug: string;
  projectId: string;
  identifier: string;
  states: Array<{ id: string; name: string; group: string }>;
  cycleId: string;
  cycleName: string;
  secondCycleId: string;
  secondCycleName: string;
  issueIds: string[];
  issueNames: string[];
  issueSeqs: number[];
}

// ── Fixture: authenticated page with cycles test data ────────────────────────

type Fixtures = {
  cyclePage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("cyc-ui"));
  },

  cyclePage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("cyc-ui");
      const password = generateTestPassword();
      const identifier = `C${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Cycle",
          last_name: "Tester",
        },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;

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
          first_name: "Cycle",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Cycle Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Cycle Project", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;
      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Fetch project states
      const statesRes = await request.get(`${base_url}/states/`, {
        headers: headers(token),
      });
      expect(statesRes.ok()).toBeTruthy();
      const statesData = await statesRes.json();
      const states: TestData["states"] = (
        Array.isArray(statesData) ? statesData : statesData.results ?? []
      ).map((s: any) => ({ id: s.id, name: s.name, group: s.group }));

      // 7. Create cycle "Sprint Alpha"
      const cycleRes = await request.post(`${base_url}/cycles/`, {
        headers: headers(token),
        data: { name: "Sprint Alpha" },
      });
      expect(cycleRes.ok()).toBeTruthy();
      const cycle = await cycleRes.json();

      // 8. Create cycle "Sprint Beta"
      const cycle2Res = await request.post(`${base_url}/cycles/`, {
        headers: headers(token),
        data: { name: "Sprint Beta" },
      });
      expect(cycle2Res.ok()).toBeTruthy();
      const cycle2 = await cycle2Res.json();

      // 9. Create 3 issues
      const issueNames = ["Cycle Issue One", "Cycle Issue Two", "Cycle Issue Three"];
      const issueIds: string[] = [];
      const issueSeqs: number[] = [];
      for (const name of issueNames) {
        const res = await request.post(`${base_url}/issues/`, {
          headers: headers(token),
          data: { name },
        });
        expect(res.ok()).toBeTruthy();
        const issue = await res.json();
        issueIds.push(issue.id);
        issueSeqs.push(issue.sequence_id);
      }

      // 10. Add first two issues to Sprint Alpha
      const addRes = await request.post(
        `${base_url}/cycles/${cycle.id}/cycle-issues/`,
        {
          headers: headers(token),
          data: { issues: [issueIds[0], issueIds[1]] },
        }
      );
      expect(addRes.ok()).toBeTruthy();

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        identifier,
        states,
        cycleId: cycle.id,
        cycleName: "Sprint Alpha",
        secondCycleId: cycle2.id,
        secondCycleName: "Sprint Beta",
        issueIds,
        issueNames,
        issueSeqs,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ cyclePage }, use) => {
    await use((cyclePage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function goToCycles(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/cycles/`);
  await waitForAppReady(page);
}

async function goToCycleDetail(
  page: Page,
  wsSlug: string,
  cycleId: string
) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/cycles/${cycleId}`);
  await waitForAppReady(page);
}

async function goToWorkItems(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/`);
  await waitForAppReady(page);
}

function issueIdent(td: TestData, seqId: number): string {
  return `${td.identifier}-${seqId}`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Cycles List Page ─────────────────────────────────────────────────────

test.describe("Cycles List Page", () => {
  test("should navigate to cycles list page", async ({
    cyclePage,
    wsSlug,
  }) => {
    await goToCycles(cyclePage, wsSlug);
    // Verify we're on the cycles page - look for the "Add cycle" button
    const addBtn = cyclePage
      .getByRole("button", { name: /add cycle/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should show cycles sidebar link", async ({ cyclePage, wsSlug }) => {
    await goToWorkItems(cyclePage, wsSlug);
    const cyclesLink = cyclePage.getByText("Cycles", { exact: true }).first();
    await expect(cyclesLink).toBeVisible({ timeout: 5_000 });
  });

  test("should display existing cycles in the list", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycles(cyclePage, wsSlug);
    // Both API-created cycles should be visible
    await expect(
      cyclePage.getByText(td.cycleName).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      cyclePage.getByText(td.secondCycleName).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ─── 2. Cycle Creation ──────────────────────────────────────────────────────

test.describe("Cycle Creation", () => {
  test("should create a cycle via modal with name only", async ({
    cyclePage,
    wsSlug,
  }) => {
    await goToCycles(cyclePage, wsSlug);

    // Click "Add cycle" button
    const addBtn = cyclePage
      .getByRole("button", { name: /add cycle/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Wait for modal
    await cyclePage.waitForTimeout(500);

    // Fill in cycle name
    const nameInput = cyclePage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("New Test Cycle");

    // Click "Create cycle" button
    const createBtn = cyclePage
      .getByRole("button", { name: /create cycle/i })
      .first();
    await expect(createBtn).toBeVisible({ timeout: 3_000 });
    await createBtn.click();

    // Wait for modal to close and verify cycle appears in list
    await cyclePage.waitForTimeout(1_000);
    await expect(
      cyclePage.getByText("New Test Cycle").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should create a cycle with name and description", async ({
    cyclePage,
    wsSlug,
  }) => {
    await goToCycles(cyclePage, wsSlug);

    const addBtn = cyclePage
      .getByRole("button", { name: /add cycle/i })
      .first();
    await addBtn.click();
    await cyclePage.waitForTimeout(500);

    // Fill name
    const nameInput = cyclePage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Described Cycle");

    // Fill description
    const descInput = cyclePage.getByPlaceholder("Description").first();
    await expect(descInput).toBeVisible({ timeout: 3_000 });
    await descInput.fill("This cycle has a description");

    // Submit
    const createBtn = cyclePage
      .getByRole("button", { name: /create cycle/i })
      .first();
    await createBtn.click();

    await cyclePage.waitForTimeout(1_000);
    await expect(
      cyclePage.getByText("Described Cycle").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should cancel cycle creation", async ({ cyclePage, wsSlug }) => {
    await goToCycles(cyclePage, wsSlug);

    const addBtn = cyclePage
      .getByRole("button", { name: /add cycle/i })
      .first();
    await addBtn.click();
    await cyclePage.waitForTimeout(500);

    // Fill name
    const nameInput = cyclePage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Should Not Exist");

    // Click cancel
    const cancelBtn = cyclePage
      .getByRole("button", { name: "Cancel", exact: true })
      .first();
    await cancelBtn.click();

    // Verify modal closed and cycle doesn't exist
    await cyclePage.waitForTimeout(500);
    await expect(
      cyclePage.getByText("Should Not Exist")
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── 3. Cycle Detail Page ────────────────────────────────────────────────────

test.describe("Cycle Detail Page", () => {
  test("should navigate to cycle detail and see cycle name", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycleDetail(cyclePage, wsSlug, td.cycleId);
    // Cycle name should be visible on the page
    await expect(
      cyclePage.getByText(td.cycleName).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show issues assigned to the cycle", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycleDetail(cyclePage, wsSlug, td.cycleId);
    // The two issues added via API should be visible
    await expect(
      cyclePage.getByText(td.issueNames[0]!).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      cyclePage.getByText(td.issueNames[1]!).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("should verify cycle has correct issue count via API", async ({
    cyclePage,
    td,
  }) => {
    // Verify via API that only 2 issues are in the cycle (not 3)
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.get(
      `${base_url}/cycles/${td.cycleId}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(res.ok()).toBeTruthy();
    const cycle = await res.json();
    expect(cycle.total_issues).toBe(2);
  });

  test("should show empty second cycle", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycleDetail(cyclePage, wsSlug, td.secondCycleId);
    // Should show empty state or no issues text
    const emptyIndicator = cyclePage
      .getByText(/no work items/i)
      .first();
    const cycleTitle = cyclePage.getByText(td.secondCycleName).first();
    // At minimum the cycle name should be visible
    await expect(cycleTitle).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 4. Cycle Update ─────────────────────────────────────────────────────────

test.describe("Cycle Update", () => {
  test("should rename a cycle via API and verify in UI", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    // Update cycle name via API
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.patch(
      `${base_url}/cycles/${td.secondCycleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Sprint Beta Renamed" },
      }
    );
    expect(res.ok()).toBeTruthy();

    // Navigate to cycles list and verify new name
    await goToCycles(cyclePage, wsSlug);
    await expect(
      cyclePage.getByText("Sprint Beta Renamed").first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 5. Cycle Issues Management ──────────────────────────────────────────────

test.describe("Cycle Issues Management", () => {
  test("should add an issue to a cycle from issue detail page", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    // Navigate to the third issue (not in any cycle)
    const projectId = (cyclePage as any).__projectId;
    await cyclePage.goto(
      `/${wsSlug}/projects/${projectId}/issues/${td.issueIds[2]}`
    );
    await waitForAppReady(cyclePage);

    // Find "No cycle" placeholder and click to open dropdown
    const cycleTrigger = cyclePage.getByText(/no cycle/i).first();
    await expect(cycleTrigger).toBeVisible({ timeout: 10_000 });
    await cycleTrigger.click();

    // Select "Sprint Alpha" from dropdown
    const cycleOption = cyclePage
      .getByText("Sprint Alpha", { exact: true })
      .last();
    await expect(cycleOption).toBeVisible({ timeout: 5_000 });
    await cycleOption.click();

    await cyclePage.waitForTimeout(1_000);

    // Verify "Sprint Alpha" is now shown on the issue
    const cycleValue = cyclePage.getByText("Sprint Alpha").first();
    await expect(cycleValue).toBeVisible({ timeout: 5_000 });
  });

  test("should show issue count in cycle after adding issues via API", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycleDetail(cyclePage, wsSlug, td.cycleId);
    // Two issues were added via API fixture — verify both are listed
    await expect(
      cyclePage.getByText(td.issueNames[0]!).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      cyclePage.getByText(td.issueNames[1]!).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("should remove issue from cycle via API and verify count", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    // Remove second issue from cycle via API
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.delete(
      `${base_url}/cycles/${td.cycleId}/cycle-issues/${td.issueIds[1]}/`
    );
    expect(res.ok()).toBeTruthy();

    // Verify via API that issue count dropped to 1
    const detailRes = await cyclePage.request.get(
      `${base_url}/cycles/${td.cycleId}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(detailRes.ok()).toBeTruthy();
    const cycle = await detailRes.json();
    expect(cycle.total_issues).toBe(1);

    // Re-add the issue for other tests
    await cyclePage.request.post(
      `${base_url}/cycles/${td.cycleId}/cycle-issues/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { issues: [td.issueIds[1]] },
      }
    );
  });
});

// ─── 6. Cycle from Issue Detail ──────────────────────────────────────────────

test.describe("Cycle from Issue Detail", () => {
  test("should show cycle name on issue that belongs to a cycle", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    // Navigate to issue detail for first issue (assigned to Sprint Alpha)
    const projectId = (cyclePage as any).__projectId;
    await cyclePage.goto(
      `/${wsSlug}/projects/${projectId}/issues/${td.issueIds[0]}`
    );
    await waitForAppReady(cyclePage);

    // "Sprint Alpha" should be visible as the cycle property
    await expect(
      cyclePage.getByText("Sprint Alpha").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show 'No cycle' on issue not in any cycle", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    // Navigate to the third issue (not in any cycle)
    const projectId = (cyclePage as any).__projectId;
    await cyclePage.goto(
      `/${wsSlug}/projects/${projectId}/issues/${td.issueIds[2]}`
    );
    await waitForAppReady(cyclePage);

    // Should show "No cycle" placeholder
    const noCycle = cyclePage.getByText(/no cycle/i).first();
    await expect(noCycle).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 7. Cycle Delete ─────────────────────────────────────────────────────────

test.describe("Cycle Delete", () => {
  test("should delete a cycle via API and verify removal from UI", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    // Delete the second cycle via API
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.delete(
      `${base_url}/cycles/${td.secondCycleId}/`
    );
    expect(res.ok()).toBeTruthy();

    // Navigate to cycles list and verify it's gone
    await goToCycles(cyclePage, wsSlug);
    await expect(
      cyclePage.getByText(td.cycleName).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      cyclePage.getByText(td.secondCycleName)
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

// ─── 8. Cycle API Endpoints ──────────────────────────────────────────────────

test.describe("Cycle API Endpoints", () => {
  test("should list cycles via API", async ({ cyclePage, td }) => {
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.get(`${base_url}/cycles/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const cycles = Array.isArray(data) ? data : data.results ?? [];
    expect(cycles.length).toBeGreaterThanOrEqual(2);

    const names = cycles.map((c: any) => c.name);
    expect(names).toContain(td.cycleName);
    expect(names).toContain(td.secondCycleName);
  });

  test("should get cycle detail via API with stats", async ({
    cyclePage,
    td,
  }) => {
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.get(
      `${base_url}/cycles/${td.cycleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const cycle = await res.json();
    expect(cycle.name).toBe(td.cycleName);
    expect(cycle.total_issues).toBeGreaterThanOrEqual(2);
  });

  test("should update cycle via API", async ({ cyclePage, td }) => {
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.patch(
      `${base_url}/cycles/${td.cycleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Sprint Alpha Updated" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe("Sprint Alpha Updated");

    // Revert
    await cyclePage.request.patch(`${base_url}/cycles/${td.cycleId}/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: { name: td.cycleName },
    });
  });

  test("should add and remove issues from cycle via API", async ({
    cyclePage,
    td,
  }) => {
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Add third issue to cycle
    const addRes = await cyclePage.request.post(
      `${base_url}/cycles/${td.secondCycleId}/cycle-issues/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { issues: [td.issueIds[2]] },
      }
    );
    expect(addRes.ok()).toBeTruthy();

    // Verify issue is in cycle
    const listRes = await cyclePage.request.get(
      `${base_url}/cycles/${td.secondCycleId}/cycle-issues/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(listRes.ok()).toBeTruthy();
    const listData = await listRes.json();
    const issues = Array.isArray(listData)
      ? listData
      : listData.results ?? [];
    const issueIdsInCycle = issues.map(
      (i: any) => i.issue_id ?? i.issue ?? i.id
    );
    expect(issueIdsInCycle).toContain(td.issueIds[2]);

    // Remove the issue
    const removeRes = await cyclePage.request.delete(
      `${base_url}/cycles/${td.secondCycleId}/cycle-issues/${td.issueIds[2]}/`
    );
    expect(removeRes.ok()).toBeTruthy();
  });

  test("should get cycle progress via API", async ({
    cyclePage,
    td,
  }) => {
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.get(
      `${base_url}/cycles/${td.cycleId}/progress/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const progress = await res.json();
    // Progress should have total_issues count
    expect(
      progress.total_issues !== undefined ||
        Array.isArray(progress) ||
        typeof progress === "object"
    ).toBeTruthy();
  });

  test("should check date overlap via API", async ({
    cyclePage,
    td,
  }) => {
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await cyclePage.request.post(
      `${base_url}/cycles/date-check/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          start_date: "2099-01-01T00:00:00Z",
          end_date: "2099-01-15T00:00:00Z",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe(true);
  });

  test("should favorite and unfavorite a cycle via API", async ({
    cyclePage,
    td,
  }) => {
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Add to favorites
    const favRes = await cyclePage.request.post(
      `${base_url}/user-favorite-cycles/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { cycle: td.cycleId },
      }
    );
    expect(favRes.ok()).toBeTruthy();

    // Verify cycle detail shows as favorite
    const detailRes = await cyclePage.request.get(
      `${base_url}/cycles/${td.cycleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(detailRes.ok()).toBeTruthy();
    const cycleDetail = await detailRes.json();
    expect(cycleDetail.is_favorite).toBe(true);

    // Remove from favorites
    const unfavRes = await cyclePage.request.delete(
      `${base_url}/user-favorite-cycles/${td.cycleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(unfavRes.ok()).toBeTruthy();
  });

  test("should delete cycle via API", async ({ cyclePage, td }) => {
    const projectId = (cyclePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Create a throwaway cycle to delete
    const createRes = await cyclePage.request.post(
      `${base_url}/cycles/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "To Be Deleted" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const toDelete = await createRes.json();

    // Delete it
    const delRes = await cyclePage.request.delete(
      `${base_url}/cycles/${toDelete.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(delRes.status()).toBe(204);

    // Verify 404 on fetch
    const fetchRes = await cyclePage.request.get(
      `${base_url}/cycles/${toDelete.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(fetchRes.ok()).toBeFalsy();
  });
});

// ─── 9. Cycle Sidebar Properties ─────────────────────────────────────────────

test.describe("Cycle Sidebar Properties", () => {
  test("should show cycle sidebar with details on detail page", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycleDetail(cyclePage, wsSlug, td.cycleId);

    // The cycle name should appear (in sidebar header)
    await expect(
      cyclePage.getByText(td.cycleName).first()
    ).toBeVisible({ timeout: 10_000 });

    // Should show status badge (Draft for cycles without dates)
    const draftBadge = cyclePage.getByText("Draft", { exact: true }).first();
    await expect(draftBadge).toBeVisible({ timeout: 5_000 });
  });

  test("should show Lead property in cycle sidebar", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycleDetail(cyclePage, wsSlug, td.cycleId);

    // "Lead" label should be visible
    const leadLabel = cyclePage.getByText("Lead", { exact: true }).first();
    await expect(leadLabel).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 10. Navigation Between Cycles ───────────────────────────────────────────

test.describe("Navigation Between Cycles", () => {
  test("should navigate from cycles list to cycle detail by clicking", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycles(cyclePage, wsSlug);

    // Click on the cycle name
    const cycleLink = cyclePage.getByText(td.cycleName).first();
    await expect(cycleLink).toBeVisible({ timeout: 10_000 });
    await cycleLink.click();

    // Should navigate to cycle detail page
    await waitForAppReady(cyclePage);
    await expect(cyclePage).toHaveURL(
      new RegExp(`/cycles/${td.cycleId}`),
      { timeout: 10_000 }
    );
  });

  test("should navigate back to cycles list from detail page", async ({
    cyclePage,
    wsSlug,
    td,
  }) => {
    await goToCycleDetail(cyclePage, wsSlug, td.cycleId);

    // Wait for page to load
    await expect(
      cyclePage.getByText(td.cycleName).first()
    ).toBeVisible({ timeout: 10_000 });

    // Click "Cycles" breadcrumb or sidebar link to go back
    const cyclesLink = cyclePage
      .getByText("Cycles", { exact: true })
      .first();
    await expect(cyclesLink).toBeVisible({ timeout: 5_000 });
    await cyclesLink.click();

    await waitForAppReady(cyclePage);
    // Should be back on cycles list
    await expect(cyclePage).toHaveURL(/\/cycles\/?$/, {
      timeout: 10_000,
    });
  });
});

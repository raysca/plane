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
  // Intake issues created in fixture
  intakeIssueId1: string; // issue ID for "Intake Bug Alpha"
  intakeIssueId2: string; // issue ID for "Intake Bug Beta"
  intakeIssueId3: string; // issue ID for "Intake Bug Gamma"
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  intakePage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("intk-ui"));
  },

  intakePage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("intk-ui");
      const password = generateTestPassword();
      const identifier = `I${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Intake",
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
          first_name: "Intake",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Intake Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project with intake_view enabled
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Intake Project", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      // 6. Enable intake_view on the project
      const enableRes = await request.patch(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/`,
        {
          headers: headers(token),
          data: { inbox_view: true },
        }
      );
      expect(enableRes.ok()).toBeTruthy();

      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 7. Create 3 intake issues
      const issueNames = [
        "Intake Bug Alpha",
        "Intake Bug Beta",
        "Intake Bug Gamma",
      ];
      const issueIds: string[] = [];

      for (const name of issueNames) {
        const res = await request.post(`${base_url}/intake-issues/`, {
          headers: headers(token),
          data: { issue: { name } },
        });
        expect(res.ok()).toBeTruthy();
        const data = await res.json();
        issueIds.push(data.issue);
      }

      const td: TestData = {
        token,
        userId,
        wsSlug,
        projectId,
        identifier,
        intakeIssueId1: issueIds[0]!,
        intakeIssueId2: issueIds[1]!,
        intakeIssueId3: issueIds[2]!,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ intakePage }, use) => {
    await use((intakePage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToIntake(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/intake/`);
  // Intake page has persistent connections so networkidle may not fire.
  // Wait for domcontentloaded and a visible indicator instead.
  await page.waitForLoadState("domcontentloaded");
  await page
    .getByText("Intake", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Intake List UI ──────────────────────────────────────────────────────

test.describe("Intake List UI", () => {
  test("should navigate to intake page", async ({ intakePage, wsSlug }) => {
    await goToIntake(intakePage, wsSlug);
    expect(intakePage.url()).toContain("/intake");
  });

  test("should show Intake sidebar link", async ({ intakePage, wsSlug }) => {
    const projectId = (intakePage as any).__projectId;
    await intakePage.goto(`/${wsSlug}/projects/${projectId}/issues/`);
    await waitForAppReady(intakePage);
    const intakeLink = intakePage
      .getByText("Intake", { exact: true })
      .first();
    await expect(intakeLink).toBeVisible({ timeout: 5_000 });
  });

  test("should show Open tab with issue count", async ({
    intakePage,
    wsSlug,
  }) => {
    await goToIntake(intakePage, wsSlug);
    // The "Open" tab shows the count of pending intake issues
    const openTab = intakePage.getByText("Open").first();
    await expect(openTab).toBeVisible({ timeout: 10_000 });
    // Should show "3" count badge for the 3 fixture issues
    const countBadge = intakePage.getByText("3").first();
    await expect(countBadge).toBeVisible({ timeout: 5_000 });
  });

  test("should show Add work item button", async ({
    intakePage,
    wsSlug,
  }) => {
    await goToIntake(intakePage, wsSlug);
    const addBtn = intakePage
      .getByText("Add work item", { exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 2. Intake API - CRUD ───────────────────────────────────────────────────

test.describe("Intake API - CRUD", () => {
  test("should list intake issues via API", async ({ intakePage, td }) => {
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThanOrEqual(3);
    expect(data.total_results).toBeGreaterThanOrEqual(3);
  });

  test("should get intake issue detail via API", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId1}/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.issue).toBe(td.intakeIssueId1);
    expect(data.status).toBe(-2); // Pending
    expect(data.issue_detail).toBeTruthy();
    expect(data.issue_detail.name).toBe("Intake Bug Alpha");
  });

  test("should create intake issue via API", async ({ intakePage, td }) => {
    const res = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: {
          issue: {
            name: "New Intake Issue",
            description_html: "<p>Test description</p>",
            priority: "high",
          },
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.issue_detail.name).toBe("New Intake Issue");
    expect(data.issue_detail.priority).toBe(2); // high = 2
    expect(data.status).toBe(-2); // Pending

    // Clean up
    await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${data.issue}/`,
      { headers: auth(td.token) }
    );
  });

  test("should create intake issue with different priorities via API", async ({
    intakePage,
    td,
  }) => {
    const priorities = [
      { name: "urgent", expected: 1 },
      { name: "low", expected: 4 },
      { name: "medium", expected: 3 },
    ];

    for (const { name, expected } of priorities) {
      const res = await intakePage.request.post(
        `${baseUrl(td)}/intake-issues/`,
        {
          headers: auth(td.token),
          data: { issue: { name: `Priority ${name}`, priority: name } },
        }
      );
      expect(res.ok()).toBeTruthy();
      const data = await res.json();
      expect(data.issue_detail.priority).toBe(expected);

      // Clean up
      await intakePage.request.delete(
        `${baseUrl(td)}/intake-issues/${data.issue}/`,
        { headers: auth(td.token) }
      );
    }
  });

  test("should reject create without issue name via API", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "" } },
      }
    );
    expect(res.ok()).toBeFalsy();
  });

  test("should update intake issue name via API", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId2}/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Updated Beta Name" } },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.issue_detail.name).toBe("Updated Beta Name");

    // Revert
    await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId2}/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Intake Bug Beta" } },
      }
    );
  });

  test("should delete intake issue via API", async ({ intakePage, td }) => {
    // Create a throwaway intake issue
    const createRes = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "To Delete" } },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    const delRes = await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      { headers: auth(td.token) }
    );
    expect(delRes.status()).toBe(204);

    // Verify deleted
    const getRes = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      { headers: auth(td.token) }
    );
    expect(getRes.ok()).toBeFalsy();
  });
});

// ─── 3. Intake API - Status Transitions ─────────────────────────────────────

test.describe("Intake API - Status Transitions", () => {
  test("should accept an intake issue via API", async ({
    intakePage,
    td,
  }) => {
    // Create a fresh intake issue for this test
    const createRes = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Accept Test Issue" } },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const issueId = created.issue;

    // Accept the issue (status = 1)
    const acceptRes = await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${issueId}/`,
      {
        headers: auth(td.token),
        data: { status: 1 },
      }
    );
    expect(acceptRes.ok()).toBeTruthy();
    const accepted = await acceptRes.json();
    expect(accepted.status).toBe(1);

    // Verify the issue state was transitioned from triage to default
    expect(accepted.issue_detail.state__group).not.toBe("triage");
  });

  test("should reject an intake issue via API", async ({
    intakePage,
    td,
  }) => {
    const createRes = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Reject Test Issue" } },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    const rejectRes = await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      {
        headers: auth(td.token),
        data: { status: -1 },
      }
    );
    expect(rejectRes.ok()).toBeTruthy();
    const rejected = await rejectRes.json();
    expect(rejected.status).toBe(-1);

    // Clean up
    await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      { headers: auth(td.token) }
    );
  });

  test("should snooze an intake issue via API", async ({
    intakePage,
    td,
  }) => {
    const createRes = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Snooze Test Issue" } },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);

    const snoozeRes = await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      {
        headers: auth(td.token),
        data: {
          status: 0,
          snoozed_till: futureDate.toISOString(),
        },
      }
    );
    expect(snoozeRes.ok()).toBeTruthy();
    const snoozed = await snoozeRes.json();
    expect(snoozed.status).toBe(0);
    expect(snoozed.snoozed_till).toBeTruthy();

    // Clean up
    await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      { headers: auth(td.token) }
    );
  });

  test("should mark intake issue as duplicate via API", async ({
    intakePage,
    td,
  }) => {
    const createRes = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Duplicate Test Issue" } },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Mark as duplicate of intakeIssueId1
    const dupRes = await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      {
        headers: auth(td.token),
        data: {
          status: 2,
          duplicate_to: td.intakeIssueId1,
        },
      }
    );
    expect(dupRes.ok()).toBeTruthy();
    const dup = await dupRes.json();
    expect(dup.status).toBe(2);
    expect(dup.duplicate_to).toBe(td.intakeIssueId1);

    // Clean up
    await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      { headers: auth(td.token) }
    );
  });
});

// ─── 4. Intake API - Issue Properties ───────────────────────────────────────

test.describe("Intake API - Issue Properties", () => {
  test("should update issue priority via API", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId1}/`,
      {
        headers: auth(td.token),
        data: { issue: { priority: "urgent" } },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.issue_detail.priority).toBe(1); // urgent = 1

    // Revert
    await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId1}/`,
      {
        headers: auth(td.token),
        data: { issue: { priority: "none" } },
      }
    );
  });

  test("should update issue description via API", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId1}/`,
      {
        headers: auth(td.token),
        data: {
          issue: {
            description_html: "<p>Updated description for Alpha</p>",
          },
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.issue_detail.description_html).toContain(
      "Updated description for Alpha"
    );
  });

  test("should update issue state via API", async ({ intakePage, td }) => {
    // Get project states
    const statesRes = await intakePage.request.get(
      `${baseUrl(td)}/states/`,
      { headers: auth(td.token) }
    );
    expect(statesRes.ok()).toBeTruthy();
    const allStates = await statesRes.json();
    const statesList = Array.isArray(allStates)
      ? allStates
      : allStates.results ?? [];

    // Find a non-triage state
    const targetState = statesList.find(
      (s: any) => s.group !== "triage"
    );
    expect(targetState).toBeTruthy();

    const res = await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId1}/`,
      {
        headers: auth(td.token),
        data: { issue: { state_id: targetState.id } },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.issue_detail.state_id).toBe(targetState.id);
  });
});

// ─── 5. Intake API - Pagination & Filtering ─────────────────────────────────

test.describe("Intake API - Pagination & Filtering", () => {
  test("should paginate intake issues via API", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/?per_page=2`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results.length).toBeLessThanOrEqual(2);
    expect(data.total_results).toBeGreaterThanOrEqual(3);
  });

  test("should filter intake issues by status via API", async ({
    intakePage,
    td,
  }) => {
    // All fixture issues are pending (-2)
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/?status=-2`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results.length).toBeGreaterThanOrEqual(3);
    // All should be pending
    for (const issue of data.results) {
      expect(issue.status).toBe(-2);
    }
  });

  test("should return empty results for non-matching status filter", async ({
    intakePage,
    td,
  }) => {
    // Filter for accepted (1) — none should match since all are pending
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/?status=1`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results.length).toBe(0);
  });

  test("should support cursor-based pagination via API", async ({
    intakePage,
    td,
  }) => {
    // Get first page
    const res1 = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/?per_page=1`,
      { headers: auth(td.token) }
    );
    expect(res1.ok()).toBeTruthy();
    const data1 = await res1.json();
    expect(data1.results.length).toBe(1);
    expect(data1.next_page_results).toBe(true);

    // Get second page using cursor
    const res2 = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/?per_page=1&cursor=${data1.next_cursor}`,
      { headers: auth(td.token) }
    );
    expect(res2.ok()).toBeTruthy();
    const data2 = await res2.json();
    expect(data2.results.length).toBe(1);
    // Different issue than first page
    expect(data2.results[0].issue).not.toBe(data1.results[0].issue);
  });
});

// ─── 6. Intake API - Inbox Alias ────────────────────────────────────────────

test.describe("Intake API - Inbox Alias", () => {
  test("should work with inbox-issues alias endpoint", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/inbox-issues/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results.length).toBeGreaterThanOrEqual(3);
  });

  test("should create via inbox-issues alias", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/inbox-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Alias Created Issue" } },
      }
    );
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.issue_detail.name).toBe("Alias Created Issue");

    // Clean up
    await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${data.issue}/`,
      { headers: auth(td.token) }
    );
  });
});

// ─── 7. Intake API - Feature Toggle ─────────────────────────────────────────

test.describe("Intake API - Feature Toggle", () => {
  test("should return empty when intake is disabled", async ({
    intakePage,
    td,
  }) => {
    // Disable intake
    const disableRes = await intakePage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: auth(td.token),
        data: { inbox_view: false },
      }
    );
    expect(disableRes.ok()).toBeTruthy();

    // List should return empty
    const listRes = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/`,
      { headers: auth(td.token) }
    );
    expect(listRes.ok()).toBeTruthy();
    const data = await listRes.json();
    expect(data.results.length).toBe(0);
    expect(data.total_results).toBe(0);

    // Re-enable
    await intakePage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: auth(td.token),
        data: { inbox_view: true },
      }
    );
  });

  test("should reject create when intake is disabled", async ({
    intakePage,
    td,
  }) => {
    // Disable intake
    await intakePage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: auth(td.token),
        data: { inbox_view: false },
      }
    );

    const createRes = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Should Fail" } },
      }
    );
    expect(createRes.ok()).toBeFalsy();
    expect(createRes.status()).toBe(400);

    // Re-enable
    await intakePage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/`,
      {
        headers: auth(td.token),
        data: { inbox_view: true },
      }
    );
  });
});

// ─── 8. Intake API - Response Validation ────────────────────────────────────

test.describe("Intake API - Response Validation", () => {
  test("should return correct intake issue fields", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId1}/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Top-level fields
    expect(data.id).toBeTruthy();
    expect(data.issue).toBe(td.intakeIssueId1);
    expect(data.status).toBeDefined();
    expect(data.snoozed_till).toBeDefined();
    expect(data.duplicate_to).toBeDefined();
    expect(data.source).toBe("IN_APP");
    expect(data.created_by).toBeTruthy();
    expect(data.created_at).toBeTruthy();
    expect(data.project).toBe(td.projectId);
    expect(data.workspace).toBeTruthy();
    expect(data.intake).toBeTruthy();

    // Issue detail nested fields
    const detail = data.issue_detail;
    expect(detail).toBeTruthy();
    expect(detail.id).toBe(td.intakeIssueId1);
    expect(detail.name).toBe("Intake Bug Alpha");
    expect(detail.priority).toBeDefined();
    expect(detail.state_id).toBeTruthy();
    expect(detail.state__group).toBeTruthy();
    expect(detail.project_id).toBe(td.projectId);
    expect(detail.assignee_ids).toBeInstanceOf(Array);
    expect(detail.label_ids).toBeInstanceOf(Array);
    expect(detail.created_at).toBeTruthy();
  });

  test("should include duplicate issue detail when marked duplicate", async ({
    intakePage,
    td,
  }) => {
    // Create and mark as duplicate
    const createRes = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Dup Validate" } },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    await intakePage.request.patch(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      {
        headers: auth(td.token),
        data: { status: 2, duplicate_to: td.intakeIssueId1 },
      }
    );

    // Get detail
    const detailRes = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      { headers: auth(td.token) }
    );
    expect(detailRes.ok()).toBeTruthy();
    const data = await detailRes.json();
    expect(data.duplicate_issue_detail).toBeTruthy();
    expect(data.duplicate_issue_detail.id).toBe(td.intakeIssueId1);
    expect(data.duplicate_issue_detail.name).toBe("Intake Bug Alpha");

    // Clean up
    await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${created.issue}/`,
      { headers: auth(td.token) }
    );
  });

  test("should have triage state for new intake issues", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId1}/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.issue_detail.state__group).toBe("triage");
  });

  test("should return 404 for non-existent intake issue", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/00000000-0000-0000-0000-000000000000/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(404);
  });
});

// ─── 9. Intake API - Source Tracking ────────────────────────────────────────

test.describe("Intake API - Source Tracking", () => {
  test("should default source to IN_APP", async ({ intakePage, td }) => {
    const res = await intakePage.request.get(
      `${baseUrl(td)}/intake-issues/${td.intakeIssueId1}/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.source).toBe("IN_APP");
  });

  test("should allow custom source on create", async ({
    intakePage,
    td,
  }) => {
    const res = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: {
          source: "EMAIL",
          issue: { name: "Email Sourced Issue" },
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.source).toBe("EMAIL");

    // Clean up
    await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${data.issue}/`,
      { headers: auth(td.token) }
    );
  });
});

// ─── 10. Intake - Delete Behavior ───────────────────────────────────────────

test.describe("Intake API - Delete Behavior", () => {
  test("should delete underlying issue when intake issue is not accepted", async ({
    intakePage,
    td,
  }) => {
    // Create intake issue (pending)
    const createRes = await intakePage.request.post(
      `${baseUrl(td)}/intake-issues/`,
      {
        headers: auth(td.token),
        data: { issue: { name: "Delete Underlying" } },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const issueId = created.issue;

    // Delete the intake issue
    const delRes = await intakePage.request.delete(
      `${baseUrl(td)}/intake-issues/${issueId}/`,
      { headers: auth(td.token) }
    );
    expect(delRes.status()).toBe(204);

    // The underlying issue should also be deleted
    const issueRes = await intakePage.request.get(
      `${baseUrl(td)}/issues/${issueId}/`,
      { headers: auth(td.token) }
    );
    expect(issueRes.ok()).toBeFalsy();
  });
});

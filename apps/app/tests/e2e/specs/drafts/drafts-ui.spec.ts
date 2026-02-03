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
  labelId: string;
  cycleId: string;
  moduleId: string;
  stateId: string; // default state
  draftId1: string; // "Draft Alpha"
  draftId2: string; // "Draft Beta"
  draftId3: string; // "Draft Gamma"
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  draftPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("drft-ui"));
  },

  draftPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("drft-ui");
      const password = generateTestPassword();
      const identifier = `D${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Draft",
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
          first_name: "Draft",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Draft Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Draft Project", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      const baseProjectUrl = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Get default state
      const statesRes = await request.get(`${baseProjectUrl}/states/`, {
        headers: headers(token),
      });
      const allStates = await statesRes.json();
      const statesList = Array.isArray(allStates)
        ? allStates
        : allStates.results ?? [];
      const defaultState = statesList.find((s: any) => s.is_default);
      const stateId = defaultState?.id ?? statesList[0]?.id;

      // 7. Create a label
      const labelRes = await request.post(`${baseProjectUrl}/labels/`, {
        headers: headers(token),
        data: { name: "Draft Label", color: "#3b82f6" },
      });
      const label = await labelRes.json();
      const labelId = label.id;

      // 8. Create a cycle
      const now = new Date();
      const cycleStart = now.toISOString().split("T")[0];
      const cycleEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const cycleRes = await request.post(`${baseProjectUrl}/cycles/`, {
        headers: headers(token),
        data: { name: "Draft Cycle", start_date: cycleStart, end_date: cycleEnd },
      });
      const cycle = await cycleRes.json();
      const cycleId = cycle.id;

      // 9. Create a module
      const moduleRes = await request.post(`${baseProjectUrl}/modules/`, {
        headers: headers(token),
        data: { name: "Draft Module" },
      });
      const mod = await moduleRes.json();
      const moduleId = mod.id;

      // 10. Create 3 draft issues
      const draftBaseUrl = `${API_BASE}/api/workspaces/${wsSlug}/draft-issues/`;
      const draftNames = ["Draft Alpha", "Draft Beta", "Draft Gamma"];
      const draftIds: string[] = [];

      for (const name of draftNames) {
        const res = await request.post(draftBaseUrl, {
          headers: headers(token),
          data: { name, project_id: projectId },
        });
        expect(res.ok()).toBeTruthy();
        const data = await res.json();
        draftIds.push(data.id);
      }

      const td: TestData = {
        token,
        userId,
        wsSlug,
        projectId,
        identifier,
        labelId,
        cycleId,
        moduleId,
        stateId,
        draftId1: draftIds[0]!,
        draftId2: draftIds[1]!,
        draftId3: draftIds[2]!,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ draftPage }, use) => {
    await use((draftPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToDrafts(page: Page, wsSlug: string) {
  await page.goto(`/${wsSlug}/drafts/`);
  await page.waitForLoadState("domcontentloaded");
  // Wait for "Drafts" heading or sidebar link to be visible
  await page
    .getByText("Drafts", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 });
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Drafts List UI ──────────────────────────────────────────────────────

test.describe("Drafts List UI", () => {
  test("should navigate to drafts page", async ({ draftPage, wsSlug }) => {
    await goToDrafts(draftPage, wsSlug);
    expect(draftPage.url()).toContain("/drafts");
  });

  test("should show Drafts sidebar link", async ({ draftPage, wsSlug }) => {
    const projectId = (draftPage as any).__projectId;
    await draftPage.goto(`/${wsSlug}/projects/${projectId}/issues/`);
    await waitForAppReady(draftPage);
    const draftsLink = draftPage
      .getByText("Drafts", { exact: true })
      .first();
    await expect(draftsLink).toBeVisible({ timeout: 5_000 });
  });

  test("should display draft issues in list", async ({
    draftPage,
    wsSlug,
  }) => {
    await goToDrafts(draftPage, wsSlug);
    // At least one draft name should be visible
    const firstDraft = draftPage.getByText("Draft Alpha").first();
    await expect(firstDraft).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 2. Draft API - CRUD ────────────────────────────────────────────────────

test.describe("Draft API - CRUD", () => {
  test("should list draft issues via API", async ({ draftPage, td }) => {
    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results).toBeDefined();
    expect(data.results.length).toBeGreaterThanOrEqual(3);
    expect(data.total_count).toBeGreaterThanOrEqual(3);
  });

  test("should get draft issue detail via API", async ({ draftPage, td }) => {
    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.id).toBe(td.draftId1);
    expect(data.name).toBe("Draft Alpha");
    expect(data.is_draft).toBe(true);
  });

  test("should create draft issue via API", async ({ draftPage, td }) => {
    const res = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: {
          name: "New Draft Issue",
          description_html: "<p>Draft description</p>",
          priority: "high",
          project_id: td.projectId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("New Draft Issue");
    expect(data.priority).toBe("high");
    expect(data.is_draft).toBe(true);

    // Clean up
    await draftPage.request.delete(
      `${baseUrl(td)}/draft-issues/${data.id}/`,
      { headers: auth(td.token) }
    );
  });

  test("should create draft with minimal fields via API", async ({
    draftPage,
    td,
  }) => {
    const res = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: { name: "Minimal Draft" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.name).toBe("Minimal Draft");
    expect(data.priority).toBe("none");
    expect(data.project_id).toBeNull();

    // Clean up
    await draftPage.request.delete(
      `${baseUrl(td)}/draft-issues/${data.id}/`,
      { headers: auth(td.token) }
    );
  });

  test("should update draft issue name via API", async ({ draftPage, td }) => {
    const res = await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId2}/`,
      {
        headers: auth(td.token),
        data: { name: "Updated Beta Name" },
      }
    );
    expect(res.status()).toBe(204);

    // Verify update
    const getRes = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId2}/`,
      { headers: auth(td.token) }
    );
    const data = await getRes.json();
    expect(data.name).toBe("Updated Beta Name");

    // Revert
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId2}/`,
      {
        headers: auth(td.token),
        data: { name: "Draft Beta" },
      }
    );
  });

  test("should delete draft issue via API", async ({ draftPage, td }) => {
    // Create a throwaway draft
    const createRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: { name: "To Delete" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    const delRes = await draftPage.request.delete(
      `${baseUrl(td)}/draft-issues/${created.id}/`,
      { headers: auth(td.token) }
    );
    expect(delRes.status()).toBe(204);

    // Verify deleted
    const getRes = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${created.id}/`,
      { headers: auth(td.token) }
    );
    expect(getRes.ok()).toBeFalsy();
    expect(getRes.status()).toBe(404);
  });
});

// ─── 3. Draft API - Properties ──────────────────────────────────────────────

test.describe("Draft API - Properties", () => {
  test("should update draft priority via API", async ({ draftPage, td }) => {
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { priority: "urgent" },
      }
    );

    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    const data = await res.json();
    expect(data.priority).toBe("urgent");

    // Revert
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { priority: "none" },
      }
    );
  });

  test("should update draft description via API", async ({
    draftPage,
    td,
  }) => {
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { description_html: "<p>Updated description</p>" },
      }
    );

    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    const data = await res.json();
    expect(data.description_html).toContain("Updated description");
  });

  test("should update draft state via API", async ({ draftPage, td }) => {
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { state_id: td.stateId },
      }
    );

    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    const data = await res.json();
    expect(data.state_id).toBe(td.stateId);
  });

  test("should update draft dates via API", async ({ draftPage, td }) => {
    const startDate = "2025-01-15";
    const targetDate = "2025-02-15";

    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { start_date: startDate, target_date: targetDate },
      }
    );

    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    const data = await res.json();
    expect(data.start_date).toBe(startDate);
    expect(data.target_date).toBe(targetDate);
  });

  test("should reject start date after target date via API", async ({
    draftPage,
    td,
  }) => {
    const res = await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { start_date: "2025-03-01", target_date: "2025-02-01" },
      }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });
});

// ─── 4. Draft API - Relationships ───────────────────────────────────────────

test.describe("Draft API - Relationships", () => {
  test("should add assignees to draft via API", async ({ draftPage, td }) => {
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { assignee_ids: [td.userId] },
      }
    );

    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    const data = await res.json();
    expect(data.assignee_ids).toContain(td.userId);

    // Clear assignees
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { assignee_ids: [] },
      }
    );
  });

  test("should add labels to draft via API", async ({ draftPage, td }) => {
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { label_ids: [td.labelId] },
      }
    );

    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    const data = await res.json();
    expect(data.label_ids).toContain(td.labelId);

    // Clear labels
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { label_ids: [] },
      }
    );
  });

  test("should add cycle to draft via API", async ({ draftPage, td }) => {
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { cycle_id: td.cycleId },
      }
    );

    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    const data = await res.json();
    expect(data.cycle_id).toBe(td.cycleId);

    // Clear cycle
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { cycle_id: null },
      }
    );
  });

  test("should add modules to draft via API", async ({ draftPage, td }) => {
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { module_ids: [td.moduleId] },
      }
    );

    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    const data = await res.json();
    expect(data.module_ids).toContain(td.moduleId);

    // Clear modules
    await draftPage.request.patch(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      {
        headers: auth(td.token),
        data: { module_ids: [] },
      }
    );
  });

  test("should create draft with all relationships via API", async ({
    draftPage,
    td,
  }) => {
    const res = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: {
          name: "Full Draft",
          project_id: td.projectId,
          state_id: td.stateId,
          priority: "medium",
          assignee_ids: [td.userId],
          label_ids: [td.labelId],
          cycle_id: td.cycleId,
          module_ids: [td.moduleId],
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.assignee_ids).toContain(td.userId);
    expect(data.label_ids).toContain(td.labelId);
    expect(data.cycle_id).toBe(td.cycleId);
    expect(data.module_ids).toContain(td.moduleId);

    // Clean up
    await draftPage.request.delete(
      `${baseUrl(td)}/draft-issues/${data.id}/`,
      { headers: auth(td.token) }
    );
  });
});

// ─── 5. Draft-to-Issue Conversion ───────────────────────────────────────────

test.describe("Draft-to-Issue Conversion", () => {
  test("should convert draft to issue via API", async ({ draftPage, td }) => {
    // Create a draft to convert
    const createRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: {
          name: "Convert Me",
          project_id: td.projectId,
          priority: "high",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const draft = await createRes.json();

    // Convert to issue
    const convertRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-to-issue/${draft.id}/`,
      {
        headers: auth(td.token),
        data: {},
      }
    );
    expect(convertRes.ok()).toBeTruthy();
    expect(convertRes.status()).toBe(201);
    const issue = await convertRes.json();

    expect(issue.id).toBeTruthy();
    expect(issue.name).toBe("Convert Me");
    expect(issue.project_id).toBe(td.projectId);
    expect(issue.sequence_id).toBeTruthy();
    // Priority is converted to numeric (high = 2)
    expect(issue.priority).toBe(2);

    // Draft should be deleted
    const getRes = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${draft.id}/`,
      { headers: auth(td.token) }
    );
    expect(getRes.ok()).toBeFalsy();
    expect(getRes.status()).toBe(404);
  });

  test("should convert draft with relationships to issue", async ({
    draftPage,
    td,
  }) => {
    // Create draft with relationships
    const createRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: {
          name: "Full Convert",
          project_id: td.projectId,
          assignee_ids: [td.userId],
          label_ids: [td.labelId],
          cycle_id: td.cycleId,
          module_ids: [td.moduleId],
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const draft = await createRes.json();

    // Convert to issue
    const convertRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-to-issue/${draft.id}/`,
      {
        headers: auth(td.token),
        data: {},
      }
    );
    expect(convertRes.ok()).toBeTruthy();
    const issue = await convertRes.json();

    // Verify relationships transferred
    expect(issue.assignee_ids).toContain(td.userId);
    expect(issue.label_ids).toContain(td.labelId);
    expect(issue.cycle_id).toBe(td.cycleId);
    expect(issue.module_ids).toContain(td.moduleId);
  });

  test("should require project_id for conversion", async ({
    draftPage,
    td,
  }) => {
    // Create draft without project
    const createRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: { name: "No Project Draft" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const draft = await createRes.json();

    // Try to convert without project
    const convertRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-to-issue/${draft.id}/`,
      {
        headers: auth(td.token),
        data: {},
      }
    );
    expect(convertRes.ok()).toBeFalsy();
    expect(convertRes.status()).toBe(400);

    // Clean up
    await draftPage.request.delete(
      `${baseUrl(td)}/draft-issues/${draft.id}/`,
      { headers: auth(td.token) }
    );
  });

  test("should allow overriding fields during conversion", async ({
    draftPage,
    td,
  }) => {
    // Create draft
    const createRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: {
          name: "Original Name",
          project_id: td.projectId,
          priority: "low",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const draft = await createRes.json();

    // Convert with overrides
    const convertRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-to-issue/${draft.id}/`,
      {
        headers: auth(td.token),
        data: {
          name: "Overridden Name",
          priority: "urgent",
        },
      }
    );
    expect(convertRes.ok()).toBeTruthy();
    const issue = await convertRes.json();

    expect(issue.name).toBe("Overridden Name");
    expect(issue.priority).toBe(1); // urgent = 1
  });

  test("should auto-assign default state during conversion", async ({
    draftPage,
    td,
  }) => {
    // Create draft without state
    const createRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: {
          name: "No State Draft",
          project_id: td.projectId,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const draft = await createRes.json();

    // Convert
    const convertRes = await draftPage.request.post(
      `${baseUrl(td)}/draft-to-issue/${draft.id}/`,
      {
        headers: auth(td.token),
        data: {},
      }
    );
    expect(convertRes.ok()).toBeTruthy();
    const issue = await convertRes.json();

    // Should have a state assigned
    expect(issue.state_id).toBeTruthy();
  });
});

// ─── 6. Draft API - Pagination ──────────────────────────────────────────────

test.describe("Draft API - Pagination", () => {
  test("should paginate draft issues via API", async ({ draftPage, td }) => {
    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/?per_page=2`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.results.length).toBeLessThanOrEqual(2);
    expect(data.total_count).toBeGreaterThanOrEqual(3);
    expect(data.total_pages).toBeGreaterThanOrEqual(2);
  });

  test("should support cursor-based pagination via API", async ({
    draftPage,
    td,
  }) => {
    // Get first page
    const res1 = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/?per_page=1`,
      { headers: auth(td.token) }
    );
    expect(res1.ok()).toBeTruthy();
    const data1 = await res1.json();
    expect(data1.results.length).toBe(1);
    expect(data1.next_page_results).toBe(true);
    expect(data1.next_cursor).toBeTruthy();

    // Get second page
    const res2 = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/?per_page=1&cursor=${data1.next_cursor}`,
      { headers: auth(td.token) }
    );
    expect(res2.ok()).toBeTruthy();
    const data2 = await res2.json();
    expect(data2.results.length).toBe(1);
    // Different draft than first page
    expect(data2.results[0].id).not.toBe(data1.results[0].id);
  });
});

// ─── 7. Draft API - Response Validation ─────────────────────────────────────

test.describe("Draft API - Response Validation", () => {
  test("should return correct draft fields", async ({ draftPage, td }) => {
    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/${td.draftId1}/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Core fields
    expect(data.id).toBe(td.draftId1);
    expect(data.name).toBe("Draft Alpha");
    expect(data.is_draft).toBe(true);
    expect(data.priority).toBeDefined();
    expect(data.sort_order).toBeDefined();
    expect(data.created_at).toBeTruthy();
    expect(data.updated_at).toBeTruthy();
    expect(data.created_by).toBe(td.userId);

    // Relationship arrays
    expect(Array.isArray(data.assignee_ids)).toBe(true);
    expect(Array.isArray(data.label_ids)).toBe(true);
    expect(Array.isArray(data.module_ids)).toBe(true);

    // Nullable fields
    expect(data.cycle_id).toBeDefined();
    expect(data.state_id).toBeDefined();
    expect(data.project_id).toBeDefined();
    expect(data.parent_id).toBeDefined();
    expect(data.start_date).toBeDefined();
    expect(data.target_date).toBeDefined();
    expect(data.completed_at).toBeDefined();
    expect(data.estimate_point).toBeDefined();
    expect(data.type_id).toBeDefined();
    expect(data.description_html).toBeDefined();
  });

  test("should return 404 for non-existent draft", async ({
    draftPage,
    td,
  }) => {
    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/00000000-0000-0000-0000-000000000000/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(404);
  });

  test("should return correct list response structure", async ({
    draftPage,
    td,
  }) => {
    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.count).toBeDefined();
    expect(data.total_count).toBeDefined();
    expect(data.total_pages).toBeDefined();
    expect(data.next_page_results).toBeDefined();
    expect(data.prev_page_results).toBeDefined();
    expect(data.extra_stats).toBeNull();
    expect(data.grouped_by).toBeNull();
    expect(data.sub_grouped_by).toBeNull();
  });
});

// ─── 8. Draft API - User Isolation ──────────────────────────────────────────

test.describe("Draft API - User Isolation", () => {
  test("should only return drafts created by current user", async ({
    draftPage,
    td,
  }) => {
    const res = await draftPage.request.get(
      `${baseUrl(td)}/draft-issues/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // All drafts should be created by the current user
    for (const draft of data.results) {
      expect(draft.created_by).toBe(td.userId);
    }
  });
});

// ─── 9. Draft API - Empty String Handling ───────────────────────────────────

test.describe("Draft API - Empty String Handling", () => {
  test("should convert empty strings to null for FK fields", async ({
    draftPage,
    td,
  }) => {
    const res = await draftPage.request.post(
      `${baseUrl(td)}/draft-issues/`,
      {
        headers: auth(td.token),
        data: {
          name: "Empty String Test",
          project_id: "",
          state_id: "",
          parent_id: "",
          type_id: "",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // These fields go through emptyToNull conversion
    expect(data.project_id).toBeNull();
    expect(data.state_id).toBeNull();
    expect(data.parent_id).toBeNull();
    expect(data.type_id).toBeNull();

    // Clean up
    await draftPage.request.delete(
      `${baseUrl(td)}/draft-issues/${data.id}/`,
      { headers: auth(td.token) }
    );
  });
});

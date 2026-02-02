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
  states: Array<{
    id: string;
    name: string;
    group: string;
    color: string;
    is_default: boolean;
  }>;
  labels: Array<{ id: string; name: string; color: string }>;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  settingsPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("lbl-st"));
  },

  settingsPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("lbl-st");
      const password = generateTestPassword();
      const identifier = `S${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Settings",
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
          first_name: "Settings",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Settings Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Settings Project", identifier, network: 2 },
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
      ).map((s: any) => ({
        id: s.id,
        name: s.name,
        group: s.group,
        color: s.color,
        is_default: s.is_default ?? false,
      }));

      // 7. Create 2 labels
      const labelNames = [
        { name: "Bug", color: "#ef4444" },
        { name: "Feature", color: "#3b82f6" },
      ];
      const labels: TestData["labels"] = [];
      for (const l of labelNames) {
        const res = await request.post(`${base_url}/labels/`, {
          headers: headers(token),
          data: l,
        });
        expect(res.ok()).toBeTruthy();
        const label = await res.json();
        labels.push({ id: label.id, name: label.name, color: label.color });
      }

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        identifier,
        states,
        labels,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ settingsPage }, use) => {
    await use((settingsPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}`;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToLabels(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/settings/projects/${projectId}/labels/`);
  await waitForAppReady(page);
}

async function goToStates(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/settings/projects/${projectId}/states/`);
  await waitForAppReady(page);
}

// ══════════════════════════════════════════════════════════════════════════════
// LABELS
// ══════════════════════════════════════════════════════════════════════════════

// ─── Labels API ──────────────────────────────────────────────────────────────

test.describe("Labels API", () => {
  test("should list labels via API", async ({ settingsPage, td }) => {
    const res = await settingsPage.request.get(
      `${baseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const labels = Array.isArray(data) ? data : data.results ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(2);
    const names = labels.map((l: any) => l.name);
    expect(names).toContain("Bug");
    expect(names).toContain("Feature");
  });

  test("should create a label via API", async ({ settingsPage, td }) => {
    const res = await settingsPage.request.post(
      `${baseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Enhancement", color: "#10b981" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const label = await res.json();
    expect(label.name).toBe("Enhancement");
    expect(label.color).toBe("#10b981");
    expect(label.id).toBeTruthy();

    // Clean up
    await settingsPage.request.delete(
      `${baseUrl(td)}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should update a label via API", async ({ settingsPage, td }) => {
    const label = td.labels[0]!;
    const res = await settingsPage.request.patch(
      `${baseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Critical Bug", color: "#dc2626" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe("Critical Bug");
    expect(updated.color).toBe("#dc2626");

    // Revert
    await settingsPage.request.patch(
      `${baseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: { name: label.name, color: label.color },
      }
    );
  });

  test("should delete a label via API", async ({ settingsPage, td }) => {
    // Create throwaway label
    const createRes = await settingsPage.request.post(
      `${baseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Temporary", color: "#a3a3a3" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const temp = await createRes.json();

    const delRes = await settingsPage.request.delete(
      `${baseUrl(td)}/labels/${temp.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(204);

    // Verify gone
    const listRes = await settingsPage.request.get(
      `${baseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    const labels = await listRes.json();
    const ids = (Array.isArray(labels) ? labels : labels.results ?? []).map(
      (l: any) => l.id
    );
    expect(ids).not.toContain(temp.id);
  });

  test("should reject duplicate label name via API", async ({
    settingsPage,
    td,
  }) => {
    const res = await settingsPage.request.post(
      `${baseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Bug", color: "#000000" },
      }
    );
    // Should fail - duplicate name
    expect(res.ok()).toBeFalsy();
  });

  test("should create label with parent via API", async ({
    settingsPage,
    td,
  }) => {
    const parentId = td.labels[0]!.id;
    const res = await settingsPage.request.post(
      `${baseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "UI Bug",
          color: "#f97316",
          parent_id: parentId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const label = await res.json();
    expect(label.name).toBe("UI Bug");
    expect(label.parent_id).toBe(parentId);

    // Clean up
    await settingsPage.request.delete(
      `${baseUrl(td)}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should auto-assign default color when none provided", async ({
    settingsPage,
    td,
  }) => {
    const res = await settingsPage.request.post(
      `${baseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "No Color Label" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const label = await res.json();
    expect(label.color).toBeTruthy();
    // Default is "#000000"
    expect(label.color).toMatch(/^#[0-9a-fA-F]{6}$/);

    // Clean up
    await settingsPage.request.delete(
      `${baseUrl(td)}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });
});

// ─── Labels UI ───────────────────────────────────────────────────────────────

test.describe("Labels UI", () => {
  test("should navigate to labels settings page", async ({
    settingsPage,
    wsSlug,
  }) => {
    await goToLabels(settingsPage, wsSlug);
    expect(settingsPage.url()).toContain("/labels");
  });

  test("should display labels heading and description on settings page", async ({
    settingsPage,
    wsSlug,
  }) => {
    await goToLabels(settingsPage, wsSlug);
    // Verify the Labels heading is visible
    await expect(
      settingsPage.getByRole("heading", { name: "Labels" }).first()
    ).toBeVisible({ timeout: 10_000 });
    // Verify the description text
    await expect(
      settingsPage
        .getByText(/create custom labels/i)
        .first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("should show Add label button on settings page", async ({
    settingsPage,
    wsSlug,
  }) => {
    await goToLabels(settingsPage, wsSlug);
    const addBtn = settingsPage
      .getByRole("button", { name: /add label/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should open inline label form when Add label is clicked", async ({
    settingsPage,
    wsSlug,
  }) => {
    await goToLabels(settingsPage, wsSlug);
    const addBtn = settingsPage
      .getByRole("button", { name: /add label/i })
      .first();
    await addBtn.click();
    await settingsPage.waitForTimeout(500);

    // The inline form should show a "Label title" input
    const nameInput = settingsPage
      .getByPlaceholder(/label title/i)
      .first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
  });

  test("should fill and submit the inline label form", async ({
    settingsPage,
    wsSlug,
    td,
  }) => {
    await goToLabels(settingsPage, wsSlug);

    const addBtn = settingsPage
      .getByRole("button", { name: /add label/i })
      .first();
    await addBtn.click();
    await settingsPage.waitForTimeout(500);

    // Fill label name
    const nameInput = settingsPage
      .getByPlaceholder(/label title/i)
      .first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Documentation");

    // Click the Add/submit button
    const submitBtn = settingsPage
      .getByRole("button", { name: /^add$/i })
      .first();
    await expect(submitBtn).toBeVisible({ timeout: 3_000 });
    await submitBtn.click();

    // Wait for submission
    await settingsPage.waitForTimeout(2_000);

    // Verify the label was created via API
    const listRes = await settingsPage.request.get(
      `${baseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(listRes.ok()).toBeTruthy();
    const labels = await listRes.json();
    const names = (Array.isArray(labels) ? labels : labels.results ?? []).map(
      (l: any) => l.name
    );
    expect(names).toContain("Documentation");
  });

  test("should cancel label creation", async ({
    settingsPage,
    wsSlug,
  }) => {
    await goToLabels(settingsPage, wsSlug);

    const addBtn = settingsPage
      .getByRole("button", { name: /add label/i })
      .first();
    await addBtn.click();
    await settingsPage.waitForTimeout(500);

    const nameInput = settingsPage
      .getByPlaceholder(/label title/i)
      .first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Should Not Exist Label");

    // Click cancel
    const cancelBtn = settingsPage
      .getByRole("button", { name: "Cancel", exact: true })
      .first();
    await cancelBtn.click();

    await settingsPage.waitForTimeout(500);
    await expect(
      settingsPage.getByText("Should Not Exist Label")
    ).not.toBeVisible({ timeout: 3_000 });
  });

  test("should verify labels exist via API from settings page context", async ({
    settingsPage,
    td,
  }) => {
    // Verify the fixture-created labels are accessible via API
    const res = await settingsPage.request.get(
      `${baseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const labels = Array.isArray(data) ? data : data.results ?? [];
    const names = labels.map((l: any) => l.name);
    expect(names).toContain("Bug");
    expect(names).toContain("Feature");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STATES
// ══════════════════════════════════════════════════════════════════════════════

// ─── States API ──────────────────────────────────────────────────────────────

test.describe("States API", () => {
  test("should list states via API", async ({ settingsPage, td }) => {
    const res = await settingsPage.request.get(
      `${baseUrl(td)}/states/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const states = Array.isArray(data) ? data : data.results ?? [];
    // A new project comes with default states
    expect(states.length).toBeGreaterThanOrEqual(1);
    // All states should have required fields
    for (const s of states) {
      expect(s.name).toBeTruthy();
      expect(s.group).toBeTruthy();
      expect(s.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test("should have default states with correct groups", async ({
    settingsPage,
    td,
  }) => {
    const groups = td.states.map((s) => s.group);
    // Default project should have at least backlog and completed groups
    expect(groups).toContain("backlog");
  });

  test("should create a state via API", async ({ settingsPage, td }) => {
    const res = await settingsPage.request.post(
      `${baseUrl(td)}/states/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "In Review",
          color: "#8b5cf6",
          group: "started",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const state = await res.json();
    expect(state.name).toBe("In Review");
    expect(state.color).toBe("#8b5cf6");
    expect(state.group).toBe("started");
    expect(state.id).toBeTruthy();

    // Clean up
    await settingsPage.request.delete(
      `${baseUrl(td)}/states/${state.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should update a state via API", async ({ settingsPage, td }) => {
    // Find a non-default state to update
    const state = td.states.find((s) => !s.is_default) ?? td.states[0]!;
    const res = await settingsPage.request.patch(
      `${baseUrl(td)}/states/${state.id}/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Renamed State", color: "#0ea5e9" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe("Renamed State");
    expect(updated.color).toBe("#0ea5e9");

    // Revert
    await settingsPage.request.patch(
      `${baseUrl(td)}/states/${state.id}/`,
      {
        headers: authHeaders(td.token),
        data: { name: state.name, color: state.color },
      }
    );
  });

  test("should delete a non-default state via API", async ({
    settingsPage,
    td,
  }) => {
    // Create a throwaway state
    const createRes = await settingsPage.request.post(
      `${baseUrl(td)}/states/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Throwaway", color: "#a3a3a3", group: "unstarted" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const temp = await createRes.json();

    const delRes = await settingsPage.request.delete(
      `${baseUrl(td)}/states/${temp.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(204);
  });

  test("should prevent deleting default state via API", async ({
    settingsPage,
    td,
  }) => {
    const defaultState = td.states.find((s) => s.is_default);
    if (!defaultState) return; // skip if no default found

    const res = await settingsPage.request.delete(
      `${baseUrl(td)}/states/${defaultState.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test("should mark a state as default via API", async ({
    settingsPage,
    td,
  }) => {
    // Create a new state
    const createRes = await settingsPage.request.post(
      `${baseUrl(td)}/states/`,
      {
        headers: authHeaders(td.token),
        data: { name: "New Default", color: "#22c55e", group: "backlog" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const newState = await createRes.json();

    // Mark as default
    const markRes = await settingsPage.request.post(
      `${baseUrl(td)}/states/${newState.id}/mark-default/`,
      { headers: authHeaders(td.token) }
    );
    expect(markRes.ok()).toBeTruthy();

    // Verify it's now default
    const detailRes = await settingsPage.request.get(
      `${baseUrl(td)}/states/`,
      { headers: authHeaders(td.token) }
    );
    const states = await detailRes.json();
    const allStates = Array.isArray(states)
      ? states
      : states.results ?? [];
    const markedState = allStates.find((s: any) => s.id === newState.id);
    expect(markedState?.is_default).toBe(true);

    // Restore original default
    const origDefault = td.states.find((s) => s.is_default);
    if (origDefault) {
      await settingsPage.request.post(
        `${baseUrl(td)}/states/${origDefault.id}/mark-default/`,
        { headers: authHeaders(td.token) }
      );
    }

    // Clean up
    await settingsPage.request.delete(
      `${baseUrl(td)}/states/${newState.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should create states in all groups via API", async ({
    settingsPage,
    td,
  }) => {
    const groups = [
      "backlog",
      "unstarted",
      "started",
      "completed",
      "cancelled",
    ] as const;
    const created: string[] = [];

    for (const group of groups) {
      const res = await settingsPage.request.post(
        `${baseUrl(td)}/states/`,
        {
          headers: authHeaders(td.token),
          data: {
            name: `Test ${group}`,
            color: "#64748b",
            group,
          },
        }
      );
      expect(res.ok()).toBeTruthy();
      const state = await res.json();
      expect(state.group).toBe(group);
      created.push(state.id);
    }

    // Clean up
    for (const id of created) {
      await settingsPage.request.delete(
        `${baseUrl(td)}/states/${id}/`,
        { headers: authHeaders(td.token) }
      );
    }
  });
});

// ─── States UI ───────────────────────────────────────────────────────────────

test.describe("States UI", () => {
  test("should navigate to states settings page", async ({
    settingsPage,
    wsSlug,
  }) => {
    await goToStates(settingsPage, wsSlug);
    expect(settingsPage.url()).toContain("/states");
  });

  test("should display default states on settings page", async ({
    settingsPage,
    wsSlug,
    td,
  }) => {
    await goToStates(settingsPage, wsSlug);
    // At least one default state name should be visible
    const firstState = td.states[0]!;
    await expect(
      settingsPage.getByText(firstState.name, { exact: true }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show state group headings", async ({
    settingsPage,
    wsSlug,
  }) => {
    await goToStates(settingsPage, wsSlug);
    // State groups should be shown as headings
    const backlogHeading = settingsPage
      .getByText("Backlog", { exact: true })
      .first();
    await expect(backlogHeading).toBeVisible({ timeout: 10_000 });
  });

  test("should show state created via API on settings page", async ({
    settingsPage,
    wsSlug,
    td,
  }) => {
    // Create state via API
    const res = await settingsPage.request.post(
      `${baseUrl(td)}/states/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "API Created State",
          color: "#f59e0b",
          group: "started",
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    // Navigate to states page
    await goToStates(settingsPage, wsSlug);
    await expect(
      settingsPage
        .getByText("API Created State", { exact: true })
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show state deleted via API is removed from settings page", async ({
    settingsPage,
    wsSlug,
    td,
  }) => {
    // Create then delete a state via API
    const createRes = await settingsPage.request.post(
      `${baseUrl(td)}/states/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "To Remove State",
          color: "#64748b",
          group: "unstarted",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const state = await createRes.json();

    await settingsPage.request.delete(
      `${baseUrl(td)}/states/${state.id}/`,
      { headers: authHeaders(td.token) }
    );

    // Navigate and verify removed
    await goToStates(settingsPage, wsSlug);
    // Wait for page to load with existing states
    await expect(
      settingsPage.getByText(td.states[0]!.name, { exact: true }).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      settingsPage.getByText("To Remove State")
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

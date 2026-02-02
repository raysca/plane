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
  viewId: string;
  viewName: string;
  secondViewId: string;
  secondViewName: string;
  issueIds: string[];
  issueNames: string[];
}

// ── Fixture: authenticated page with views test data ─────────────────────────

type Fixtures = {
  viewPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("viw-ui"));
  },

  viewPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("viw-ui");
      const password = generateTestPassword();
      const identifier = `V${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "View",
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
          first_name: "View",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "View Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "View Project", identifier, network: 2 },
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

      // 7. Create view "Bug Tracker"
      const viewRes = await request.post(`${base_url}/views/`, {
        headers: headers(token),
        data: {
          name: "Bug Tracker",
          description: "View for tracking bugs",
          query: {},
          query_data: {},
          filters: {},
        },
      });
      expect(viewRes.ok()).toBeTruthy();
      const view = await viewRes.json();

      // 8. Create view "Sprint Board"
      const view2Res = await request.post(`${base_url}/views/`, {
        headers: headers(token),
        data: {
          name: "Sprint Board",
          description: "Board view for sprints",
          query: {},
          query_data: {},
          filters: {},
        },
      });
      expect(view2Res.ok()).toBeTruthy();
      const view2 = await view2Res.json();

      // 9. Create 2 issues for the project
      const issueNames = ["View Issue One", "View Issue Two"];
      const issueIds: string[] = [];
      for (const name of issueNames) {
        const res = await request.post(`${base_url}/issues/`, {
          headers: headers(token),
          data: { name },
        });
        expect(res.ok()).toBeTruthy();
        const issue = await res.json();
        issueIds.push(issue.id);
      }

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        identifier,
        states,
        viewId: view.id,
        viewName: "Bug Tracker",
        secondViewId: view2.id,
        secondViewName: "Sprint Board",
        issueIds,
        issueNames,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ viewPage }, use) => {
    await use((viewPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function goToViews(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/views/`);
  await waitForAppReady(page);
}

async function goToViewDetail(
  page: Page,
  wsSlug: string,
  viewId: string
) {
  const projectId = (page as any).__projectId;
  await page.goto(
    `/${wsSlug}/projects/${projectId}/views/${viewId}`
  );
  await waitForAppReady(page);
}

async function goToWorkItems(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/`);
  await waitForAppReady(page);
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Views List Page ──────────────────────────────────────────────────────

test.describe("Views List Page", () => {
  test("should navigate to views list page", async ({
    viewPage,
    wsSlug,
  }) => {
    await goToViews(viewPage, wsSlug);
    // Verify we're on the views page - look for "Add view" button
    const addBtn = viewPage
      .getByRole("button", { name: /add view/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should show Views sidebar link", async ({ viewPage, wsSlug }) => {
    await goToWorkItems(viewPage, wsSlug);
    const viewsLink = viewPage
      .getByText("Views", { exact: true })
      .first();
    await expect(viewsLink).toBeVisible({ timeout: 5_000 });
  });

  test("should display existing views in the list", async ({
    viewPage,
    wsSlug,
    td,
  }) => {
    await goToViews(viewPage, wsSlug);
    await expect(
      viewPage.getByText(td.viewName).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      viewPage.getByText(td.secondViewName).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ─── 2. View Creation ────────────────────────────────────────────────────────

test.describe("View Creation", () => {
  test("should create a view via modal with name only", async ({
    viewPage,
    wsSlug,
  }) => {
    await goToViews(viewPage, wsSlug);

    // Click "Add view" button
    const addBtn = viewPage
      .getByRole("button", { name: /add view/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Wait for modal
    await viewPage.waitForTimeout(500);

    // Fill in view name
    const nameInput = viewPage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("New Test View");

    // Click "Create View" button
    const createBtn = viewPage
      .getByRole("button", { name: /create view/i })
      .first();
    await expect(createBtn).toBeVisible({ timeout: 3_000 });
    await createBtn.click();

    // Wait for modal to close and verify view appears in list
    await viewPage.waitForTimeout(1_000);
    await expect(
      viewPage.getByText("New Test View").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should create a view with name and description", async ({
    viewPage,
    wsSlug,
  }) => {
    await goToViews(viewPage, wsSlug);

    const addBtn = viewPage
      .getByRole("button", { name: /add view/i })
      .first();
    await addBtn.click();
    await viewPage.waitForTimeout(500);

    // Fill name
    const nameInput = viewPage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Described View");

    // Fill description
    const descInput = viewPage.getByPlaceholder("Description").first();
    await expect(descInput).toBeVisible({ timeout: 3_000 });
    await descInput.fill("A view with a description");

    // Submit
    const createBtn = viewPage
      .getByRole("button", { name: /create view/i })
      .first();
    await createBtn.click();

    await viewPage.waitForTimeout(1_000);
    await expect(
      viewPage.getByText("Described View").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should cancel view creation", async ({ viewPage, wsSlug }) => {
    await goToViews(viewPage, wsSlug);

    const addBtn = viewPage
      .getByRole("button", { name: /add view/i })
      .first();
    await addBtn.click();
    await viewPage.waitForTimeout(500);

    // Fill name
    const nameInput = viewPage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Should Not Exist");

    // Click cancel
    const cancelBtn = viewPage
      .getByRole("button", { name: "Cancel", exact: true })
      .first();
    await cancelBtn.click();

    // Verify modal closed and view doesn't exist
    await viewPage.waitForTimeout(500);
    await expect(
      viewPage.getByText("Should Not Exist")
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── 3. View Detail Page ─────────────────────────────────────────────────────

test.describe("View Detail Page", () => {
  test("should navigate to view detail page", async ({
    viewPage,
    wsSlug,
    td,
  }) => {
    await goToViewDetail(viewPage, wsSlug, td.viewId);
    // View should load — verify the URL contains the view ID
    await expect(viewPage).toHaveURL(
      new RegExp(`/views/${td.viewId}`),
      { timeout: 10_000 }
    );
  });

  test("should show project issues within the view", async ({
    viewPage,
    wsSlug,
    td,
  }) => {
    await goToViewDetail(viewPage, wsSlug, td.viewId);
    // Issues in the project should be visible in the view
    // (default view with no filters shows all issues)
    await expect(
      viewPage.getByText(td.issueNames[0]!).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 4. View Update ──────────────────────────────────────────────────────────

test.describe("View Update", () => {
  test("should rename a view via API and verify in UI", async ({
    viewPage,
    wsSlug,
    td,
  }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
    const res = await viewPage.request.patch(
      `${base_url}/views/${td.secondViewId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Sprint Board Renamed" },
      }
    );
    expect(res.ok()).toBeTruthy();

    await goToViews(viewPage, wsSlug);
    await expect(
      viewPage.getByText("Sprint Board Renamed").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should update view description via API", async ({
    viewPage,
    td,
  }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await viewPage.request.patch(
      `${base_url}/views/${td.viewId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { description: "Updated bug tracking description" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.description).toBe("Updated bug tracking description");
  });
});

// ─── 5. View Delete ──────────────────────────────────────────────────────────

test.describe("View Delete", () => {
  test("should delete a view via API and verify removal from UI", async ({
    viewPage,
    wsSlug,
    td,
  }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
    const res = await viewPage.request.delete(
      `${base_url}/views/${td.secondViewId}/`
    );
    expect(res.ok()).toBeTruthy();

    await goToViews(viewPage, wsSlug);
    await expect(
      viewPage.getByText(td.viewName).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      viewPage.getByText(td.secondViewName)
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

// ─── 6. View API Endpoints ───────────────────────────────────────────────────

test.describe("View API Endpoints", () => {
  test("should list views via API", async ({ viewPage, td }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await viewPage.request.get(`${base_url}/views/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const views = Array.isArray(data) ? data : data.results ?? [];
    expect(views.length).toBeGreaterThanOrEqual(2);

    const names = views.map((v: any) => v.name);
    expect(names).toContain(td.viewName);
    expect(names).toContain(td.secondViewName);
  });

  test("should get view detail via API", async ({ viewPage, td }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await viewPage.request.get(
      `${base_url}/views/${td.viewId}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(res.ok()).toBeTruthy();
    const view = await res.json();
    expect(view.name).toBe(td.viewName);
    expect(view.description).toBe("View for tracking bugs");
  });

  test("should create view with all fields via API", async ({
    viewPage,
    td,
  }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await viewPage.request.post(`${base_url}/views/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: {
        name: "Full View",
        description: "A fully specified view",
        query: { state: "backlog" },
        query_data: {},
        filters: {},
        access: 1,
        is_locked: false,
      },
    });
    expect(res.ok()).toBeTruthy();
    const view = await res.json();
    expect(view.name).toBe("Full View");
    expect(view.access).toBe(1);
    expect(view.is_locked).toBe(false);

    // Clean up
    await viewPage.request.delete(`${base_url}/views/${view.id}/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
  });

  test("should update view via API", async ({ viewPage, td }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await viewPage.request.patch(
      `${base_url}/views/${td.viewId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Bug Tracker Updated" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe("Bug Tracker Updated");

    // Revert
    await viewPage.request.patch(
      `${base_url}/views/${td.viewId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: td.viewName },
      }
    );
  });

  test("should favorite and unfavorite a view via API", async ({
    viewPage,
    td,
  }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Add to favorites
    const favRes = await viewPage.request.post(
      `${base_url}/user-favorite-views/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { view: td.viewId },
      }
    );
    expect(favRes.ok()).toBeTruthy();

    // Verify view detail shows as favorite
    const detailRes = await viewPage.request.get(
      `${base_url}/views/${td.viewId}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(detailRes.ok()).toBeTruthy();
    const viewDetail = await detailRes.json();
    expect(viewDetail.is_favorite).toBe(true);

    // Remove from favorites
    const unfavRes = await viewPage.request.delete(
      `${base_url}/user-favorite-views/${td.viewId}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(unfavRes.ok()).toBeTruthy();
  });

  test("should delete view via API and verify 404", async ({
    viewPage,
    td,
  }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Create a throwaway view
    const createRes = await viewPage.request.post(
      `${base_url}/views/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "To Be Deleted" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const toDelete = await createRes.json();

    // Delete it
    const delRes = await viewPage.request.delete(
      `${base_url}/views/${toDelete.id}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(delRes.status()).toBe(204);

    // Verify 404 on fetch
    const fetchRes = await viewPage.request.get(
      `${base_url}/views/${toDelete.id}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(fetchRes.ok()).toBeFalsy();
  });

  test("should create private view via API", async ({
    viewPage,
    td,
  }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await viewPage.request.post(`${base_url}/views/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: {
        name: "Private View",
        access: 0,
      },
    });
    expect(res.ok()).toBeTruthy();
    const view = await res.json();
    expect(view.name).toBe("Private View");
    expect(view.access).toBe(0);

    // Clean up
    await viewPage.request.delete(`${base_url}/views/${view.id}/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
  });

  test("should lock and unlock a view via API", async ({
    viewPage,
    td,
  }) => {
    const projectId = (viewPage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Lock the view
    const lockRes = await viewPage.request.patch(
      `${base_url}/views/${td.viewId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_locked: true },
      }
    );
    expect(lockRes.ok()).toBeTruthy();
    const locked = await lockRes.json();
    expect(locked.is_locked).toBe(true);

    // Unlock the view
    const unlockRes = await viewPage.request.patch(
      `${base_url}/views/${td.viewId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_locked: false },
      }
    );
    expect(unlockRes.ok()).toBeTruthy();
    const unlocked = await unlockRes.json();
    expect(unlocked.is_locked).toBe(false);
  });
});

// ─── 7. Navigation ──────────────────────────────────────────────────────────

test.describe("Navigation", () => {
  test("should navigate from views list to view detail by clicking", async ({
    viewPage,
    wsSlug,
    td,
  }) => {
    await goToViews(viewPage, wsSlug);

    const viewLink = viewPage.getByText(td.viewName).first();
    await expect(viewLink).toBeVisible({ timeout: 10_000 });
    await viewLink.click();

    await waitForAppReady(viewPage);
    await expect(viewPage).toHaveURL(
      new RegExp(`/views/${td.viewId}`),
      { timeout: 10_000 }
    );
  });

  test("should navigate back to views list from detail page", async ({
    viewPage,
    wsSlug,
    td,
  }) => {
    await goToViewDetail(viewPage, wsSlug, td.viewId);

    // Wait for page load
    await viewPage.waitForTimeout(1_000);

    // Click "Views" breadcrumb or sidebar link
    const viewsLink = viewPage
      .getByText("Views", { exact: true })
      .first();
    await expect(viewsLink).toBeVisible({ timeout: 5_000 });
    await viewsLink.click();

    await waitForAppReady(viewPage);
    await expect(viewPage).toHaveURL(/\/views\/?$/, {
      timeout: 10_000,
    });
  });
});

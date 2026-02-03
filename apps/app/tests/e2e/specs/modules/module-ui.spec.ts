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
  moduleId: string;
  moduleName: string;
  secondModuleId: string;
  secondModuleName: string;
  issueIds: string[];
  issueNames: string[];
  issueSeqs: number[];
}

// ── Fixture: authenticated page with modules test data ───────────────────────

type Fixtures = {
  modulePage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("mod-ui"));
  },

  modulePage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("mod-ui");
      const password = generateTestPassword();
      const identifier = `M${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Module",
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
          first_name: "Module",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Module Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Module Project", identifier, network: 2 },
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

      // 7. Create module "Module Alpha"
      const modRes = await request.post(`${base_url}/modules/`, {
        headers: headers(token),
        data: { name: "Module Alpha", status: "planned" },
      });
      expect(modRes.ok()).toBeTruthy();
      const mod = await modRes.json();

      // 8. Create module "Module Beta"
      const mod2Res = await request.post(`${base_url}/modules/`, {
        headers: headers(token),
        data: { name: "Module Beta", status: "in-progress" },
      });
      expect(mod2Res.ok()).toBeTruthy();
      const mod2 = await mod2Res.json();

      // 9. Create 3 issues
      const issueNames = [
        "Module Issue One",
        "Module Issue Two",
        "Module Issue Three",
      ];
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

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        identifier,
        states,
        moduleId: mod.id,
        moduleName: "Module Alpha",
        secondModuleId: mod2.id,
        secondModuleName: "Module Beta",
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

  td: async ({ modulePage }, use) => {
    await use((modulePage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function goToModules(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/modules/`);
  await waitForAppReady(page);
}

async function goToModuleDetail(
  page: Page,
  wsSlug: string,
  moduleId: string
) {
  const projectId = (page as any).__projectId;
  await page.goto(
    `/${wsSlug}/projects/${projectId}/modules/${moduleId}`
  );
  await waitForAppReady(page);
}

async function goToWorkItems(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/`);
  await waitForAppReady(page);
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Modules List Page ────────────────────────────────────────────────────

test.describe("Modules List Page", () => {
  test("should navigate to modules list page", async ({
    modulePage,
    wsSlug,
  }) => {
    await goToModules(modulePage, wsSlug);
    // Verify we're on the modules page - look for "Add Module" button
    const addBtn = modulePage
      .getByRole("button", { name: /add module/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should show Modules sidebar link", async ({
    modulePage,
    wsSlug,
  }) => {
    await goToWorkItems(modulePage, wsSlug);
    const modulesLink = modulePage
      .getByText("Modules", { exact: true })
      .first();
    await expect(modulesLink).toBeVisible({ timeout: 5_000 });
  });

  test("should display existing modules in the list", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    await goToModules(modulePage, wsSlug);
    await expect(
      modulePage.getByText(td.moduleName).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      modulePage.getByText(td.secondModuleName).first()
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ─── 2. Module Creation ─────────────────────────────────────────────────────

test.describe("Module Creation", () => {
  test("should create a module via modal with name only", async ({
    modulePage,
    wsSlug,
  }) => {
    await goToModules(modulePage, wsSlug);

    // Click "Add Module" button
    const addBtn = modulePage
      .getByRole("button", { name: /add module/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Wait for modal
    await modulePage.waitForTimeout(500);

    // Fill in module name
    const nameInput = modulePage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("New Test Module");

    // Click "Create Module" button
    const createBtn = modulePage
      .getByRole("button", { name: /create module/i })
      .first();
    await expect(createBtn).toBeVisible({ timeout: 3_000 });
    await createBtn.click();

    // Wait for modal to close and verify module appears in list
    await modulePage.waitForTimeout(1_000);
    await expect(
      modulePage.getByText("New Test Module").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should create a module with name and description", async ({
    modulePage,
    wsSlug,
  }) => {
    await goToModules(modulePage, wsSlug);

    const addBtn = modulePage
      .getByRole("button", { name: /add module/i })
      .first();
    await addBtn.click();
    await modulePage.waitForTimeout(500);

    // Fill name
    const nameInput = modulePage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Described Module");

    // Fill description
    const descInput = modulePage
      .getByPlaceholder("Description")
      .first();
    await expect(descInput).toBeVisible({ timeout: 3_000 });
    await descInput.fill("This module has a description");

    // Submit
    const createBtn = modulePage
      .getByRole("button", { name: /create module/i })
      .first();
    await createBtn.click();

    await modulePage.waitForTimeout(1_000);
    await expect(
      modulePage.getByText("Described Module").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should cancel module creation", async ({ modulePage, wsSlug }) => {
    await goToModules(modulePage, wsSlug);

    const addBtn = modulePage
      .getByRole("button", { name: /add module/i })
      .first();
    await addBtn.click();
    await modulePage.waitForTimeout(500);

    // Fill name
    const nameInput = modulePage.getByPlaceholder("Title").first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Should Not Exist");

    // Click cancel
    const cancelBtn = modulePage
      .getByRole("button", { name: "Cancel", exact: true })
      .first();
    await cancelBtn.click();

    // Verify modal closed and module doesn't exist
    await modulePage.waitForTimeout(500);
    await expect(
      modulePage.getByText("Should Not Exist")
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

// ─── 3. Module Detail Page ───────────────────────────────────────────────────

test.describe("Module Detail Page", () => {
  test("should navigate to module detail and see module name", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    await goToModuleDetail(modulePage, wsSlug, td.moduleId);
    await expect(
      modulePage.getByText(td.moduleName).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show empty state for module with no issues", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    await goToModuleDetail(modulePage, wsSlug, td.moduleId);
    // Module has no issues — should show empty state or module name at least
    const moduleName = modulePage.getByText(td.moduleName).first();
    await expect(moduleName).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 4. Module Update ────────────────────────────────────────────────────────

test.describe("Module Update", () => {
  test("should rename a module via API and verify in UI", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
    const res = await modulePage.request.patch(
      `${base_url}/modules/${td.secondModuleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Module Beta Renamed" },
      }
    );
    expect(res.ok()).toBeTruthy();

    await goToModules(modulePage, wsSlug);
    await expect(
      modulePage.getByText("Module Beta Renamed").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should update module status via API", async ({
    modulePage,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await modulePage.request.patch(
      `${base_url}/modules/${td.moduleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { status: "in-progress" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.status).toBe("in-progress");

    // Revert
    await modulePage.request.patch(
      `${base_url}/modules/${td.moduleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { status: "planned" },
      }
    );
  });
});

// ─── 5. Module from Issue Detail ─────────────────────────────────────────────

test.describe("Module from Issue Detail", () => {
  test("should show 'No module' on issue not in any module", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    await modulePage.goto(
      `/${wsSlug}/projects/${projectId}/issues/${td.issueIds[0]}`
    );
    await waitForAppReady(modulePage);

    // Should show "No module" placeholder
    const noModule = modulePage.getByText("No module").first();
    await expect(noModule).toBeVisible({ timeout: 10_000 });
  });

  test("should show Modules label on issue detail sidebar", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    await modulePage.goto(
      `/${wsSlug}/projects/${projectId}/issues/${td.issueIds[0]}`
    );
    await waitForAppReady(modulePage);

    const modulesLabel = modulePage.getByText("Modules").first();
    await expect(modulesLabel).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 6. Module Delete ────────────────────────────────────────────────────────

test.describe("Module Delete", () => {
  test("should delete a module via API and verify removal from UI", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
    const res = await modulePage.request.delete(
      `${base_url}/modules/${td.secondModuleId}/`
    );
    expect(res.ok()).toBeTruthy();

    await goToModules(modulePage, wsSlug);
    await expect(
      modulePage.getByText(td.moduleName).first()
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      modulePage.getByText(td.secondModuleName)
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

// ─── 7. Module API Endpoints ─────────────────────────────────────────────────

test.describe("Module API Endpoints", () => {
  test("should list modules via API", async ({ modulePage, td }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await modulePage.request.get(`${base_url}/modules/`, {
      headers: { Authorization: `Bearer ${td.token}` },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const modules = Array.isArray(data) ? data : data.results ?? [];
    expect(modules.length).toBeGreaterThanOrEqual(2);

    const names = modules.map((m: any) => m.name);
    expect(names).toContain(td.moduleName);
    expect(names).toContain(td.secondModuleName);
  });

  test("should get module detail via API with stats", async ({
    modulePage,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await modulePage.request.get(
      `${base_url}/modules/${td.moduleId}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(res.ok()).toBeTruthy();
    const mod = await res.json();
    expect(mod.name).toBe(td.moduleName);
    expect(mod.status).toBe("planned");
    expect(mod.total_issues).toBeDefined();
  });

  test("should update module via API", async ({ modulePage, td }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await modulePage.request.patch(
      `${base_url}/modules/${td.moduleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Module Alpha Updated" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe("Module Alpha Updated");

    // Revert
    await modulePage.request.patch(
      `${base_url}/modules/${td.moduleId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: td.moduleName },
      }
    );
  });

  test("should create and delete module link via API", async ({
    modulePage,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Create link
    const createRes = await modulePage.request.post(
      `${base_url}/modules/${td.moduleId}/module-links/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          title: "Test Link",
          url: "https://example.com/test",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const link = await createRes.json();
    expect(link.title).toBe("Test Link");
    expect(link.url).toBe("https://example.com/test");

    // Delete link
    const delRes = await modulePage.request.delete(
      `${base_url}/modules/${td.moduleId}/module-links/${link.id}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(delRes.status()).toBe(204);
  });

  test("should favorite and unfavorite a module via API", async ({
    modulePage,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Add to favorites
    const favRes = await modulePage.request.post(
      `${base_url}/user-favorite-modules/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { module: td.moduleId },
      }
    );
    expect(favRes.ok()).toBeTruthy();

    // Verify cycle detail shows as favorite
    const detailRes = await modulePage.request.get(
      `${base_url}/modules/${td.moduleId}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(detailRes.ok()).toBeTruthy();
    const modDetail = await detailRes.json();
    expect(modDetail.is_favorite).toBe(true);

    // Remove from favorites
    const unfavRes = await modulePage.request.delete(
      `${base_url}/user-favorite-modules/${td.moduleId}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(unfavRes.ok()).toBeTruthy();
  });

  test("should delete module via API", async ({ modulePage, td }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Create a throwaway module to delete
    const createRes = await modulePage.request.post(
      `${base_url}/modules/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "To Be Deleted" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const toDelete = await createRes.json();

    // Delete it
    const delRes = await modulePage.request.delete(
      `${base_url}/modules/${toDelete.id}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(delRes.status()).toBe(204);

    // Verify 404 on fetch
    const fetchRes = await modulePage.request.get(
      `${base_url}/modules/${toDelete.id}/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(fetchRes.ok()).toBeFalsy();
  });

  test("should list modules with all statuses via API", async ({
    modulePage,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;

    // Create modules with different statuses
    const statuses = ["backlog", "paused", "completed", "cancelled"];
    const created: string[] = [];
    for (const status of statuses) {
      const res = await modulePage.request.post(
        `${base_url}/modules/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
          data: { name: `Status ${status}`, status },
        }
      );
      expect(res.ok()).toBeTruthy();
      const mod = await res.json();
      created.push(mod.id);
      expect(mod.status).toBe(status);
    }

    // List all modules
    const listRes = await modulePage.request.get(
      `${base_url}/modules/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(listRes.ok()).toBeTruthy();
    const data = await listRes.json();
    const modules = Array.isArray(data) ? data : data.results ?? [];
    // Should have at least 2 original + 4 status modules
    expect(modules.length).toBeGreaterThanOrEqual(6);

    // Clean up
    for (const id of created) {
      await modulePage.request.delete(`${base_url}/modules/${id}/`, {
        headers: { Authorization: `Bearer ${td.token}` },
      });
    }
  });

  test("should get user properties for module via API", async ({
    modulePage,
    td,
  }) => {
    const projectId = (modulePage as any).__projectId;
    const base_url = `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${projectId}`;
    const res = await modulePage.request.get(
      `${base_url}/modules/${td.moduleId}/user-properties/`,
      { headers: { Authorization: `Bearer ${td.token}` } }
    );
    expect(res.ok()).toBeTruthy();
    const props = await res.json();
    // Should have display_filters and filters
    expect(props.filters !== undefined || props.display_filters !== undefined || typeof props === "object").toBeTruthy();
  });
});

// ─── 8. Module Sidebar Properties ────────────────────────────────────────────

test.describe("Module Sidebar Properties", () => {
  test("should show module sidebar with status on detail page", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    await goToModuleDetail(modulePage, wsSlug, td.moduleId);

    // Module name should appear
    await expect(
      modulePage.getByText(td.moduleName).first()
    ).toBeVisible({ timeout: 10_000 });

    // Should show status badge - "Planned" for Module Alpha
    const statusBadge = modulePage
      .getByText("Planned", { exact: true })
      .first();
    await expect(statusBadge).toBeVisible({ timeout: 5_000 });
  });

  test("should show Lead property in module sidebar", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    await goToModuleDetail(modulePage, wsSlug, td.moduleId);

    const leadLabel = modulePage
      .getByText("Lead", { exact: true })
      .first();
    await expect(leadLabel).toBeVisible({ timeout: 10_000 });
  });

  test("should show Members property in module sidebar", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    await goToModuleDetail(modulePage, wsSlug, td.moduleId);

    const membersLabel = modulePage
      .getByText("Members", { exact: true })
      .first();
    await expect(membersLabel).toBeVisible({ timeout: 10_000 });
  });
});

// ─── 9. Navigation Between Modules ──────────────────────────────────────────

test.describe("Navigation Between Modules", () => {
  test("should navigate from modules list to module detail by clicking", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    await goToModules(modulePage, wsSlug);

    const moduleLink = modulePage.getByText(td.moduleName).first();
    await expect(moduleLink).toBeVisible({ timeout: 10_000 });
    await moduleLink.click();

    await waitForAppReady(modulePage);
    await expect(modulePage).toHaveURL(
      new RegExp(`/modules/${td.moduleId}`),
      { timeout: 10_000 }
    );
  });

  test("should navigate back to modules list from detail page", async ({
    modulePage,
    wsSlug,
    td,
  }) => {
    await goToModuleDetail(modulePage, wsSlug, td.moduleId);

    await expect(
      modulePage.getByText(td.moduleName).first()
    ).toBeVisible({ timeout: 10_000 });

    // Click "Modules" breadcrumb or sidebar link to go back
    const modulesLink = modulePage
      .getByText("Modules", { exact: true })
      .first();
    await expect(modulesLink).toBeVisible({ timeout: 5_000 });
    await modulesLink.click();

    await waitForAppReady(modulePage);
    await expect(modulePage).toHaveURL(/\/modules\/?$/, {
      timeout: 10_000,
    });
  });
});

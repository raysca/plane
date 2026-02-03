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
  projectName: string;
  cycleId: string;
  cycleName: string;
  moduleId: string;
  moduleName: string;
  viewId: string;
  viewName: string;
  pageId: string;
  pageName: string;
}

// ── Fixture: authenticated page with favorites test data ────────────────────

type Fixtures = {
  favoritesPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("fav-ui"));
  },

  favoritesPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("fav-ui");
      const password = generateTestPassword();
      const projectName = `Favorites Project ${Date.now().toString(36).slice(-4)}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Favorites",
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
          first_name: "Favorites",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Favorites Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const identifier = `F${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: projectName, identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;
      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Create a cycle
      const cycleName = "Fav Cycle";
      const cycleRes = await request.post(`${base_url}/cycles/`, {
        headers: headers(token),
        data: { name: cycleName },
      });
      expect(cycleRes.ok()).toBeTruthy();
      const cycle = await cycleRes.json();

      // 7. Create a module
      const moduleName = "Fav Module";
      const moduleRes = await request.post(`${base_url}/modules/`, {
        headers: headers(token),
        data: { name: moduleName },
      });
      expect(moduleRes.ok()).toBeTruthy();
      const mod = await moduleRes.json();

      // 8. Create a view
      const viewName = "Fav View";
      const viewRes = await request.post(`${base_url}/views/`, {
        headers: headers(token),
        data: { name: viewName, filters: {} },
      });
      expect(viewRes.ok()).toBeTruthy();
      const view = await viewRes.json();

      // 9. Create a page
      const pageName = "Fav Page";
      const pageRes = await request.post(`${base_url}/pages/`, {
        headers: headers(token),
        data: { name: pageName },
      });
      expect(pageRes.ok()).toBeTruthy();
      const pg = await pageRes.json();

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        projectName,
        cycleId: cycle.id,
        cycleName,
        moduleId: mod.id,
        moduleName,
        viewId: view.id,
        viewName,
        pageId: pg.id,
        pageName,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ favoritesPage }, use) => {
    await use((favoritesPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function apiUrl(wsSlug: string): string {
  return `${API_BASE}/api/workspaces/${wsSlug}`;
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Create Favorites ─────────────────────────────────────────────────────

test.describe("Create Favorites", () => {
  test("should create a project favorite via API", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const fav = await res.json();

    // Validate response format
    expect(fav.id).toBeDefined();
    expect(fav.entity_type).toBe("project");
    expect(fav.entity_identifier).toBe(td.projectId);
    expect(fav.entity_data).toBeDefined();
    expect(fav.entity_data.id).toBe(td.projectId);
    expect(fav.entity_data.name).toBe(td.projectName);
    expect(fav.is_folder).toBe(false);
    expect(fav.workspace_id).toBeDefined();
    expect(fav.parent).toBeNull();
    expect(typeof fav.sequence).toBe("number");
  });

  test("should create a cycle favorite via API", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "cycle",
          entity_identifier: td.cycleId,
          project_id: td.projectId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const fav = await res.json();

    expect(fav.entity_type).toBe("cycle");
    expect(fav.entity_identifier).toBe(td.cycleId);
    expect(fav.entity_data).toBeDefined();
    expect(fav.entity_data.name).toBe(td.cycleName);
    expect(fav.project_id).toBe(td.projectId);
  });

  test("should create a module favorite via API", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "module",
          entity_identifier: td.moduleId,
          project_id: td.projectId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const fav = await res.json();

    expect(fav.entity_type).toBe("module");
    expect(fav.entity_identifier).toBe(td.moduleId);
    expect(fav.entity_data.name).toBe(td.moduleName);
  });

  test("should create a view favorite via API", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "view",
          entity_identifier: td.viewId,
          project_id: td.projectId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const fav = await res.json();

    expect(fav.entity_type).toBe("view");
    expect(fav.entity_identifier).toBe(td.viewId);
    expect(fav.entity_data.name).toBe(td.viewName);
  });

  test("should create a page favorite via API", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "page",
          entity_identifier: td.pageId,
          project_id: td.projectId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const fav = await res.json();

    expect(fav.entity_type).toBe("page");
    expect(fav.entity_identifier).toBe(td.pageId);
    expect(fav.entity_data.name).toBe(td.pageName);
  });

  test("should create a folder favorite via API", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: "My Folder",
          is_folder: true,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const fav = await res.json();

    expect(fav.entity_type).toBe("folder");
    expect(fav.name).toBe("My Folder");
    expect(fav.is_folder).toBe(true);
    expect(fav.entity_identifier).toBeNull();
  });

  test("should return existing favorite if duplicate", async ({
    favoritesPage,
    td,
  }) => {
    // Create first
    const res1 = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );
    expect(res1.ok()).toBeTruthy();
    const fav1 = await res1.json();

    // Create duplicate
    const res2 = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );
    expect(res2.ok()).toBeTruthy();
    const fav2 = await res2.json();

    // Should return the same favorite
    expect(fav2.id).toBe(fav1.id);
  });
});

// ─── 2. List Favorites ───────────────────────────────────────────────────────

test.describe("List Favorites", () => {
  test("should list all top-level favorites via API", async ({
    favoritesPage,
    td,
  }) => {
    // Create some favorites first
    await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );

    await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "cycle",
          entity_identifier: td.cycleId,
          project_id: td.projectId,
        },
      }
    );

    // List favorites
    const res = await favoritesPage.request.get(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const favorites = await res.json();

    expect(Array.isArray(favorites)).toBe(true);
    expect(favorites.length).toBeGreaterThanOrEqual(2);

    // Each favorite should have proper structure
    for (const fav of favorites) {
      expect(fav.id).toBeDefined();
      expect(fav.entity_type).toBeDefined();
      expect(fav.workspace_id).toBeDefined();
      expect(typeof fav.sequence).toBe("number");
    }
  });

  test("should return empty array when no favorites exist", async ({
    favoritesPage,
    td,
  }) => {
    // Create a fresh workspace
    const freshSlug = generateWorkspaceSlug("fav-empty");
    await favoritesPage.request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${td.token}` },
      data: {
        name: "Empty WS",
        slug: freshSlug,
        organization_size: "2-10",
      },
    });

    const res = await favoritesPage.request.get(
      `${apiUrl(freshSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const favorites = await res.json();

    expect(Array.isArray(favorites)).toBe(true);
    expect(favorites.length).toBe(0);
  });

  test("should only list top-level favorites (not nested)", async ({
    favoritesPage,
    td,
  }) => {
    // Create a folder
    const folderRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: "Test Folder",
          is_folder: true,
        },
      }
    );
    const folder = await folderRes.json();

    // Create a nested favorite inside the folder
    await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
          parent: folder.id,
        },
      }
    );

    // List favorites - should only get top-level
    const res = await favoritesPage.request.get(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const favorites = await res.json();

    // The nested favorite should NOT be in top-level list
    const nestedInList = favorites.filter(
      (f: any) => f.parent === folder.id
    );
    expect(nestedInList.length).toBe(0);
  });
});

// ─── 3. Delete Favorites ─────────────────────────────────────────────────────

test.describe("Delete Favorites", () => {
  test("should delete a favorite via API", async ({
    favoritesPage,
    td,
  }) => {
    // Create a favorite
    const createRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );
    const fav = await createRes.json();

    // Delete it
    const delRes = await favoritesPage.request.delete(
      `${apiUrl(td.wsSlug)}/user-favorites/${fav.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(delRes.status()).toBe(204);

    // Verify it's gone
    const listRes = await favoritesPage.request.get(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const favorites = await listRes.json();
    const found = favorites.find((f: any) => f.id === fav.id);
    expect(found).toBeUndefined();
  });

  test("should return 404 when deleting non-existent favorite", async ({
    favoritesPage,
    td,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await favoritesPage.request.delete(
      `${apiUrl(td.wsSlug)}/user-favorites/${fakeId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.status()).toBe(404);
  });

  test("should delete folder and its children", async ({
    favoritesPage,
    td,
  }) => {
    // Create a folder
    const folderRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: "Delete Folder",
          is_folder: true,
        },
      }
    );
    const folder = await folderRes.json();

    // Create a child favorite
    const childRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "cycle",
          entity_identifier: td.cycleId,
          parent: folder.id,
        },
      }
    );
    const child = await childRes.json();

    // Delete the folder
    const delRes = await favoritesPage.request.delete(
      `${apiUrl(td.wsSlug)}/user-favorites/${folder.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(delRes.status()).toBe(204);

    // Verify folder and child are both gone
    const listRes = await favoritesPage.request.get(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const favorites = await listRes.json();
    expect(favorites.find((f: any) => f.id === folder.id)).toBeUndefined();
    expect(favorites.find((f: any) => f.id === child.id)).toBeUndefined();
  });
});

// ─── 4. Favorite Different Entity Types ──────────────────────────────────────

test.describe("Favorite Different Entity Types", () => {
  test("should favorite all entity types with correct entity_data", async ({
    favoritesPage,
    td,
  }) => {
    const entityTypes = [
      { type: "project", id: td.projectId, name: td.projectName },
      { type: "cycle", id: td.cycleId, name: td.cycleName },
      { type: "module", id: td.moduleId, name: td.moduleName },
      { type: "view", id: td.viewId, name: td.viewName },
      { type: "page", id: td.pageId, name: td.pageName },
    ];

    for (const entity of entityTypes) {
      const res = await favoritesPage.request.post(
        `${apiUrl(td.wsSlug)}/user-favorites/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
          data: {
            entity_type: entity.type,
            entity_identifier: entity.id,
            project_id: entity.type !== "project" ? td.projectId : undefined,
          },
        }
      );
      expect(res.ok()).toBeTruthy();
      const fav = await res.json();

      expect(fav.entity_type).toBe(entity.type);
      expect(fav.entity_identifier).toBe(entity.id);
      expect(fav.entity_data).toBeDefined();
      expect(fav.entity_data.id).toBe(entity.id);
      expect(fav.entity_data.name).toBe(entity.name);
    }
  });

  test("should handle entity_data for deleted entities gracefully", async ({
    favoritesPage,
    td,
  }) => {
    // Create a cycle, favorite it, then delete the cycle
    const cycleRes = await favoritesPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/cycles/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Temp Cycle" },
      }
    );
    const tempCycle = await cycleRes.json();

    // Favorite the cycle
    const favRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "cycle",
          entity_identifier: tempCycle.id,
          project_id: td.projectId,
        },
      }
    );
    const fav = await favRes.json();

    // Delete the cycle
    await favoritesPage.request.delete(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/cycles/${tempCycle.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // List favorites - should still include the favorite but with null entity_data
    const listRes = await favoritesPage.request.get(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const favorites = await listRes.json();
    const found = favorites.find((f: any) => f.id === fav.id);
    expect(found).toBeDefined();
    expect(found.entity_data).toBeNull();
  });
});

// ─── 5. Favorite Ordering/Grouping ───────────────────────────────────────────

test.describe("Favorite Ordering/Grouping", () => {
  test("should create favorites with auto-incremented sequence", async ({
    favoritesPage,
    td,
  }) => {
    // Create first favorite
    const res1 = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );
    const fav1 = await res1.json();

    // Create second favorite
    const res2 = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "cycle",
          entity_identifier: td.cycleId,
        },
      }
    );
    const fav2 = await res2.json();

    expect(fav2.sequence).toBeGreaterThan(fav1.sequence);
  });

  test("should allow setting custom sequence", async ({
    favoritesPage,
    td,
  }) => {
    const customSequence = 12345;
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "module",
          entity_identifier: td.moduleId,
          sequence: customSequence,
        },
      }
    );
    const fav = await res.json();

    expect(fav.sequence).toBe(customSequence);
  });

  test("should update favorite sequence via PATCH", async ({
    favoritesPage,
    td,
  }) => {
    // Create a favorite
    const createRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "view",
          entity_identifier: td.viewId,
        },
      }
    );
    const fav = await createRes.json();
    const newSequence = 99999;

    // Update sequence
    const updateRes = await favoritesPage.request.patch(
      `${apiUrl(td.wsSlug)}/user-favorites/${fav.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { sequence: newSequence },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    expect(updated.sequence).toBe(newSequence);
  });

  test("should move favorite to a folder (parent)", async ({
    favoritesPage,
    td,
  }) => {
    // Create a folder
    const folderRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: "Move Target Folder",
          is_folder: true,
        },
      }
    );
    const folder = await folderRes.json();

    // Create a favorite
    const favRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "page",
          entity_identifier: td.pageId,
        },
      }
    );
    const fav = await favRes.json();

    // Move to folder
    const moveRes = await favoritesPage.request.patch(
      `${apiUrl(td.wsSlug)}/user-favorites/${fav.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { parent: folder.id },
      }
    );
    expect(moveRes.ok()).toBeTruthy();
    const moved = await moveRes.json();

    expect(moved.parent).toBe(folder.id);
  });

  test("should get favorites in a folder (group)", async ({
    favoritesPage,
    td,
  }) => {
    // Create a folder
    const folderRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: "Group Folder",
          is_folder: true,
        },
      }
    );
    const folder = await folderRes.json();

    // Create favorites inside the folder
    await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
          parent: folder.id,
        },
      }
    );

    await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "cycle",
          entity_identifier: td.cycleId,
          parent: folder.id,
        },
      }
    );

    // Get favorites in the group
    const groupRes = await favoritesPage.request.get(
      `${apiUrl(td.wsSlug)}/user-favorites/${folder.id}/group/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(groupRes.ok()).toBeTruthy();
    const groupFavorites = await groupRes.json();

    expect(Array.isArray(groupFavorites)).toBe(true);
    expect(groupFavorites.length).toBe(2);

    // All should have parent = folder.id
    for (const fav of groupFavorites) {
      expect(fav.parent).toBe(folder.id);
    }
  });

  test("should list favorites and return array ordered consistently", async ({
    favoritesPage,
    td,
  }) => {
    // Create two unique folders
    const folder1Res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: `OrderTest1-${Date.now()}`,
          is_folder: true,
        },
      }
    );
    const folder1 = await folder1Res.json();

    const folder2Res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: `OrderTest2-${Date.now()}`,
          is_folder: true,
        },
      }
    );
    const folder2 = await folder2Res.json();

    // List favorites
    const res = await favoritesPage.request.get(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const favorites = await res.json();

    // Both folders should be in the list
    const folder1Idx = favorites.findIndex((f: any) => f.id === folder1.id);
    const folder2Idx = favorites.findIndex((f: any) => f.id === folder2.id);

    expect(folder1Idx).toBeGreaterThan(-1);
    expect(folder2Idx).toBeGreaterThan(-1);

    // List should be returned as an array (regardless of specific order)
    expect(Array.isArray(favorites)).toBe(true);
    // All items should have consistent ordering property (sequence)
    for (const fav of favorites) {
      expect(typeof fav.sequence).toBe("number");
    }
  });
});

// ─── 6. Response Format Validation ───────────────────────────────────────────

test.describe("Response Format Validation", () => {
  test("should return proper response format for created favorite", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );
    const fav = await res.json();

    // Required fields
    expect(fav).toHaveProperty("id");
    expect(fav).toHaveProperty("entity_type");
    expect(fav).toHaveProperty("entity_identifier");
    expect(fav).toHaveProperty("entity_data");
    expect(fav).toHaveProperty("name");
    expect(fav).toHaveProperty("is_folder");
    expect(fav).toHaveProperty("sequence");
    expect(fav).toHaveProperty("parent");
    expect(fav).toHaveProperty("workspace_id");
    expect(fav).toHaveProperty("project_id");

    // Type checks
    expect(typeof fav.id).toBe("string");
    expect(typeof fav.entity_type).toBe("string");
    expect(typeof fav.is_folder).toBe("boolean");
    expect(typeof fav.sequence).toBe("number");
  });

  test("should return proper entity_data format for project", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );
    const fav = await res.json();

    expect(fav.entity_data).toHaveProperty("id");
    expect(fav.entity_data).toHaveProperty("name");
    expect(fav.entity_data).toHaveProperty("logo_props");
  });

  test("should return proper entity_data format for cycle", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "cycle",
          entity_identifier: td.cycleId,
          project_id: td.projectId,
        },
      }
    );
    const fav = await res.json();

    expect(fav.entity_data).toHaveProperty("id");
    expect(fav.entity_data).toHaveProperty("name");
    expect(fav.entity_data).toHaveProperty("project_id");
  });

  test("should return proper list response format", async ({
    favoritesPage,
    td,
  }) => {
    // Create a favorite
    await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "project",
          entity_identifier: td.projectId,
        },
      }
    );

    const res = await favoritesPage.request.get(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const favorites = await res.json();

    expect(Array.isArray(favorites)).toBe(true);
    expect(favorites.length).toBeGreaterThan(0);

    // Each item should have proper format
    const fav = favorites[0];
    expect(fav).toHaveProperty("id");
    expect(fav).toHaveProperty("entity_type");
    expect(fav).toHaveProperty("entity_identifier");
    expect(fav).toHaveProperty("entity_data");
    expect(fav).toHaveProperty("is_folder");
    expect(fav).toHaveProperty("sequence");
    expect(fav).toHaveProperty("parent");
    expect(fav).toHaveProperty("workspace_id");
  });
});

// ─── 7. Update Favorites ─────────────────────────────────────────────────────

test.describe("Update Favorites", () => {
  test("should update favorite name via PATCH", async ({
    favoritesPage,
    td,
  }) => {
    // Create a folder (only folders have meaningful names)
    const createRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: "Original Name",
          is_folder: true,
        },
      }
    );
    const fav = await createRes.json();

    // Update name
    const updateRes = await favoritesPage.request.patch(
      `${apiUrl(td.wsSlug)}/user-favorites/${fav.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "Updated Name" },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    expect(updated.name).toBe("Updated Name");
  });

  test("should return 404 when updating non-existent favorite", async ({
    favoritesPage,
    td,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await favoritesPage.request.patch(
      `${apiUrl(td.wsSlug)}/user-favorites/${fakeId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { name: "New Name" },
      }
    );
    expect(res.status()).toBe(404);
  });

  test("should update is_folder via PATCH", async ({
    favoritesPage,
    td,
  }) => {
    // Create a non-folder favorite
    const createRes = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: "Test",
          is_folder: false,
        },
      }
    );
    const fav = await createRes.json();
    expect(fav.is_folder).toBe(false);

    // Update to folder
    const updateRes = await favoritesPage.request.patch(
      `${apiUrl(td.wsSlug)}/user-favorites/${fav.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_folder: true },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    expect(updated.is_folder).toBe(true);
  });
});

// ─── 8. Authentication Tests ─────────────────────────────────────────────────

test.describe("Authentication Tests", () => {
  test("should return 401 when not authenticated for list", async ({
    playwright,
    td,
  }) => {
    // Use a fresh request context without any cookies
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.get(
        `${apiUrl(td.wsSlug)}/user-favorites/`
      );
      expect(res.status()).toBe(401);
    } finally {
      await freshRequest.dispose();
    }
  });

  test("should return 401 when not authenticated for create", async ({
    playwright,
    td,
  }) => {
    // Use a fresh request context without any cookies
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.post(
        `${apiUrl(td.wsSlug)}/user-favorites/`,
        {
          data: {
            entity_type: "project",
            entity_identifier: td.projectId,
          },
        }
      );
      expect(res.status()).toBe(401);
    } finally {
      await freshRequest.dispose();
    }
  });

  test("should return 401 when not authenticated for delete", async ({
    playwright,
    td,
  }) => {
    // Use a fresh request context without any cookies
    const freshRequest = await playwright.request.newContext();
    const fakeId = "00000000-0000-0000-0000-000000000000";
    try {
      const res = await freshRequest.delete(
        `${apiUrl(td.wsSlug)}/user-favorites/${fakeId}/`
      );
      expect(res.status()).toBe(401);
    } finally {
      await freshRequest.dispose();
    }
  });
});

// ─── 9. Edge Cases ───────────────────────────────────────────────────────────

test.describe("Edge Cases", () => {
  test("should handle empty entity_identifier", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: "Empty ID Folder",
          is_folder: true,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const fav = await res.json();

    expect(fav.entity_identifier).toBeNull();
    expect(fav.entity_data).toBeNull();
  });

  test("should handle long folder names", async ({
    favoritesPage,
    td,
  }) => {
    const longName = "A".repeat(200);
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "folder",
          name: longName,
          is_folder: true,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const fav = await res.json();

    expect(fav.name.length).toBeLessThanOrEqual(255);
  });

  test("should reject invalid entity_type", async ({
    favoritesPage,
    td,
  }) => {
    const res = await favoritesPage.request.post(
      `${apiUrl(td.wsSlug)}/user-favorites/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          entity_type: "",
          entity_identifier: td.projectId,
        },
      }
    );
    expect(res.ok()).toBeFalsy();
  });
});

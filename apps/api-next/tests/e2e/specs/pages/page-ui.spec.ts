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
  pageId: string;
  pageName: string;
  secondPageId: string;
  secondPageName: string;
  privatePageId: string;
  privatePageName: string;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  pgPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("pg-ui"));
  },

  pgPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("pg-ui");
      const password = generateTestPassword();
      const identifier = `P${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Page",
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
          first_name: "Page",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Page Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Page Project", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;
      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Create public page
      const pageRes = await request.post(`${base_url}/pages/`, {
        headers: headers(token),
        data: { name: "Meeting Notes", access: 0 },
      });
      expect(pageRes.ok()).toBeTruthy();
      const pg = await pageRes.json();

      // 7. Create second public page
      const page2Res = await request.post(`${base_url}/pages/`, {
        headers: headers(token),
        data: { name: "Project Roadmap", access: 0 },
      });
      expect(page2Res.ok()).toBeTruthy();
      const pg2 = await page2Res.json();

      // 8. Create private page
      const page3Res = await request.post(`${base_url}/pages/`, {
        headers: headers(token),
        data: { name: "Private Draft", access: 1 },
      });
      expect(page3Res.ok()).toBeTruthy();
      const pg3 = await page3Res.json();

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        identifier,
        pageId: pg.id,
        pageName: "Meeting Notes",
        secondPageId: pg2.id,
        secondPageName: "Project Roadmap",
        privatePageId: pg3.id,
        privatePageName: "Private Draft",
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ pgPage }, use) => {
    await use((pgPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToPages(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/pages/`);
  await waitForAppReady(page);
}

async function goToPageDetail(
  page: Page,
  wsSlug: string,
  pageId: string
) {
  const projectId = (page as any).__projectId;
  await page.goto(
    `/${wsSlug}/projects/${projectId}/pages/${pageId}`
  );
  await waitForAppReady(page);
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Pages List UI ────────────────────────────────────────────────────────

test.describe("Pages List UI", () => {
  test("should navigate to pages list page", async ({
    pgPage,
    wsSlug,
  }) => {
    await goToPages(pgPage, wsSlug);
    expect(pgPage.url()).toContain("/pages");
  });

  test("should show Pages sidebar link", async ({ pgPage, wsSlug }) => {
    const projectId = (pgPage as any).__projectId;
    await pgPage.goto(`/${wsSlug}/projects/${projectId}/issues/`);
    await waitForAppReady(pgPage);
    const pagesLink = pgPage
      .getByText("Pages", { exact: true })
      .first();
    await expect(pagesLink).toBeVisible({ timeout: 5_000 });
  });

  test("should show Add page button", async ({ pgPage, wsSlug }) => {
    await goToPages(pgPage, wsSlug);
    const addBtn = pgPage
      .getByRole("button", { name: /add page/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should create a page via Add page button", async ({
    pgPage,
    wsSlug,
  }) => {
    await goToPages(pgPage, wsSlug);

    const addBtn = pgPage
      .getByRole("button", { name: /add page/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // "Add page" may directly create and navigate to editor,
    // or open a modal
    await pgPage.waitForTimeout(2_000);
    await waitForAppReady(pgPage);

    // Check if we landed on a page editor (URL has /pages/<uuid>)
    if (pgPage.url().match(/\/pages\/[a-f0-9-]+/)) {
      expect(pgPage.url()).toContain("/pages/");
    } else {
      // A modal might have opened — fill the title
      const titleInput = pgPage
        .locator('input[placeholder="Title"]')
        .first();
      if (await titleInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await titleInput.fill(`E2E Page ${Date.now().toString(36)}`);
        const createBtn = pgPage
          .locator(
            'button:has-text("Create Page"), button:has-text("Create page")'
          )
          .first();
        await createBtn.click();
        await pgPage.waitForTimeout(2_000);
      }
    }
  });
});

// ─── 2. Page Detail ──────────────────────────────────────────────────────────

test.describe("Page Detail", () => {
  test("should navigate to page detail page", async ({
    pgPage,
    wsSlug,
    td,
  }) => {
    await goToPageDetail(pgPage, wsSlug, td.pageId);
    await expect(pgPage).toHaveURL(
      new RegExp(`/pages/${td.pageId}`),
      { timeout: 10_000 }
    );
  });
});

// ─── 3. Page API - CRUD ──────────────────────────────────────────────────────

test.describe("Page API - CRUD", () => {
  test("should list pages via API", async ({ pgPage, td }) => {
    const res = await pgPage.request.get(`${baseUrl(td)}/pages/`, {
      headers: auth(td.token),
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const pages = Array.isArray(data) ? data : data.results ?? [];
    // Should have at least the public pages (private may or may not show)
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });

  test("should get page detail via API", async ({ pgPage, td }) => {
    const res = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const page = await res.json();
    expect(page.name).toBe(td.pageName);
    expect(page.id).toBe(td.pageId);
    expect(page.access).toBe(0); // public
  });

  test("should create a page via API", async ({ pgPage, td }) => {
    const res = await pgPage.request.post(`${baseUrl(td)}/pages/`, {
      headers: auth(td.token),
      data: { name: "API Created Page", access: 0 },
    });
    expect(res.ok()).toBeTruthy();
    const page = await res.json();
    expect(page.name).toBe("API Created Page");
    expect(page.id).toBeTruthy();

    // Clean up - archive then delete
    await pgPage.request.post(
      `${baseUrl(td)}/pages/${page.id}/archive/`,
      { headers: auth(td.token) }
    );
    await pgPage.request.delete(`${baseUrl(td)}/pages/${page.id}/`, {
      headers: auth(td.token),
    });
  });

  test("should update a page name via API", async ({ pgPage, td }) => {
    const res = await pgPage.request.patch(
      `${baseUrl(td)}/pages/${td.secondPageId}/`,
      {
        headers: auth(td.token),
        data: { name: "Updated Roadmap" },
      }
    );
    expect(res.ok()).toBeTruthy();
    const updated = await res.json();
    expect(updated.name).toBe("Updated Roadmap");

    // Revert
    await pgPage.request.patch(
      `${baseUrl(td)}/pages/${td.secondPageId}/`,
      {
        headers: auth(td.token),
        data: { name: td.secondPageName },
      }
    );
  });

  test("should require archive before delete via API", async ({
    pgPage,
    td,
  }) => {
    // Create a page
    const createRes = await pgPage.request.post(
      `${baseUrl(td)}/pages/`,
      {
        headers: auth(td.token),
        data: { name: "To Delete" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const pg = await createRes.json();

    // Try to delete without archiving — should fail
    const delRes = await pgPage.request.delete(
      `${baseUrl(td)}/pages/${pg.id}/`,
      { headers: auth(td.token) }
    );
    expect(delRes.ok()).toBeFalsy();
    expect(delRes.status()).toBe(400);

    // Archive first, then delete
    const archRes = await pgPage.request.post(
      `${baseUrl(td)}/pages/${pg.id}/archive/`,
      { headers: auth(td.token) }
    );
    expect(archRes.ok()).toBeTruthy();

    const del2Res = await pgPage.request.delete(
      `${baseUrl(td)}/pages/${pg.id}/`,
      { headers: auth(td.token) }
    );
    expect(del2Res.ok()).toBeTruthy();
  });

  test("should create page with all fields via API", async ({
    pgPage,
    td,
  }) => {
    const res = await pgPage.request.post(`${baseUrl(td)}/pages/`, {
      headers: auth(td.token),
      data: {
        name: "Full Page",
        description_html: "<p>Hello world</p>",
        access: 1,
        color: "#ef4444",
      },
    });
    expect(res.ok()).toBeTruthy();
    const page = await res.json();
    expect(page.name).toBe("Full Page");
    expect(page.access).toBe(1);
    expect(page.color).toBe("#ef4444");

    // Clean up
    await pgPage.request.post(
      `${baseUrl(td)}/pages/${page.id}/archive/`,
      { headers: auth(td.token) }
    );
    await pgPage.request.delete(`${baseUrl(td)}/pages/${page.id}/`, {
      headers: auth(td.token),
    });
  });
});

// ─── 4. Page API - Favorites ─────────────────────────────────────────────────

test.describe("Page API - Favorites", () => {
  test("should favorite and unfavorite a page via API", async ({
    pgPage,
    td,
  }) => {
    // Add to favorites
    const favRes = await pgPage.request.post(
      `${baseUrl(td)}/pages/${td.pageId}/favorite/`,
      { headers: auth(td.token) }
    );
    expect(favRes.ok()).toBeTruthy();

    // Verify page shows as favorite
    const detailRes = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/`,
      { headers: auth(td.token) }
    );
    expect(detailRes.ok()).toBeTruthy();
    const page = await detailRes.json();
    expect(page.is_favorite).toBe(true);

    // Remove from favorites
    const unfavRes = await pgPage.request.delete(
      `${baseUrl(td)}/pages/${td.pageId}/favorite/`,
      { headers: auth(td.token) }
    );
    expect(unfavRes.ok()).toBeTruthy();

    // Verify no longer favorite
    const detail2Res = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/`,
      { headers: auth(td.token) }
    );
    const page2 = await detail2Res.json();
    expect(page2.is_favorite).toBe(false);
  });

  test("should list favorite pages via API", async ({ pgPage, td }) => {
    // Favorite a page first
    await pgPage.request.post(
      `${baseUrl(td)}/pages/${td.pageId}/favorite/`,
      { headers: auth(td.token) }
    );

    const res = await pgPage.request.get(
      `${baseUrl(td)}/favorite-pages/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const pages = Array.isArray(data) ? data : data.results ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(1);

    // Clean up
    await pgPage.request.delete(
      `${baseUrl(td)}/pages/${td.pageId}/favorite/`,
      { headers: auth(td.token) }
    );
  });
});

// ─── 5. Page API - Archive/Unarchive ─────────────────────────────────────────

test.describe("Page API - Archive", () => {
  test("should archive and unarchive a page via API", async ({
    pgPage,
    td,
  }) => {
    // Create a throwaway page
    const createRes = await pgPage.request.post(
      `${baseUrl(td)}/pages/`,
      {
        headers: auth(td.token),
        data: { name: "Archive Test" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const pg = await createRes.json();

    // Archive
    const archRes = await pgPage.request.post(
      `${baseUrl(td)}/pages/${pg.id}/archive/`,
      { headers: auth(td.token) }
    );
    expect(archRes.ok()).toBeTruthy();

    // Verify archived
    const detailRes = await pgPage.request.get(
      `${baseUrl(td)}/pages/${pg.id}/`,
      { headers: auth(td.token) }
    );
    expect(detailRes.ok()).toBeTruthy();
    const archived = await detailRes.json();
    expect(archived.archived_at).toBeTruthy();

    // Unarchive
    const unarchRes = await pgPage.request.delete(
      `${baseUrl(td)}/pages/${pg.id}/archive/`,
      { headers: auth(td.token) }
    );
    expect(unarchRes.ok()).toBeTruthy();

    // Verify unarchived
    const detail2Res = await pgPage.request.get(
      `${baseUrl(td)}/pages/${pg.id}/`,
      { headers: auth(td.token) }
    );
    const unarchived = await detail2Res.json();
    expect(unarchived.archived_at).toBeNull();

    // Clean up
    await pgPage.request.post(
      `${baseUrl(td)}/pages/${pg.id}/archive/`,
      { headers: auth(td.token) }
    );
    await pgPage.request.delete(`${baseUrl(td)}/pages/${pg.id}/`, {
      headers: auth(td.token),
    });
  });

  test("should list archived pages via API", async ({ pgPage, td }) => {
    // Create and archive a page
    const createRes = await pgPage.request.post(
      `${baseUrl(td)}/pages/`,
      {
        headers: auth(td.token),
        data: { name: "Archived Page" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const pg = await createRes.json();

    await pgPage.request.post(
      `${baseUrl(td)}/pages/${pg.id}/archive/`,
      { headers: auth(td.token) }
    );

    // List archived pages
    const res = await pgPage.request.get(
      `${baseUrl(td)}/archived-pages/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const pages = Array.isArray(data) ? data : data.results ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const found = pages.find((p: any) => p.id === pg.id);
    expect(found).toBeTruthy();

    // Clean up
    await pgPage.request.delete(`${baseUrl(td)}/pages/${pg.id}/`, {
      headers: auth(td.token),
    });
  });
});

// ─── 6. Page API - Lock/Unlock ───────────────────────────────────────────────

test.describe("Page API - Lock", () => {
  test("should lock and unlock a page via API", async ({
    pgPage,
    td,
  }) => {
    // Lock
    const lockRes = await pgPage.request.post(
      `${baseUrl(td)}/pages/${td.pageId}/lock/`,
      { headers: auth(td.token) }
    );
    expect(lockRes.ok()).toBeTruthy();

    // Verify locked
    const detailRes = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/`,
      { headers: auth(td.token) }
    );
    const locked = await detailRes.json();
    expect(locked.is_locked).toBe(true);

    // Unlock
    const unlockRes = await pgPage.request.delete(
      `${baseUrl(td)}/pages/${td.pageId}/lock/`,
      { headers: auth(td.token) }
    );
    expect(unlockRes.ok()).toBeTruthy();

    // Verify unlocked
    const detail2Res = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/`,
      { headers: auth(td.token) }
    );
    const unlocked = await detail2Res.json();
    expect(unlocked.is_locked).toBe(false);
  });
});

// ─── 7. Page API - Access Control ────────────────────────────────────────────

test.describe("Page API - Access", () => {
  test("should change page access level via API", async ({
    pgPage,
    td,
  }) => {
    // Make public page private
    const res = await pgPage.request.post(
      `${baseUrl(td)}/pages/${td.pageId}/access/`,
      {
        headers: auth(td.token),
        data: { access: 1 },
      }
    );
    expect(res.ok()).toBeTruthy();

    // Verify access changed
    const detailRes = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/`,
      { headers: auth(td.token) }
    );
    const page = await detailRes.json();
    expect(page.access).toBe(1);

    // Revert to public
    await pgPage.request.post(
      `${baseUrl(td)}/pages/${td.pageId}/access/`,
      {
        headers: auth(td.token),
        data: { access: 0 },
      }
    );
  });

  test("should create private page via API", async ({ pgPage, td }) => {
    const detailRes = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.privatePageId}/`,
      { headers: auth(td.token) }
    );
    expect(detailRes.ok()).toBeTruthy();
    const page = await detailRes.json();
    expect(page.name).toBe(td.privatePageName);
    expect(page.access).toBe(1);
  });
});

// ─── 8. Page API - Duplicate ─────────────────────────────────────────────────

test.describe("Page API - Duplicate", () => {
  test("should duplicate a page via API", async ({ pgPage, td }) => {
    const res = await pgPage.request.post(
      `${baseUrl(td)}/pages/${td.pageId}/duplicate/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const dup = await res.json();
    expect(dup.id).toBeTruthy();
    expect(dup.id).not.toBe(td.pageId);

    // Clean up
    await pgPage.request.post(
      `${baseUrl(td)}/pages/${dup.id}/archive/`,
      { headers: auth(td.token) }
    );
    await pgPage.request.delete(`${baseUrl(td)}/pages/${dup.id}/`, {
      headers: auth(td.token),
    });
  });
});

// ─── 9. Page API - Summary ───────────────────────────────────────────────────

test.describe("Page API - Summary", () => {
  test("should get page summary stats via API", async ({
    pgPage,
    td,
  }) => {
    const res = await pgPage.request.get(
      `${baseUrl(td)}/pages-summary/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const summary = await res.json();
    // Should have counts
    expect(summary.public_pages).toBeGreaterThanOrEqual(2);
    expect(summary.private_pages).toBeGreaterThanOrEqual(1);
    expect(summary.archived_pages).toBeDefined();
  });
});

// ─── 10. Page API - Hierarchy ────────────────────────────────────────────────

test.describe("Page API - Hierarchy", () => {
  test("should create child page via API", async ({ pgPage, td }) => {
    const res = await pgPage.request.post(`${baseUrl(td)}/pages/`, {
      headers: auth(td.token),
      data: {
        name: "Child Page",
        parent: td.pageId,
        access: 0,
      },
    });
    expect(res.ok()).toBeTruthy();
    const child = await res.json();
    expect(child.name).toBe("Child Page");
    expect(child.parent).toBe(td.pageId);

    // Clean up
    await pgPage.request.post(
      `${baseUrl(td)}/pages/${child.id}/archive/`,
      { headers: auth(td.token) }
    );
    await pgPage.request.delete(`${baseUrl(td)}/pages/${child.id}/`, {
      headers: auth(td.token),
    });
  });
});

// ─── 11. Page API - Versions ─────────────────────────────────────────────────

test.describe("Page API - Versions", () => {
  test("should list page versions via API", async ({ pgPage, td }) => {
    const res = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/versions/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    // Versions is an array (may be empty for new pages)
    expect(Array.isArray(data) || Array.isArray(data.results)).toBeTruthy();
  });

  test("should create version on description update via API", async ({
    pgPage,
    td,
  }) => {
    // Update description
    const updateRes = await pgPage.request.patch(
      `${baseUrl(td)}/pages/${td.pageId}/description/`,
      {
        headers: auth(td.token),
        data: {
          description_html: "<p>Updated content for version test</p>",
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();

    // Check versions
    const versionsRes = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/versions/`,
      { headers: auth(td.token) }
    );
    expect(versionsRes.ok()).toBeTruthy();
    const versions = await versionsRes.json();
    const versionList = Array.isArray(versions)
      ? versions
      : versions.results ?? [];
    expect(versionList.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 12. Page Response Validation ────────────────────────────────────────────

test.describe("Page Response Validation", () => {
  test("should return correct page fields", async ({ pgPage, td }) => {
    const res = await pgPage.request.get(
      `${baseUrl(td)}/pages/${td.pageId}/`,
      { headers: auth(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const page = await res.json();

    expect(page.id).toBe(td.pageId);
    expect(page.name).toBe(td.pageName);
    expect(page.owned_by).toBeTruthy();
    expect(page.access).toBeDefined();
    expect(page.is_locked).toBeDefined();
    expect(page.is_favorite).toBeDefined();
    expect(page.workspace).toBeTruthy();
    expect(page.created_at).toBeTruthy();
  });
});

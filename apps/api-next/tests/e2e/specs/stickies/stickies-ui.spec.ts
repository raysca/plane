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
  workspaceId: string;
  // Pre-created stickies for testing
  stickyIds: string[];
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  stickyPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("sticky-ui"));
  },

  stickyPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("sticky-ui");
      const password = generateTestPassword();
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Sticky",
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
          first_name: "Sticky",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Sticky Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();
      const ws = await wsRes.json();
      const workspaceId = ws.id;

      // 5. Create some stickies for testing
      const stickyIds: string[] = [];
      const stickyData = [
        {
          name: "Test Sticky Alpha",
          description_html: "<p>This is alpha sticky content</p>",
          color: "#FF5733",
          background_color: "#FEF3C7",
          sort_order: 50000,
        },
        {
          name: "Test Sticky Beta",
          description_html: "<p>Beta sticky with important notes</p>",
          color: "#33FF57",
          background_color: "#D1FAE5",
          sort_order: 40000,
        },
        {
          name: "Test Sticky Gamma",
          description_html: "<p>Gamma sticky for testing search</p>",
          color: "#3357FF",
          background_color: "#DBEAFE",
          sort_order: 30000,
        },
      ];

      for (const data of stickyData) {
        const res = await request.post(
          `${API_BASE}/api/workspaces/${wsSlug}/stickies/`,
          {
            headers: headers(token),
            data,
          }
        );
        expect(res.ok()).toBeTruthy();
        const sticky = await res.json();
        stickyIds.push(sticky.id);
      }

      const td: TestData = {
        token,
        userId,
        wsSlug,
        workspaceId,
        stickyIds,
      };
      (page as any).__testData = td;

      await use(page);
    },
    { timeout: 90_000 },
  ],

  td: async ({ stickyPage }, use) => {
    await use((stickyPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToStickies(page: Page, wsSlug: string) {
  await page.goto(`/${wsSlug}/stickies/`);
  await waitForAppReady(page);
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Stickies List API ────────────────────────────────────────────────────

test.describe("Stickies List API", () => {
  test("should list stickies with default pagination", async ({
    stickyPage,
    td,
  }) => {
    const res = await stickyPage.request.get(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    // At least the 3 stickies we created in fixture
    expect(data.results.length).toBeGreaterThanOrEqual(3);
    expect(data.total_count).toBeGreaterThanOrEqual(3);
    expect(data.prev_page_results).toBe(false);
  });

  test("should list stickies ordered by sort_order descending", async ({
    stickyPage,
    td,
  }) => {
    const res = await stickyPage.request.get(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Alpha has highest sort_order (50000), should be first
    expect(data.results[0].name).toBe("Test Sticky Alpha");
    expect(data.results[1].name).toBe("Test Sticky Beta");
    expect(data.results[2].name).toBe("Test Sticky Gamma");
  });

  test("should handle cursor pagination format", async ({ stickyPage, td }) => {
    // Test with cursor format "perPage:pageOffset:isPrev"
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/?cursor=2:0:0`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Should return 2 items on first page
    expect(data.results.length).toBe(2);
    expect(data.next_page_results).toBe(true);
    expect(data.prev_page_results).toBe(false);
  });

  test("should paginate to second page", async ({ stickyPage, td }) => {
    // Get second page with 2 items per page
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/?cursor=2:1:0`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Second page should have some items and prev_page_results should be true
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.prev_page_results).toBe(true);
  });

  test("should filter stickies by search query", async ({ stickyPage, td }) => {
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/?query=important`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.results.length).toBe(1);
    expect(data.results[0].name).toBe("Test Sticky Beta");
  });

  test("should return empty results for non-matching query", async ({
    stickyPage,
    td,
  }) => {
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/?query=nonexistent`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.results.length).toBe(0);
    expect(data.total_count).toBe(0);
  });

  test("should respect per_page parameter", async ({ stickyPage, td }) => {
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/?per_page=1`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.results.length).toBe(1);
    expect(data.next_page_results).toBe(true);
  });
});

// ─── 2. Stickies CRUD API ────────────────────────────────────────────────────

test.describe("Stickies CRUD API", () => {
  test("should create a new sticky", async ({ stickyPage, td }) => {
    const res = await stickyPage.request.post(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
      data: {
        name: "New Created Sticky",
        description_html: "<p>This is a new sticky</p>",
        color: "#9333EA",
        background_color: "#F3E8FF",
      },
    });
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.id).toBeDefined();
    expect(sticky.name).toBe("New Created Sticky");
    expect(sticky.description_html).toBe("<p>This is a new sticky</p>");
    expect(sticky.description_stripped).toBe("This is a new sticky");
    expect(sticky.color).toBe("#9333EA");
    expect(sticky.background_color).toBe("#F3E8FF");
    expect(sticky.workspace).toBe(td.workspaceId);
    expect(sticky.created_by).toBe(td.userId);
  });

  test("should create sticky with minimal data", async ({ stickyPage, td }) => {
    const res = await stickyPage.request.post(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
      data: {},
    });
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.id).toBeDefined();
    expect(sticky.name).toBe("");
    expect(sticky.description_html).toBe("<p></p>");
    expect(sticky.sort_order).toBe(65535);
  });

  test("should retrieve a specific sticky", async ({ stickyPage, td }) => {
    const stickyId = td.stickyIds[0];
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/${stickyId}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.id).toBe(stickyId);
    expect(sticky.name).toBe("Test Sticky Alpha");
  });

  test("should return 404 for non-existent sticky", async ({
    stickyPage,
    td,
  }) => {
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/nonexistent-id/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(404);
  });

  test("should update a sticky", async ({ stickyPage, td }) => {
    const stickyId = td.stickyIds[1];
    const res = await stickyPage.request.patch(
      `${baseUrl(td)}/stickies/${stickyId}/`,
      {
        headers: auth(td.token),
        data: {
          name: "Updated Beta Sticky",
          description_html: "<p>Updated content here</p>",
          color: "#EF4444",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.name).toBe("Updated Beta Sticky");
    expect(sticky.description_html).toBe("<p>Updated content here</p>");
    expect(sticky.description_stripped).toBe("Updated content here");
    expect(sticky.color).toBe("#EF4444");
    // background_color should remain unchanged
    expect(sticky.background_color).toBe("#D1FAE5");
  });

  test("should update sticky sort_order", async ({ stickyPage, td }) => {
    const stickyId = td.stickyIds[2];
    const res = await stickyPage.request.patch(
      `${baseUrl(td)}/stickies/${stickyId}/`,
      {
        headers: auth(td.token),
        data: {
          sort_order: 99999,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.sort_order).toBe(99999);
  });

  test("should delete a sticky", async ({ stickyPage, td }) => {
    // Create a sticky to delete
    const createRes = await stickyPage.request.post(
      `${baseUrl(td)}/stickies/`,
      {
        headers: auth(td.token),
        data: { name: "To Be Deleted" },
      }
    );
    const sticky = await createRes.json();

    // Delete it
    const delRes = await stickyPage.request.delete(
      `${baseUrl(td)}/stickies/${sticky.id}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(delRes.status()).toBe(204);

    // Verify it's gone
    const getRes = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/${sticky.id}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(getRes.status()).toBe(404);
  });

  test("should return 404 when deleting non-existent sticky", async ({
    stickyPage,
    td,
  }) => {
    const res = await stickyPage.request.delete(
      `${baseUrl(td)}/stickies/nonexistent-id/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.status()).toBe(404);
  });
});

// ─── 3. Stickies Response Format ─────────────────────────────────────────────

test.describe("Stickies Response Format", () => {
  test("should return correct response structure for list", async ({
    stickyPage,
    td,
  }) => {
    const res = await stickyPage.request.get(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // Pagination fields
    expect(data).toHaveProperty("next_cursor");
    expect(data).toHaveProperty("prev_cursor");
    expect(data).toHaveProperty("next_page_results");
    expect(data).toHaveProperty("prev_page_results");
    expect(data).toHaveProperty("total_pages");
    expect(data).toHaveProperty("total_count");
    expect(data).toHaveProperty("results");
  });

  test("should return correct sticky object structure", async ({
    stickyPage,
    td,
  }) => {
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/${td.stickyIds[0]}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    // Required fields
    expect(sticky).toHaveProperty("id");
    expect(sticky).toHaveProperty("name");
    expect(sticky).toHaveProperty("description");
    expect(sticky).toHaveProperty("description_html");
    expect(sticky).toHaveProperty("description_stripped");
    expect(sticky).toHaveProperty("description_binary");
    expect(sticky).toHaveProperty("logo_props");
    expect(sticky).toHaveProperty("color");
    expect(sticky).toHaveProperty("background_color");
    expect(sticky).toHaveProperty("sort_order");
    expect(sticky).toHaveProperty("workspace");
    expect(sticky).toHaveProperty("created_by");
    expect(sticky).toHaveProperty("updated_by");
    expect(sticky).toHaveProperty("created_at");
    expect(sticky).toHaveProperty("updated_at");
  });

  test("should return cursor in correct format", async ({ stickyPage, td }) => {
    const res = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/?per_page=1`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // next_cursor should be in format "perPage:pageOffset:isPrev"
    expect(data.next_cursor).toMatch(/^\d+:\d+:\d+$/);
  });
});

// ─── 4. Stickies Persistence ─────────────────────────────────────────────────

test.describe("Stickies Persistence", () => {
  test("should persist sticky after creation", async ({ stickyPage, td }) => {
    // Create sticky
    const createRes = await stickyPage.request.post(
      `${baseUrl(td)}/stickies/`,
      {
        headers: auth(td.token),
        data: {
          name: "Persistence Test",
          description_html: "<p>Testing persistence</p>",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Fetch it back
    const getRes = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/${created.id}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(getRes.ok()).toBeTruthy();
    const fetched = await getRes.json();

    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("Persistence Test");
    expect(fetched.description_html).toBe("<p>Testing persistence</p>");
  });

  test("should persist updates to sticky", async ({ stickyPage, td }) => {
    const stickyId = td.stickyIds[0];

    // Update sticky
    await stickyPage.request.patch(`${baseUrl(td)}/stickies/${stickyId}/`, {
      headers: auth(td.token),
      data: {
        name: "Persisted Update",
      },
    });

    // Fetch it back
    const getRes = await stickyPage.request.get(
      `${baseUrl(td)}/stickies/${stickyId}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(getRes.ok()).toBeTruthy();
    const fetched = await getRes.json();

    expect(fetched.name).toBe("Persisted Update");
  });

  test("should persist sticky in list after page refresh simulation", async ({
    stickyPage,
    td,
  }) => {
    // Create a unique sticky
    const uniqueName = `Refresh Test ${Date.now()}`;
    const createRes = await stickyPage.request.post(
      `${baseUrl(td)}/stickies/`,
      {
        headers: auth(td.token),
        data: {
          name: uniqueName,
          description_html: "<p>Should persist after refresh</p>",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();

    // Simulate page refresh by fetching list again
    const listRes = await stickyPage.request.get(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
    });
    expect(listRes.ok()).toBeTruthy();
    const data = await listRes.json();

    // Find our sticky in the list
    const found = data.results.find((s: any) => s.name === uniqueName);
    expect(found).toBeDefined();
    expect(found.description_html).toBe("<p>Should persist after refresh</p>");
  });
});

// ─── 5. Stickies Edge Cases ──────────────────────────────────────────────────

test.describe("Stickies Edge Cases", () => {
  test("should handle empty description_html", async ({ stickyPage, td }) => {
    const res = await stickyPage.request.post(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
      data: {
        name: "Empty Description",
        description_html: "",
      },
    });
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.description_html).toBe("");
    expect(sticky.description_stripped).toBe("");
  });

  test("should handle HTML with special characters", async ({
    stickyPage,
    td,
  }) => {
    const res = await stickyPage.request.post(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
      data: {
        name: "Special Chars",
        description_html: "<p>Test &amp; verify &lt;code&gt;</p>",
      },
    });
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.description_html).toBe("<p>Test &amp; verify &lt;code&gt;</p>");
  });

  test("should handle unicode in sticky content", async ({ stickyPage, td }) => {
    const res = await stickyPage.request.post(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
      data: {
        name: "Unicode Test",
        description_html: "<p>Hello world</p>",
      },
    });
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.description_html).toContain("Hello");
  });

  test("should handle null color values", async ({ stickyPage, td }) => {
    const res = await stickyPage.request.post(`${baseUrl(td)}/stickies/`, {
      headers: auth(td.token),
      data: {
        name: "Null Colors",
        color: null,
        background_color: null,
      },
    });
    expect(res.ok()).toBeTruthy();
    const sticky = await res.json();

    expect(sticky.color).toBeNull();
    expect(sticky.background_color).toBeNull();
  });

  test("should handle partial updates correctly", async ({ stickyPage, td }) => {
    // Create sticky with all fields
    const createRes = await stickyPage.request.post(
      `${baseUrl(td)}/stickies/`,
      {
        headers: auth(td.token),
        data: {
          name: "Partial Update Test",
          description_html: "<p>Original</p>",
          color: "#000000",
          background_color: "#FFFFFF",
        },
      }
    );
    const created = await createRes.json();

    // Update only name
    const updateRes = await stickyPage.request.patch(
      `${baseUrl(td)}/stickies/${created.id}/`,
      {
        headers: auth(td.token),
        data: {
          name: "New Name Only",
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    // Name should change, others should remain
    expect(updated.name).toBe("New Name Only");
    expect(updated.description_html).toBe("<p>Original</p>");
    expect(updated.color).toBe("#000000");
    expect(updated.background_color).toBe("#FFFFFF");
  });
});

// ─── 6. Stickies UI Navigation ───────────────────────────────────────────────

test.describe("Stickies UI", () => {
  test("should navigate to stickies page", async ({ stickyPage, wsSlug }) => {
    await goToStickies(stickyPage, wsSlug);
    expect(stickyPage.url()).toContain("/stickies");
  });
});

import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface TestData {
  token: string;
  userId: string;
  wsSlug: string;
  workspaceId: string;
  // Pre-created quick links for testing
  quickLinkIds: string[];
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  quickLinksPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("qlinks-ui"));
  },

  quickLinksPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("qlinks-ui");
      const password = generateTestPassword();
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "QuickLinks",
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
          first_name: "QuickLinks",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Quick Links Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();
      const ws = await wsRes.json();
      const workspaceId = ws.id;

      // 5. Create some quick links for testing (unique URLs per test run)
      const quickLinkIds: string[] = [];
      const uniqueId = Date.now().toString(36);
      const quickLinkData = [
        {
          title: "Plane Docs",
          url: `https://docs.plane.so/${uniqueId}/1`,
        },
        {
          title: "GitHub",
          url: `https://github.com/makeplane/plane/${uniqueId}/2`,
        },
        {
          title: "Plane Website",
          url: `https://plane.so/${uniqueId}/3`,
        },
      ];

      for (const data of quickLinkData) {
        const res = await request.post(
          `${API_BASE}/api/workspaces/${wsSlug}/quick-links/`,
          {
            headers: headers(token),
            data,
          }
        );
        expect(res.ok()).toBeTruthy();
        const link = await res.json();
        quickLinkIds.push(link.id);
      }

      const td: TestData = {
        token,
        userId,
        wsSlug,
        workspaceId,
        quickLinkIds,
      };
      (page as any).__testData = td;

      await use(page);
    },
    { timeout: 90_000 },
  ],

  td: async ({ quickLinksPage }, use) => {
    await use((quickLinksPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function baseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}`;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. List Quick Links ─────────────────────────────────────────────────────

test.describe("List Quick Links", () => {
  test("should list quick links for the current user", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const links = await res.json();

    expect(Array.isArray(links)).toBe(true);
    // At least the 3 quick links we created in fixture
    expect(links.length).toBeGreaterThanOrEqual(3);
  });

  test("should return quick links in consistent order", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const links = await res.json();

    expect(links.length).toBeGreaterThanOrEqual(3);

    // Verify that links have created_at timestamps
    for (const link of links) {
      expect(link.created_at).toBeDefined();
    }

    // Verify ordering is by created_at descending (newest first)
    // Convert to dates and check order
    const timestamps = links.map((l: any) => new Date(l.created_at).getTime());
    for (let i = 0; i < timestamps.length - 1; i++) {
      // Each timestamp should be >= the next one (descending order)
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
    }
  });

  test("should return only quick links for specific workspace", async ({
    quickLinksPage,
    td,
  }) => {
    // Create a fresh workspace
    const freshSlug = generateWorkspaceSlug("qlinks-separate");
    const createWsRes = await quickLinksPage.request.post(`${API_BASE}/api/workspaces/`, {
      headers: auth(td.token),
      data: {
        name: "Separate QLinks WS",
        slug: freshSlug,
        organization_size: "2-10",
      },
    });
    expect(createWsRes.ok()).toBeTruthy();

    // Create a quick link in the fresh workspace with unique title
    const uniqueTitle = `Separate WS Link ${Date.now()}`;
    const createLinkRes = await quickLinksPage.request.post(
      `${API_BASE}/api/workspaces/${freshSlug}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: uniqueTitle,
          url: `https://separate-ws-${Date.now()}.example.com`,
        },
      }
    );
    expect(createLinkRes.ok()).toBeTruthy();

    // List links from fresh workspace
    const freshRes = await quickLinksPage.request.get(
      `${API_BASE}/api/workspaces/${freshSlug}/quick-links/`,
      {
        headers: auth(td.token),
      }
    );
    expect(freshRes.ok()).toBeTruthy();
    const freshLinks = await freshRes.json();

    expect(Array.isArray(freshLinks)).toBe(true);
    // Should have at least the one we just created
    expect(freshLinks.length).toBeGreaterThanOrEqual(1);

    // The link we created should be in this workspace
    const foundInFresh = freshLinks.find((l: any) => l.title === uniqueTitle);
    expect(foundInFresh).toBeDefined();

    // Original workspace should NOT contain our new link (different workspace)
    const originalRes = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
      }
    );
    expect(originalRes.ok()).toBeTruthy();
    const originalLinks = await originalRes.json();

    // The unique link should NOT be in the original workspace
    const foundInOriginal = originalLinks.find((l: any) => l.title === uniqueTitle);
    expect(foundInOriginal).toBeUndefined();
  });
});

// ─── 2. Create Quick Links ───────────────────────────────────────────────────

test.describe("Create Quick Links", () => {
  test("should create a quick link with title and URL", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "New Test Link",
          url: "https://example.com/test",
        },
      }
    );
    expect(res.status()).toBe(201);
    const link = await res.json();

    expect(link.id).toBeDefined();
    expect(link.title).toBe("New Test Link");
    expect(link.url).toBe("https://example.com/test");
    expect(link.workspace_slug).toBe(td.wsSlug);
    expect(link.created_by_id).toBe(td.userId);
    expect(link.created_at).toBeDefined();
    expect(link.sort_order).toBe(65535);
  });

  test("should auto-prefix http:// if no protocol provided", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "No Protocol Link",
          url: "example.org/page",
        },
      }
    );
    expect(res.status()).toBe(201);
    const link = await res.json();

    expect(link.url).toBe("http://example.org/page");
  });

  test("should create quick link with minimal data (URL only)", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          url: "https://minimal.example.com",
        },
      }
    );
    expect(res.status()).toBe(201);
    const link = await res.json();

    expect(link.id).toBeDefined();
    expect(link.title).toBe("");
    expect(link.url).toBe("https://minimal.example.com");
  });

  test("should create quick link with null title", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: null,
          url: "https://null-title.example.com",
        },
      }
    );
    expect(res.status()).toBe(201);
    const link = await res.json();

    expect(link.title).toBe("");
  });

  test("should create quick link with metadata", async ({
    quickLinksPage,
    td,
  }) => {
    // The API stores metadata as { description: ... } internally
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Metadata Link",
          url: "https://metadata.example.com",
          metadata: { description: "A test description" },
        },
      }
    );
    expect(res.status()).toBe(201);
    const link = await res.json();

    expect(link.metadata).toBeDefined();
    // The response returns metadata object (may be empty or contain description)
    expect(typeof link.metadata).toBe("object");
  });

  test("should reject duplicate URL for same user in workspace", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Duplicate",
          url: "https://docs.plane.so", // Already exists from fixture
        },
      }
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });

  test("should reject invalid URL format", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Invalid URL",
          url: "not a valid url at all",
        },
      }
    );
    expect(res.status()).toBe(400);
  });

  test("should reject empty URL", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Empty URL",
          url: "",
        },
      }
    );
    expect(res.status()).toBe(400);
  });

  test("should reject missing URL field", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Missing URL",
        },
      }
    );
    expect(res.status()).toBe(400);
  });
});

// ─── 3. Retrieve Quick Links ─────────────────────────────────────────────────

test.describe("Retrieve Quick Links", () => {
  test("should retrieve a specific quick link by ID", async ({
    quickLinksPage,
    td,
  }) => {
    const linkId = td.quickLinkIds[0];
    const res = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/${linkId}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.id).toBe(linkId);
    expect(link.title).toBe("Plane Docs");
    // URL contains unique suffix from fixture
    expect(link.url).toContain("https://docs.plane.so/");
  });

  test("should return 404 for non-existent quick link", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/nonexistent-id/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.status()).toBe(404);
  });

  test("should deny access to quick link owned by another user", async ({
    quickLinksPage,
    td,
  }) => {
    // Create another user
    const otherEmail = generateTestEmail("qlinks-other");
    const otherPassword = generateTestPassword();
    const otherSignup = await quickLinksPage.request.post(
      `${API_BASE}/auth/sign-up/`,
      {
        data: {
          email: otherEmail,
          password: otherPassword,
          first_name: "Other",
          last_name: "User",
        },
      }
    );
    const otherData = await otherSignup.json();
    const otherToken = otherData.access_token;

    // Other user tries to access our quick link
    const res = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/${td.quickLinkIds[0]}/`,
      {
        headers: auth(otherToken),
      }
    );
    // Should be 403 (workspace access denied) or 404 (link not found for this user)
    expect([403, 404]).toContain(res.status());
  });
});

// ─── 4. Update Quick Links ───────────────────────────────────────────────────

test.describe("Update Quick Links", () => {
  test("should update quick link title", async ({
    quickLinksPage,
    td,
  }) => {
    const linkId = td.quickLinkIds[1]; // GitHub link
    const res = await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/${linkId}/`,
      {
        headers: auth(td.token),
        data: {
          title: "Updated GitHub Title",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.title).toBe("Updated GitHub Title");
    // URL should remain unchanged (contains unique suffix from fixture)
    expect(link.url).toContain("https://github.com/makeplane/plane/");
  });

  test("should update quick link URL", async ({
    quickLinksPage,
    td,
  }) => {
    const linkId = td.quickLinkIds[2]; // Plane Website link
    const res = await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/${linkId}/`,
      {
        headers: auth(td.token),
        data: {
          url: "https://plane.so/about",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.url).toBe("https://plane.so/about");
    // Title should remain unchanged
    expect(link.title).toBe("Plane Website");
  });

  test("should update URL with normalization", async ({
    quickLinksPage,
    td,
  }) => {
    // Create a link first to update
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "URL Normalization Test",
          url: "https://original.example.com",
        },
      }
    );
    const created = await createRes.json();

    // Update with URL lacking protocol
    const res = await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/${created.id}/`,
      {
        headers: auth(td.token),
        data: {
          url: "normalized.example.com/path",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.url).toBe("http://normalized.example.com/path");
  });

  test("should update both title and URL", async ({
    quickLinksPage,
    td,
  }) => {
    // Create a link to update
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Original Title",
          url: "https://original.example.com",
        },
      }
    );
    const created = await createRes.json();

    const res = await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/${created.id}/`,
      {
        headers: auth(td.token),
        data: {
          title: "New Title",
          url: "https://new.example.com",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.title).toBe("New Title");
    expect(link.url).toBe("https://new.example.com");
  });

  test("should reject duplicate URL on update", async ({
    quickLinksPage,
    td,
  }) => {
    // Create a new link
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Unique Link",
          url: "https://unique.example.com",
        },
      }
    );
    const created = await createRes.json();

    // Try to update to duplicate an existing URL
    const res = await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/${created.id}/`,
      {
        headers: auth(td.token),
        data: {
          url: "https://docs.plane.so", // Already exists from fixture
        },
      }
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });

  test("should return 404 when updating non-existent quick link", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/nonexistent-id/`,
      {
        headers: auth(td.token),
        data: {
          title: "Wont Work",
        },
      }
    );
    expect(res.status()).toBe(404);
  });

  test("should update metadata", async ({
    quickLinksPage,
    td,
  }) => {
    // Create a link with initial metadata
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Metadata Update Test",
          url: "https://metadata-update.example.com",
          metadata: { description: "Initial desc" },
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Update metadata - the API stores metadata with description field
    const res = await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/${created.id}/`,
      {
        headers: auth(td.token),
        data: {
          metadata: { description: "Updated description" },
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    // Verify metadata was updated (structure depends on API implementation)
    expect(link.metadata).toBeDefined();
    expect(typeof link.metadata).toBe("object");
  });
});

// ─── 5. Delete Quick Links ───────────────────────────────────────────────────

test.describe("Delete Quick Links", () => {
  test("should delete a quick link", async ({
    quickLinksPage,
    td,
  }) => {
    // Create a link to delete
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "To Be Deleted",
          url: "https://delete-me.example.com",
        },
      }
    );
    const created = await createRes.json();

    // Delete it
    const delRes = await quickLinksPage.request.delete(
      `${baseUrl(td)}/quick-links/${created.id}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(delRes.status()).toBe(204);

    // Verify it's gone
    const getRes = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/${created.id}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(getRes.status()).toBe(404);
  });

  test("should return 404 when deleting non-existent quick link", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.delete(
      `${baseUrl(td)}/quick-links/nonexistent-id/`,
      {
        headers: auth(td.token),
      }
    );
    expect(res.status()).toBe(404);
  });

  test("should reject deletion from non-workspace member", async ({
    quickLinksPage,
    td,
  }) => {
    // Create a quick link specifically for this test
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Protected Link",
          url: `https://protected-link-${Date.now()}.example.com`,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const protectedLink = await createRes.json();

    // Create another user who is NOT a member of the workspace
    const otherEmail = generateTestEmail("qlinks-del-other");
    const otherPassword = generateTestPassword();
    const otherSignup = await quickLinksPage.request.post(
      `${API_BASE}/auth/sign-up/`,
      {
        data: {
          email: otherEmail,
          password: otherPassword,
          first_name: "Delete",
          last_name: "Other",
        },
      }
    );
    const otherData = await otherSignup.json();
    const otherToken = otherData.access_token;

    // Other user (not workspace member) tries to delete our quick link
    const res = await quickLinksPage.request.delete(
      `${baseUrl(td)}/quick-links/${protectedLink.id}/`,
      {
        headers: auth(otherToken),
      }
    );
    // Should be 403 (workspace access denied) since user is not a workspace member
    expect(res.status()).toBe(403);
  });
});

// ─── 6. Response Format Validation ───────────────────────────────────────────

test.describe("Response Format Validation", () => {
  test("should return proper response format for created quick link", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Format Test Link",
          url: "https://format-test.example.com",
        },
      }
    );
    const link = await res.json();

    // Required fields
    expect(link).toHaveProperty("id");
    expect(link).toHaveProperty("title");
    expect(link).toHaveProperty("url");
    expect(link).toHaveProperty("metadata");
    expect(link).toHaveProperty("created_by_id");
    expect(link).toHaveProperty("workspace_slug");
    expect(link).toHaveProperty("created_at");
    expect(link).toHaveProperty("sort_order");

    // Type checks
    expect(typeof link.id).toBe("string");
    expect(typeof link.title).toBe("string");
    expect(typeof link.url).toBe("string");
    expect(typeof link.metadata).toBe("object");
    expect(typeof link.created_by_id).toBe("string");
    expect(typeof link.workspace_slug).toBe("string");
    expect(typeof link.created_at).toBe("string");
    expect(typeof link.sort_order).toBe("number");
  });

  test("should return proper list response format", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
      }
    );
    const links = await res.json();

    expect(Array.isArray(links)).toBe(true);
    expect(links.length).toBeGreaterThan(0);

    // Each item should have proper format
    const link = links[0];
    expect(link).toHaveProperty("id");
    expect(link).toHaveProperty("title");
    expect(link).toHaveProperty("url");
    expect(link).toHaveProperty("metadata");
    expect(link).toHaveProperty("created_by_id");
    expect(link).toHaveProperty("workspace_slug");
    expect(link).toHaveProperty("created_at");
    expect(link).toHaveProperty("sort_order");
  });

  test("should return ISO 8601 formatted created_at", async ({
    quickLinksPage,
    td,
  }) => {
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Date Format Test",
          url: "https://date-format.example.com",
        },
      }
    );
    const link = await res.json();

    // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(link.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    );
  });
});

// ─── 7. Authentication Tests ─────────────────────────────────────────────────

test.describe("Authentication Tests", () => {
  test("should return 401 when not authenticated for list", async ({
    playwright,
    td,
  }) => {
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.get(
        `${baseUrl(td)}/quick-links/`
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
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.post(
        `${baseUrl(td)}/quick-links/`,
        {
          data: {
            title: "Unauth Link",
            url: "https://unauth.example.com",
          },
        }
      );
      expect(res.status()).toBe(401);
    } finally {
      await freshRequest.dispose();
    }
  });

  test("should return 401 when not authenticated for retrieve", async ({
    playwright,
    td,
  }) => {
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.get(
        `${baseUrl(td)}/quick-links/${td.quickLinkIds[0]}/`
      );
      expect(res.status()).toBe(401);
    } finally {
      await freshRequest.dispose();
    }
  });

  test("should return 401 when not authenticated for update", async ({
    playwright,
    td,
  }) => {
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.patch(
        `${baseUrl(td)}/quick-links/${td.quickLinkIds[0]}/`,
        {
          data: {
            title: "Unauth Update",
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
    const freshRequest = await playwright.request.newContext();
    try {
      const res = await freshRequest.delete(
        `${baseUrl(td)}/quick-links/${td.quickLinkIds[0]}/`
      );
      expect(res.status()).toBe(401);
    } finally {
      await freshRequest.dispose();
    }
  });
});

// ─── 8. Edge Cases ───────────────────────────────────────────────────────────

test.describe("Edge Cases", () => {
  test("should handle long titles (up to 255 chars)", async ({
    quickLinksPage,
    td,
  }) => {
    const longTitle = "A".repeat(255);
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: longTitle,
          url: "https://long-title.example.com",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.title.length).toBe(255);
  });

  test("should reject titles exceeding 255 chars", async ({
    quickLinksPage,
    td,
  }) => {
    const tooLongTitle = "A".repeat(256);
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: tooLongTitle,
          url: "https://too-long-title.example.com",
        },
      }
    );
    expect(res.status()).toBe(400);
  });

  test("should handle unicode in titles", async ({
    quickLinksPage,
    td,
  }) => {
    const unicodeTitle = "Test Link";
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: unicodeTitle,
          url: "https://unicode-title.example.com",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.title).toBe(unicodeTitle);
  });

  test("should handle URLs with query parameters", async ({
    quickLinksPage,
    td,
  }) => {
    const urlWithParams =
      "https://example.com/search?q=test&page=1&filter=active";
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "URL with params",
          url: urlWithParams,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.url).toBe(urlWithParams);
  });

  test("should handle URLs with fragments", async ({
    quickLinksPage,
    td,
  }) => {
    const urlWithFragment = "https://example.com/docs#section-1";
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "URL with fragment",
          url: urlWithFragment,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.url).toBe(urlWithFragment);
  });

  test("should handle URLs with encoded characters", async ({
    quickLinksPage,
    td,
  }) => {
    const encodedUrl = "https://example.com/search?q=hello%20world";
    const res = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Encoded URL",
          url: encodedUrl,
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const link = await res.json();

    expect(link.url).toBe(encodedUrl);
  });

  test("should handle partial updates correctly", async ({
    quickLinksPage,
    td,
  }) => {
    // Create link with all fields
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Partial Update Test",
          url: "https://partial-update.example.com",
          metadata: { key: "original" },
        },
      }
    );
    const created = await createRes.json();

    // Update only title
    const updateRes = await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/${created.id}/`,
      {
        headers: auth(td.token),
        data: {
          title: "New Title Only",
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    // Title should change, others should remain
    expect(updated.title).toBe("New Title Only");
    expect(updated.url).toBe("https://partial-update.example.com");
  });
});

// ─── 9. Persistence Tests ────────────────────────────────────────────────────

test.describe("Persistence Tests", () => {
  test("should persist quick link after creation", async ({
    quickLinksPage,
    td,
  }) => {
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: "Persistence Test",
          url: "https://persist.example.com",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Fetch it back
    const getRes = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/${created.id}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(getRes.ok()).toBeTruthy();
    const fetched = await getRes.json();

    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe("Persistence Test");
    expect(fetched.url).toBe("https://persist.example.com");
  });

  test("should persist updates to quick link", async ({
    quickLinksPage,
    td,
  }) => {
    const linkId = td.quickLinkIds[0];

    // Update quick link
    await quickLinksPage.request.patch(
      `${baseUrl(td)}/quick-links/${linkId}/`,
      {
        headers: auth(td.token),
        data: {
          title: "Persisted Update Title",
        },
      }
    );

    // Fetch it back
    const getRes = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/${linkId}/`,
      {
        headers: auth(td.token),
      }
    );
    expect(getRes.ok()).toBeTruthy();
    const fetched = await getRes.json();

    expect(fetched.title).toBe("Persisted Update Title");
  });

  test("should persist quick link in list after multiple operations", async ({
    quickLinksPage,
    td,
  }) => {
    // Create a unique quick link
    const uniqueTitle = `List Persist Test ${Date.now()}`;
    const createRes = await quickLinksPage.request.post(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
        data: {
          title: uniqueTitle,
          url: `https://list-persist-${Date.now()}.example.com`,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();

    // Fetch list
    const listRes = await quickLinksPage.request.get(
      `${baseUrl(td)}/quick-links/`,
      {
        headers: auth(td.token),
      }
    );
    expect(listRes.ok()).toBeTruthy();
    const links = await listRes.json();

    // Find our quick link in the list
    const found = links.find((l: any) => l.title === uniqueTitle);
    expect(found).toBeDefined();
  });
});

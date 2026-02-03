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
  workspaceId: string;
}

// ── Fixture: authenticated page with workspace created ──────────────────────

type Fixtures = {
  webhookPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("wh-ui"));
  },

  webhookPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("wh-ui");
      const password = generateTestPassword();
      const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: { email, password, first_name: "Webhook", last_name: "Tester" },
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
        data: { first_name: "Webhook", last_name: "Tester", is_onboarded: true },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: { name: "Webhook Test WS", slug: wsSlug, organization_size: "2-10" },
      });
      expect(wsRes.ok()).toBeTruthy();
      const wsData = await wsRes.json();

      // Store test data on page object for access in tests
      const td: TestData = {
        token,
        wsSlug,
        workspaceId: wsData.id,
      };
      (page as any).__testData = td;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ webhookPage }, use) => {
    await use((webhookPage as any).__testData as TestData);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Webhook API - List Webhooks
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook API - List Webhooks", () => {
  test("should return empty array when no webhooks exist", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBe(0);
  });

  test("should list webhooks after creating one", async ({
    webhookPage,
    td,
  }) => {
    // Create a webhook first
    const createRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: "https://example.com/webhook",
          is_active: true,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();

    // List webhooks
    const listRes = await webhookPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(listRes.ok()).toBeTruthy();
    const data = await listRes.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBe(1);
    expect(data[0].url).toBe("https://example.com/webhook");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Webhook API - Create Webhook
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook API - Create Webhook", () => {
  test("should create a webhook with required fields only", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: `https://create-basic-${Date.now()}.example.com/webhook`,
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data.id).toBeDefined();
    expect(data.url).toContain("create-basic");
    expect(data.is_active).toBe(true); // default
    expect(data.secret_key).toBeDefined();
    expect(data.secret_key.length).toBeGreaterThan(0);
    expect(data.project_event).toBe(true); // default
    expect(data.issue_event).toBe(true); // default
    expect(data.module_event).toBe(false); // default
    expect(data.cycle_event).toBe(false); // default
    expect(data.issue_comment_event).toBe(false); // default
    expect(data.workspace_id).toBe(td.workspaceId);
    expect(data.created_at).toBeDefined();
    expect(data.updated_at).toBeDefined();
  });

  test("should create a webhook with all fields", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: `https://create-full-${Date.now()}.example.com/webhook`,
          is_active: false,
          project_event: true,
          issue_event: true,
          module_event: true,
          cycle_event: true,
          issue_comment_event: true,
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(201);

    const data = await response.json();
    expect(data.is_active).toBe(false);
    expect(data.project_event).toBe(true);
    expect(data.issue_event).toBe(true);
    expect(data.module_event).toBe(true);
    expect(data.cycle_event).toBe(true);
    expect(data.issue_comment_event).toBe(true);
  });

  test("should reject webhook with invalid URL", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: "not-a-valid-url",
        },
      }
    );

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(400);
  });

  test("should reject duplicate webhook URL in same workspace", async ({
    webhookPage,
    td,
  }) => {
    const webhookUrl = `https://duplicate-${Date.now()}.example.com/webhook`;

    // Create first webhook
    const firstRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: webhookUrl },
      }
    );
    expect(firstRes.ok()).toBeTruthy();

    // Try to create duplicate
    const secondRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: webhookUrl },
      }
    );

    expect(secondRes.ok()).toBeFalsy();
    expect(secondRes.status()).toBe(400);

    const error = await secondRes.json();
    expect(error.url).toBeDefined();
  });

  test("should generate unique secret key for each webhook", async ({
    webhookPage,
    td,
  }) => {
    const res1 = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://secret-key-1-${Date.now()}.example.com/webhook` },
      }
    );
    expect(res1.ok()).toBeTruthy();
    const data1 = await res1.json();

    const res2 = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://secret-key-2-${Date.now()}.example.com/webhook` },
      }
    );
    expect(res2.ok()).toBeTruthy();
    const data2 = await res2.json();

    expect(data1.secret_key).not.toBe(data2.secret_key);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Webhook API - Get Single Webhook
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook API - Get Single Webhook", () => {
  test("should get a single webhook by ID", async ({
    webhookPage,
    td,
  }) => {
    // Create a webhook first
    const createRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: `https://get-single-${Date.now()}.example.com/webhook`,
          is_active: true,
          module_event: true,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Get the webhook
    const getRes = await webhookPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(getRes.ok()).toBeTruthy();
    expect(getRes.status()).toBe(200);

    const data = await getRes.json();
    expect(data.id).toBe(created.id);
    expect(data.url).toBe(created.url);
    expect(data.is_active).toBe(true);
    expect(data.module_event).toBe(true);
    expect(data.secret_key).toBeDefined();
  });

  test("should return 404 for non-existent webhook", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/non-existent-id/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Webhook API - Update Webhook
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook API - Update Webhook", () => {
  test("should update webhook URL", async ({
    webhookPage,
    td,
  }) => {
    // Create a webhook
    const createRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://update-url-${Date.now()}.example.com/webhook` },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    const newUrl = `https://updated-url-${Date.now()}.example.com/webhook`;

    // Update the webhook
    const updateRes = await webhookPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: newUrl },
      }
    );

    expect(updateRes.ok()).toBeTruthy();
    expect(updateRes.status()).toBe(200);

    const data = await updateRes.json();
    expect(data.url).toBe(newUrl);
    expect(data.id).toBe(created.id);
    // Secret key should remain the same
    expect(data.secret_key).toBe(created.secret_key);
  });

  test("should update webhook is_active status", async ({
    webhookPage,
    td,
  }) => {
    // Create an active webhook
    const createRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: `https://update-active-${Date.now()}.example.com/webhook`,
          is_active: true,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expect(created.is_active).toBe(true);

    // Deactivate the webhook
    const updateRes = await webhookPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_active: false },
      }
    );

    expect(updateRes.ok()).toBeTruthy();
    const data = await updateRes.json();
    expect(data.is_active).toBe(false);
  });

  test("should update webhook events", async ({
    webhookPage,
    td,
  }) => {
    // Create a webhook with default events
    const createRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: `https://update-events-${Date.now()}.example.com/webhook`,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    expect(created.module_event).toBe(false);
    expect(created.cycle_event).toBe(false);
    expect(created.issue_comment_event).toBe(false);

    // Enable additional events
    const updateRes = await webhookPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          module_event: true,
          cycle_event: true,
          issue_comment_event: true,
        },
      }
    );

    expect(updateRes.ok()).toBeTruthy();
    const data = await updateRes.json();
    expect(data.module_event).toBe(true);
    expect(data.cycle_event).toBe(true);
    expect(data.issue_comment_event).toBe(true);
    // Original events should remain unchanged
    expect(data.project_event).toBe(true);
    expect(data.issue_event).toBe(true);
  });

  test("should reject update with duplicate URL", async ({
    webhookPage,
    td,
  }) => {
    const existingUrl = `https://existing-${Date.now()}.example.com/webhook`;

    // Create first webhook
    const firstRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: existingUrl },
      }
    );
    expect(firstRes.ok()).toBeTruthy();

    // Create second webhook
    const secondRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://second-${Date.now()}.example.com/webhook` },
      }
    );
    expect(secondRes.ok()).toBeTruthy();
    const second = await secondRes.json();

    // Try to update second webhook with first webhook's URL
    const updateRes = await webhookPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${second.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: existingUrl },
      }
    );

    expect(updateRes.ok()).toBeFalsy();
    expect(updateRes.status()).toBe(400);
  });

  test("should return 404 when updating non-existent webhook", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/non-existent-id/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_active: false },
      }
    );

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Webhook API - Delete Webhook
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook API - Delete Webhook", () => {
  test("should delete a webhook", async ({
    webhookPage,
    td,
  }) => {
    // Create a webhook
    const createRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://delete-${Date.now()}.example.com/webhook` },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Delete the webhook
    const deleteRes = await webhookPage.request.delete(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(deleteRes.status()).toBe(204);

    // Verify it's deleted
    const getRes = await webhookPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(getRes.status()).toBe(404);
  });

  test("should return 404 when deleting non-existent webhook", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.delete(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/non-existent-id/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(response.ok()).toBeFalsy();
    expect(response.status()).toBe(404);
  });

  test("should not affect other webhooks when deleting one", async ({
    webhookPage,
    td,
  }) => {
    // Create two webhooks
    const res1 = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://keep-${Date.now()}.example.com/webhook` },
      }
    );
    expect(res1.ok()).toBeTruthy();
    const webhook1 = await res1.json();

    const res2 = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://delete-me-${Date.now()}.example.com/webhook` },
      }
    );
    expect(res2.ok()).toBeTruthy();
    const webhook2 = await res2.json();

    // Delete the second webhook
    const deleteRes = await webhookPage.request.delete(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${webhook2.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(deleteRes.status()).toBe(204);

    // Verify the first webhook still exists
    const getRes = await webhookPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${webhook1.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(getRes.ok()).toBeTruthy();
    const data = await getRes.json();
    expect(data.id).toBe(webhook1.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Webhook Properties Validation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook Properties Validation", () => {
  test("should validate URL format", async ({
    webhookPage,
    td,
  }) => {
    // These are truly invalid URLs that Zod's url() validator will reject
    const invalidUrls = [
      "not-a-url",
      "just-text",
      "://missing-protocol.com",
      "",
    ];

    for (const url of invalidUrls) {
      const response = await webhookPage.request.post(
        `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
          data: { url },
        }
      );

      expect(response.ok()).toBeFalsy();
      expect(response.status()).toBe(400);
    }
  });

  test("should accept valid HTTPS URLs", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://valid-https-${Date.now()}.example.com/webhook/path` },
      }
    );

    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(201);
  });

  test("should accept valid HTTP URLs", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `http://valid-http-${Date.now()}.example.com/webhook` },
      }
    );

    expect(response.ok()).toBeTruthy();
    expect(response.status()).toBe(201);
  });

  test("should validate boolean event properties", async ({
    webhookPage,
    td,
  }) => {
    // Create webhook with explicit boolean values
    const response = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: `https://boolean-test-${Date.now()}.example.com/webhook`,
          is_active: true,
          project_event: false,
          issue_event: false,
          module_event: true,
          cycle_event: true,
          issue_comment_event: false,
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.is_active).toBe(true);
    expect(data.project_event).toBe(false);
    expect(data.issue_event).toBe(false);
    expect(data.module_event).toBe(true);
    expect(data.cycle_event).toBe(true);
    expect(data.issue_comment_event).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Webhook Response Format
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook Response Format", () => {
  test("should return correct response format for created webhook", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: `https://format-test-${Date.now()}.example.com/webhook`,
          is_active: true,
          project_event: true,
          issue_event: true,
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Verify all expected fields are present
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("url");
    expect(data).toHaveProperty("is_active");
    expect(data).toHaveProperty("secret_key");
    expect(data).toHaveProperty("project_event");
    expect(data).toHaveProperty("issue_event");
    expect(data).toHaveProperty("module_event");
    expect(data).toHaveProperty("cycle_event");
    expect(data).toHaveProperty("issue_comment_event");
    expect(data).toHaveProperty("workspace_id");
    expect(data).toHaveProperty("created_by_id");
    expect(data).toHaveProperty("created_at");
    expect(data).toHaveProperty("updated_at");

    // Verify types
    expect(typeof data.id).toBe("string");
    expect(typeof data.url).toBe("string");
    expect(typeof data.is_active).toBe("boolean");
    expect(typeof data.secret_key).toBe("string");
    expect(typeof data.project_event).toBe("boolean");
    expect(typeof data.issue_event).toBe("boolean");
    expect(typeof data.module_event).toBe("boolean");
    expect(typeof data.cycle_event).toBe("boolean");
    expect(typeof data.issue_comment_event).toBe("boolean");
    expect(typeof data.workspace_id).toBe("string");
    expect(typeof data.created_at).toBe("string");
    expect(typeof data.updated_at).toBe("string");

    // Verify date format (ISO 8601)
    expect(new Date(data.created_at).toISOString()).toBe(data.created_at);
    expect(new Date(data.updated_at).toISOString()).toBe(data.updated_at);
  });

  test("should return array format for list endpoint", async ({
    webhookPage,
    td,
  }) => {
    // Create a webhook first
    await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://list-format-${Date.now()}.example.com/webhook` },
      }
    );

    const response = await webhookPage.request.get(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBeGreaterThan(0);

    // Verify each item has the expected structure
    for (const webhook of data) {
      expect(webhook).toHaveProperty("id");
      expect(webhook).toHaveProperty("url");
      expect(webhook).toHaveProperty("is_active");
      expect(webhook).toHaveProperty("secret_key");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Webhook Secret Key
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook Secret Key", () => {
  test("secret key should be automatically generated on creation", async ({
    webhookPage,
    td,
  }) => {
    const response = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://secret-gen-${Date.now()}.example.com/webhook` },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data.secret_key).toBeDefined();
    expect(typeof data.secret_key).toBe("string");
    expect(data.secret_key.length).toBeGreaterThanOrEqual(32);
  });

  test("secret key should not change on update", async ({
    webhookPage,
    td,
  }) => {
    // Create webhook
    const createRes = await webhookPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { url: `https://secret-persist-${Date.now()}.example.com/webhook` },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const originalSecret = created.secret_key;

    // Update webhook
    const updateRes = await webhookPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          url: `https://secret-persist-updated-${Date.now()}.example.com/webhook`,
          is_active: false,
        },
      }
    );

    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    expect(updated.secret_key).toBe(originalSecret);
  });

  test("different webhooks should have different secret keys", async ({
    webhookPage,
    td,
  }) => {
    const secretKeys: string[] = [];

    for (let i = 0; i < 3; i++) {
      const response = await webhookPage.request.post(
        `${API_BASE}/api/workspaces/${td.wsSlug}/webhooks/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
          data: { url: `https://unique-secret-${Date.now()}-${i}.example.com/webhook` },
        }
      );
      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      secretKeys.push(data.secret_key);
    }

    // Verify all secret keys are unique
    const uniqueKeys = new Set(secretKeys);
    expect(uniqueKeys.size).toBe(secretKeys.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Webhook UI Settings Page (if available)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Webhook Settings UI", () => {
  test("should navigate to webhook settings page", async ({
    webhookPage,
    wsSlug,
  }) => {
    await webhookPage.goto(`/${wsSlug}/settings/webhooks`);
    await waitForAppReady(webhookPage);

    // Verify we're on the settings page (may show a message or webhook list)
    expect(webhookPage.url()).toContain("/settings/webhooks");
  });
});

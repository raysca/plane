import { test as base, expect, type Page, type APIRequestContext } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface TestData {
  token: string;
  wsSlug: string;
  workspaceId: string;
  projectId: string;
  userId: string;
}

// ── Fixture: authenticated page with workspace and project ───────────────────

type Fixtures = {
  assetPage: Page;
  wsSlug: string;
  td: TestData;
  apiRequest: APIRequestContext;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("asset-ui"));
  },

  // Create a fresh API request context without cookies for auth tests
  apiRequest: async ({ playwright }, use) => {
    const apiContext = await playwright.request.newContext();
    await use(apiContext);
    await apiContext.dispose();
  },

  assetPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("asset-ui");
      const password = generateTestPassword();
      const identifier = `A${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: { email, password, first_name: "Asset", last_name: "Tester" },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;
      const userId: string = signupData.user?.id || "";

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
        data: { first_name: "Asset", last_name: "Tester", is_onboarded: true },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: { name: "Asset Test WS", slug: wsSlug, organization_size: "2-10" },
      });
      expect(wsRes.ok()).toBeTruthy();
      const workspace = await wsRes.json();
      const workspaceId: string = workspace.id;

      // 5. Create project
      const projRes = await request.post(`${API_BASE}/api/workspaces/${wsSlug}/projects/`, {
        headers: headers(token),
        data: { name: "Asset Project", identifier, network: 2 },
      });
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      // Store test data on page object for access in tests
      const td: TestData = {
        token,
        wsSlug,
        workspaceId,
        projectId,
        userId,
      };
      (page as any).__testData = td;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ assetPage }, use) => {
    await use((assetPage as any).__testData as TestData);
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Workspace Asset Upload URL (Presigned URL)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Workspace Asset Upload URL", () => {
  test("should get presigned upload URL for workspace asset", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "test-image.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Validate response structure
    expect(data).toHaveProperty("asset_id");
    expect(data).toHaveProperty("upload_data");
    expect(data).toHaveProperty("asset_url");
    expect(typeof data.asset_id).toBe("string");
    expect(data.asset_id.length).toBeGreaterThan(0);
  });

  test("should reject invalid file type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "test-file.exe",
          type: "application/octet-stream",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid file type");
  });

  test("should reject invalid entity type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "test-image.png",
          type: "image/png",
          size: 1024,
          entity_type: "INVALID_TYPE",
        },
      }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Invalid entity type");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Project Asset Upload URL
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Project Asset Upload URL", () => {
  test("should get presigned upload URL for issue attachment in project", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "attachment.png",
          type: "image/png",
          size: 5000,
          entity_type: "ISSUE_ATTACHMENT",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data).toHaveProperty("asset_id");
    expect(data).toHaveProperty("upload_data");
    // For issue attachments, asset_url includes workspace and project
    expect(data.asset_url).toContain(td.wsSlug);
    expect(data.asset_url).toContain(td.projectId);
  });

  test("should get presigned upload URL for issue description image", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "description-image.gif",
          type: "image/gif",
          size: 3000,
          entity_type: "ISSUE_DESCRIPTION",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data).toHaveProperty("asset_id");
    expect(data.asset_url).toBeTruthy();
  });

  test("should get presigned upload URL for project cover in project scope", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "project-cover.jpg",
          type: "image/jpeg",
          size: 2048,
          entity_type: "PROJECT_COVER",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Validate response structure
    expect(data).toHaveProperty("asset_id");
    expect(data).toHaveProperty("upload_data");
    expect(data).toHaveProperty("asset_url");
    // PROJECT_COVER returns static URL
    expect(data.asset_url).toContain("/static/");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Asset Metadata CRUD - Mark as Uploaded
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Asset Metadata - Mark as Uploaded", () => {
  test("should mark workspace asset as uploaded via PATCH", async ({
    assetPage,
    td,
  }) => {
    // First create an asset
    const createRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "upload-test.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    const assetId = createData.asset_id;

    // Mark as uploaded
    const patchRes = await assetPage.request.patch(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          attributes: { name: "upload-test-renamed.png" },
        },
      }
    );

    expect(patchRes.status()).toBe(204);
  });

  test("should mark project asset as uploaded via PATCH", async ({
    assetPage,
    td,
  }) => {
    // Create project asset using ISSUE_ATTACHMENT (non-static entity type)
    const createRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "project-upload.webp",
          type: "image/webp",
          size: 2048,
          entity_type: "ISSUE_ATTACHMENT",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    const assetId = createData.asset_id;

    // Mark as uploaded
    const patchRes = await assetPage.request.patch(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );

    expect(patchRes.status()).toBe(204);
  });

  test("should return 404 for non-existent asset", async ({ assetPage, td }) => {
    const response = await assetPage.request.patch(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/nonexistent-id/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );

    expect(response.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Asset Soft Delete
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Asset Soft Delete", () => {
  test("should soft-delete workspace asset", async ({ assetPage, td }) => {
    // Create asset
    const createRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "delete-test.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    const assetId = createData.asset_id;

    // Delete asset
    const deleteRes = await assetPage.request.delete(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(deleteRes.status()).toBe(204);

    // Verify asset is marked as deleted (check endpoint returns exists: false)
    const checkRes = await assetPage.request.get(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/check/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(checkRes.ok()).toBeTruthy();
    const checkData = await checkRes.json();
    expect(checkData.exists).toBe(false);
  });

  test("should soft-delete project asset", async ({ assetPage, td }) => {
    // Create project asset
    const createRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "project-delete.png",
          type: "image/png",
          size: 1024,
          entity_type: "ISSUE_ATTACHMENT",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    const assetId = createData.asset_id;

    // Delete asset
    const deleteRes = await assetPage.request.delete(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(deleteRes.status()).toBe(204);
  });

  test("should return 404 when deleting non-existent asset", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.delete(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/nonexistent-id/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(response.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Asset Restore
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Asset Restore", () => {
  test("should restore soft-deleted workspace asset", async ({
    assetPage,
    td,
  }) => {
    // Create asset
    const createRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "restore-test.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    const assetId = createData.asset_id;

    // Delete asset
    const deleteRes = await assetPage.request.delete(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(deleteRes.status()).toBe(204);

    // Verify deleted
    const checkDeletedRes = await assetPage.request.get(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/check/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const checkDeletedData = await checkDeletedRes.json();
    expect(checkDeletedData.exists).toBe(false);

    // Restore asset
    const restoreRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/restore/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(restoreRes.status()).toBe(204);

    // Verify restored
    const checkRestoredRes = await assetPage.request.get(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/check/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    const checkRestoredData = await checkRestoredRes.json();
    expect(checkRestoredData.exists).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Asset Check Exists
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Asset Check Exists", () => {
  test("should return exists: true for valid asset", async ({
    assetPage,
    td,
  }) => {
    // Create asset
    const createRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "check-exists.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    const assetId = createData.asset_id;

    // Check exists
    const checkRes = await assetPage.request.get(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/check/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(checkRes.ok()).toBeTruthy();
    const checkData = await checkRes.json();
    expect(checkData).toHaveProperty("exists");
    expect(checkData.exists).toBe(true);
  });

  test("should return exists: false for non-existent asset", async ({
    assetPage,
    td,
  }) => {
    const checkRes = await assetPage.request.get(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/check/nonexistent-id/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(checkRes.ok()).toBeTruthy();
    const checkData = await checkRes.json();
    expect(checkData.exists).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. User Asset Routes
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("User Asset Routes", () => {
  test("should create user avatar asset", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/user-assets`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "avatar.png",
          type: "image/png",
          size: 1024,
          entity_type: "USER_AVATAR",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data).toHaveProperty("asset_id");
    expect(data).toHaveProperty("upload_data");
    expect(data).toHaveProperty("asset_url");
    expect(data.asset_url).toContain("/static/");
  });

  test("should create user cover asset", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/user-assets`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "cover.jpg",
          type: "image/jpeg",
          size: 5000,
          entity_type: "USER_COVER",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    expect(data).toHaveProperty("asset_id");
    expect(data.asset_url).toContain("/static/");
  });

  test("should mark user asset as uploaded", async ({ assetPage, td }) => {
    // Create user asset
    const createRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/user-assets`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "user-upload.png",
          type: "image/png",
          size: 1024,
          entity_type: "USER_AVATAR",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    const assetId = createData.asset_id;

    // Mark as uploaded
    const patchRes = await assetPage.request.patch(
      `${API_BASE}/api/assets/v2/user-assets/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          attributes: { name: "renamed-avatar.png" },
        },
      }
    );

    expect(patchRes.status()).toBe(204);
  });

  test("should soft-delete user asset", async ({ assetPage, td }) => {
    // Create user asset
    const createRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/user-assets`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "delete-user-asset.png",
          type: "image/png",
          size: 1024,
          entity_type: "USER_AVATAR",
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const createData = await createRes.json();
    const assetId = createData.asset_id;

    // Delete
    const deleteRes = await assetPage.request.delete(
      `${API_BASE}/api/assets/v2/user-assets/${assetId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(deleteRes.status()).toBe(204);
  });

  test("should reject invalid entity type for user asset", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/user-assets`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "invalid.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO", // Invalid for user assets
        },
      }
    );

    expect(response.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Bulk Asset Binding
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Bulk Asset Binding", () => {
  test("should bulk bind workspace assets to entity", async ({
    assetPage,
    td,
  }) => {
    // Create multiple assets
    const assetIds: string[] = [];

    for (let i = 0; i < 2; i++) {
      const createRes = await assetPage.request.post(
        `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
          data: {
            name: `bulk-asset-${i}.png`,
            type: "image/png",
            size: 1024,
            entity_type: "WORKSPACE_LOGO",
          },
        }
      );
      expect(createRes.ok()).toBeTruthy();
      const data = await createRes.json();
      assetIds.push(data.asset_id);
    }

    // Bulk bind to entity
    const entityId = `entity-${Date.now()}`;
    const bulkRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/${entityId}/bulk/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { asset_ids: assetIds },
      }
    );

    expect(bulkRes.status()).toBe(204);
  });

  test("should bulk bind project assets to entity", async ({
    assetPage,
    td,
  }) => {
    // Create multiple project assets using ISSUE_ATTACHMENT
    const assetIds: string[] = [];

    for (let i = 0; i < 2; i++) {
      const createRes = await assetPage.request.post(
        `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
        {
          headers: { Authorization: `Bearer ${td.token}` },
          data: {
            name: `project-bulk-${i}.png`,
            type: "image/png",
            size: 1024,
            entity_type: "ISSUE_ATTACHMENT",
          },
        }
      );
      expect(createRes.ok()).toBeTruthy();
      const data = await createRes.json();
      assetIds.push(data.asset_id);
    }

    // Bulk bind to entity (e.g., issue)
    const entityId = `issue-${Date.now()}`;
    const bulkRes = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}/${entityId}/bulk/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { asset_ids: assetIds },
      }
    );

    expect(bulkRes.status()).toBe(204);
  });

  test("should return error for empty asset_ids", async ({ assetPage, td }) => {
    const entityId = `entity-${Date.now()}`;
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/${entityId}/bulk/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { asset_ids: [] },
      }
    );

    expect(response.status()).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("asset_ids");
  });

  test("should return 404 for non-matching assets", async ({
    assetPage,
    td,
  }) => {
    const entityId = `entity-${Date.now()}`;
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/${entityId}/bulk/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { asset_ids: ["nonexistent-1", "nonexistent-2"] },
      }
    );

    expect(response.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Different Asset Types (Image Formats)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Different Asset Types", () => {
  test("should accept JPEG image type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "test.jpeg",
          type: "image/jpeg",
          size: 2048,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should accept JPG image type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "test.jpg",
          type: "image/jpg",
          size: 2048,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should accept PNG image type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "test.png",
          type: "image/png",
          size: 2048,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should accept WebP image type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "test.webp",
          type: "image/webp",
          size: 2048,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should accept GIF image type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "test.gif",
          type: "image/gif",
          size: 2048,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should reject PDF file type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "document.pdf",
          type: "application/pdf",
          size: 2048,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.status()).toBe(400);
  });

  test("should reject text file type", async ({ assetPage, td }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "readme.txt",
          type: "text/plain",
          size: 100,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Response Format Validation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Response Format Validation", () => {
  test("should have correct upload_data structure for workspace asset", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "format-test.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // upload_data should contain URL and fields for S3 or local upload
    expect(data.upload_data).toBeDefined();
    expect(typeof data.upload_data).toBe("object");
    expect(data.upload_data).toHaveProperty("url");
  });

  test("should have correct asset_url format for static entity types", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "static-url-test.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO", // Static entity type
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Static assets should have /static/ URL format
    expect(data.asset_url).toContain("/api/assets/v2/static/");
    expect(data.asset_url).toContain(data.asset_id);
  });

  test("should have correct asset_url format for project entity types", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "project-url-test.png",
          type: "image/png",
          size: 1024,
          entity_type: "ISSUE_ATTACHMENT", // Project-scoped entity type
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Project assets should have workspace/project in URL
    expect(data.asset_url).toContain(`/workspaces/${td.wsSlug}`);
    expect(data.asset_url).toContain(`/projects/${td.projectId}`);
  });

  test("check endpoint should return proper JSON format", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.get(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/check/some-id/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    // Should have exactly the 'exists' boolean property
    expect(Object.keys(data)).toContain("exists");
    expect(typeof data.exists).toBe("boolean");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Entity Type Coverage
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Entity Type Coverage", () => {
  test("should accept ISSUE_DESCRIPTION entity type", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "issue-desc.png",
          type: "image/png",
          size: 1024,
          entity_type: "ISSUE_DESCRIPTION",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should accept COMMENT_DESCRIPTION entity type", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "comment-desc.png",
          type: "image/png",
          size: 1024,
          entity_type: "COMMENT_DESCRIPTION",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should accept PAGE_DESCRIPTION entity type", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "page-desc.png",
          type: "image/png",
          size: 1024,
          entity_type: "PAGE_DESCRIPTION",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should accept DRAFT_ISSUE_DESCRIPTION entity type", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/projects/${td.projectId}`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "draft-issue-desc.png",
          type: "image/png",
          size: 1024,
          entity_type: "DRAFT_ISSUE_DESCRIPTION",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
  });

  test("should accept PROJECT_COVER entity type via workspace route", async ({
    assetPage,
    td,
  }) => {
    const response = await assetPage.request.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          name: "project-cover.png",
          type: "image/png",
          size: 1024,
          entity_type: "PROJECT_COVER",
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    // PROJECT_COVER should return static URL
    expect(data.asset_url).toContain("/static/");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Authentication Tests
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Authentication", () => {
  test("should reject request with invalid bearer token", async ({
    apiRequest,
    td,
  }) => {
    const response = await apiRequest.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        headers: { Authorization: "Bearer invalid-token-12345" },
        data: {
          name: "invalid-token.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.status()).toBe(401);
  });

  test("should reject request without any authorization", async ({
    apiRequest,
    td,
  }) => {
    const response = await apiRequest.post(
      `${API_BASE}/api/assets/v2/workspaces/${td.wsSlug}/`,
      {
        // No Authorization header and no cookies
        data: {
          name: "unauth-test.png",
          type: "image/png",
          size: 1024,
          entity_type: "WORKSPACE_LOGO",
        },
      }
    );

    expect(response.status()).toBe(401);
  });

  test("should reject user asset request without authorization", async ({
    apiRequest,
  }) => {
    const response = await apiRequest.post(
      `${API_BASE}/api/assets/v2/user-assets`,
      {
        // No Authorization header and no cookies
        data: {
          name: "unauth-user.png",
          type: "image/png",
          size: 1024,
          entity_type: "USER_AVATAR",
        },
      }
    );

    expect(response.status()).toBe(401);
  });
});

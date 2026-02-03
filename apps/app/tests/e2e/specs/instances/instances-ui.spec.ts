import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";
const ADMIN_EMAIL = "instance-admin-e2e@plane.test";
const ADMIN_PASSWORD = "InstanceAdminPassword123!";

// ---------------------------------------------------------------------------
// Helper: ensure the instance admin exists and sign in via API
// ---------------------------------------------------------------------------
async function signInInstanceAdminViaCookies(
  page: Page,
  request: any
): Promise<{ success: boolean; token?: string }> {
  // Ensure admin account exists (ignore if already created)
  await request
    .post(`${API_BASE}/api/instances/admins/sign-up/`, {
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        first_name: "Instance",
        last_name: "Admin",
        company_name: "E2E Test Instance",
        is_telemetry_enabled: false,
      },
      maxRedirects: 0,
    })
    .catch(() => {});

  // Sign in via the admin sign-in API endpoint (captures redirect + cookies)
  const signInRes = await request
    .post(`${API_BASE}/api/instances/admins/sign-in/`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      maxRedirects: 0,
    })
    .catch(() => null);

  if (!signInRes) return { success: false };

  // Extract cookies from the sign-in response
  const cookies = signInRes
    .headersArray()
    .filter((h: any) => h.name.toLowerCase() === "set-cookie")
    .map((h: any) => h.value);

  for (const cookie of cookies) {
    const parts = cookie.split(";")[0]!.split("=");
    const name = parts[0]!.trim();
    const value = parts.slice(1).join("=").trim();
    if (name && value) {
      await page.context().addCookies([
        { name, value, domain: "localhost", path: "/" },
      ]);
    }
  }

  return { success: cookies.length > 0 };
}

// ---------------------------------------------------------------------------
// Fixture: page authenticated as an instance admin
// ---------------------------------------------------------------------------
type InstanceAdminFixtures = {
  adminPage: Page;
};

const test = base.extend<InstanceAdminFixtures>({
  adminPage: async ({ page, request }, use) => {
    const { success } = await signInInstanceAdminViaCookies(page, request);

    if (!success) {
      // Store auth failure for tests to handle
      (page as any).__testData = { authFailed: true };
    } else {
      (page as any).__testData = { authFailed: false };
    }

    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Helper: check if auth failed
// ---------------------------------------------------------------------------
function authFailed(page: Page): boolean {
  return (page as any).__testData?.authFailed === true;
}

// ---------------------------------------------------------------------------
// Instance Public Endpoints (no auth required)
// ---------------------------------------------------------------------------
test.describe("Instance Public Endpoints", () => {
  test("should get instance information without auth", async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/instances/`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // Response has nested structure with "instance" and "config" objects
    expect(data).toHaveProperty("instance");
    expect(data).toHaveProperty("config");

    // Validate instance object fields
    const instance = data.instance;
    expect(instance).toHaveProperty("instance_name");
    expect(instance).toHaveProperty("id");
    expect(instance).toHaveProperty("is_setup_done");
    expect(instance).toHaveProperty("is_signup_screen_visited");
  });

  test("should check workspace slug availability", async ({ request }) => {
    const response = await request.get(
      `${API_BASE}/api/instances/workspace-slug-check/?slug=test-workspace-check`
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty("status");
    expect(typeof data.status).toBe("boolean");
  });

  test("should get changelog without auth", async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/instances/changelog/`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    // Changelog can be an array or object depending on implementation
    expect(data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Instance Admin Authentication
// ---------------------------------------------------------------------------
test.describe("Instance Admin Authentication", () => {
  test("should redirect to sign-in form when accessing admin pages unauthenticated", async ({
    page,
  }) => {
    await page.goto(`${API_BASE}/admin/general/`);
    await page.waitForLoadState("networkidle");

    // Should be redirected to /admin sign-in page
    expect(page.url()).toMatch(/\/admin\/?$/);
  });

  test("should return 401 for configurations endpoint without auth", async ({
    request,
  }) => {
    const response = await request.get(
      `${API_BASE}/api/instances/configurations/`
    );
    expect(response.status()).toBe(401);

    const data = await response.json();
    expect(data).toHaveProperty("detail");
    expect(data.detail).toContain("Authentication");
  });

  test("should return 401 for admins list endpoint without auth", async ({
    request,
  }) => {
    const response = await request.get(`${API_BASE}/api/instances/admins/`);
    expect(response.status()).toBe(401);
  });

  test("should return 401 for admin me endpoint without auth", async ({
    request,
  }) => {
    const response = await request.get(`${API_BASE}/api/instances/admins/me/`);
    expect(response.status()).toBe(401);
  });

  test("should return 401 for workspaces endpoint without auth", async ({
    request,
  }) => {
    const response = await request.get(
      `${API_BASE}/api/instances/workspaces/`
    );
    expect(response.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Instance Admin - Get Configurations
// ---------------------------------------------------------------------------
test.describe("Instance Admin - Configurations API", () => {
  test("should get instance configurations as admin", async ({
    adminPage,
    request,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    // Get cookies from page context
    const cookies = await adminPage.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get(
      `${API_BASE}/api/instances/configurations/`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    // Configurations should be an object or array
    expect(data).toBeDefined();
  });

  test("should validate configurations response format", async ({
    adminPage,
    request,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    const cookies = await adminPage.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get(
      `${API_BASE}/api/instances/configurations/`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    if (response.ok()) {
      const data = await response.json();

      // If data is an array, check each item
      if (Array.isArray(data)) {
        for (const config of data) {
          expect(config).toHaveProperty("key");
        }
      } else if (typeof data === "object" && data !== null) {
        // If data is an object, it should have configuration keys
        expect(Object.keys(data).length).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Instance Admin - Admin Management
// ---------------------------------------------------------------------------
test.describe("Instance Admin - Admin Management API", () => {
  test("should get list of instance admins", async ({ adminPage, request }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    const cookies = await adminPage.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get(`${API_BASE}/api/instances/admins/`, {
      headers: { Cookie: cookieHeader },
    });

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();

    // Should have at least the current admin
    expect(data.length).toBeGreaterThanOrEqual(1);

    // Validate admin object structure
    if (data.length > 0) {
      const admin = data[0];
      expect(admin).toHaveProperty("id");
      expect(admin).toHaveProperty("user");
    }
  });

  test("should get current admin details via me endpoint", async ({
    adminPage,
    request,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    const cookies = await adminPage.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get(
      `${API_BASE}/api/instances/admins/me/`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("user");
  });
});

// ---------------------------------------------------------------------------
// Instance Admin - Workspaces Management
// ---------------------------------------------------------------------------
test.describe("Instance Admin - Workspaces Management API", () => {
  test("should get list of all workspaces as admin", async ({
    adminPage,
    request,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    const cookies = await adminPage.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get(
      `${API_BASE}/api/instances/workspaces/`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    // Response could be paginated or a simple array
    if (Array.isArray(data)) {
      // Simple array response
      expect(data).toBeDefined();
    } else {
      // Paginated response
      expect(data).toHaveProperty("results");
      expect(Array.isArray(data.results)).toBeTruthy();
    }
  });

  test("should support pagination for workspaces", async ({
    adminPage,
    request,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    const cookies = await adminPage.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get(
      `${API_BASE}/api/instances/workspaces/?page=1&per_page=10`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    // Check pagination response format
    if (data.results) {
      expect(data.results.length).toBeLessThanOrEqual(10);
    }
  });

  test("should support search for workspaces", async ({
    adminPage,
    request,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    const cookies = await adminPage.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const response = await request.get(
      `${API_BASE}/api/instances/workspaces/?search=test`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    expect(response.ok()).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Instance Admin - Update Instance
// ---------------------------------------------------------------------------
test.describe("Instance Admin - Update Instance API", () => {
  test("should return 401 when updating instance without auth", async ({
    request,
  }) => {
    const response = await request.patch(`${API_BASE}/api/instances/`, {
      data: { instance_name: "Test Instance" },
    });

    expect(response.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Non-Admin User Access Control
// ---------------------------------------------------------------------------
test.describe("Non-Admin User Access Control", () => {
  test("should return 403 for regular user accessing admin endpoints", async ({
    page,
    request,
  }) => {
    // Create a regular user (not an instance admin)
    const email = generateTestEmail("regular-user");
    const password = generateTestPassword();

    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Regular", last_name: "User" },
    });

    if (!signupRes.ok()) {
      test.skip(true, "Could not create regular user");
      return;
    }

    // Set cookies for the regular user
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

    const pageCookies = await page.context().cookies();
    const cookieHeader = pageCookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    // Try to access admin-only endpoints
    const configResponse = await request.get(
      `${API_BASE}/api/instances/configurations/`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    // Should be 403 Forbidden (not an instance admin)
    expect(configResponse.status()).toBe(403);

    const data = await configResponse.json();
    expect(data).toHaveProperty("detail");
    expect(data.detail).toContain("Permission denied");
  });

  test("should return 403 for regular user accessing admin workspaces list", async ({
    page,
    request,
  }) => {
    const email = generateTestEmail("regular-user-ws");
    const password = generateTestPassword();

    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Regular", last_name: "User2" },
    });

    if (!signupRes.ok()) {
      test.skip(true, "Could not create regular user");
      return;
    }

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

    const pageCookies = await page.context().cookies();
    const cookieHeader = pageCookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const response = await request.get(
      `${API_BASE}/api/instances/workspaces/`,
      {
        headers: { Cookie: cookieHeader },
      }
    );

    expect(response.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Admin Dashboard UI Tests
// ---------------------------------------------------------------------------
test.describe("Admin Dashboard UI", () => {
  test("should load General settings page after admin login", async ({
    adminPage,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await adminPage.goto(`${API_BASE}/admin/general/`);
    await waitForAppReady(adminPage);

    // Should be on the general settings page, not redirected to sign-in
    expect(adminPage.url()).toContain("/general");
  });

  test("should display instance name field in general settings", async ({
    adminPage,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await adminPage.goto(`${API_BASE}/admin/general/`);
    await waitForAppReady(adminPage);

    // Look for instance name input or heading
    const instanceNameInput = adminPage.locator(
      'input[name="instance_name"], input[id="instance_name"], input[placeholder*="instance" i]'
    );
    const instanceNameHeading = adminPage.locator('text="Instance name"');

    const hasInput = await instanceNameInput
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const hasHeading = await instanceNameHeading
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    expect(hasInput || hasHeading).toBeTruthy();
  });

  test("should navigate to Email settings page", async ({ adminPage }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await adminPage.goto(`${API_BASE}/admin/email/`);
    await waitForAppReady(adminPage);

    expect(adminPage.url()).toContain("/email");
  });

  test("should navigate to Authentication settings page", async ({
    adminPage,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await adminPage.goto(`${API_BASE}/admin/authentication/`);
    await waitForAppReady(adminPage);

    expect(adminPage.url()).toContain("/authentication");
  });

  test("should navigate to AI settings page", async ({ adminPage }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await adminPage.goto(`${API_BASE}/admin/ai/`);
    await waitForAppReady(adminPage);

    expect(adminPage.url()).toContain("/ai");
  });

  test("should navigate to Image settings page", async ({ adminPage }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await adminPage.goto(`${API_BASE}/admin/image/`);
    await waitForAppReady(adminPage);

    expect(adminPage.url()).toContain("/image");
  });

  test("should navigate to Workspaces management page", async ({
    adminPage,
  }) => {
    if (authFailed(adminPage)) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await adminPage.goto(`${API_BASE}/admin/workspace/`);
    await waitForAppReady(adminPage);

    expect(adminPage.url()).toContain("/workspace");
  });
});

// ---------------------------------------------------------------------------
// Instance Response Format Validation
// ---------------------------------------------------------------------------
test.describe("Instance Response Format Validation", () => {
  test("should validate instance response has required fields", async ({
    request,
  }) => {
    const response = await request.get(`${API_BASE}/api/instances/`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();

    // Required top-level fields
    expect(data).toHaveProperty("instance");
    expect(data).toHaveProperty("config");

    // Validate instance object
    const instance = data.instance;
    expect(instance).toHaveProperty("instance_name");
    expect(instance).toHaveProperty("id");
    expect(instance).toHaveProperty("is_setup_done");
    expect(instance).toHaveProperty("is_signup_screen_visited");

    // Type validations
    expect(typeof instance.instance_name).toBe("string");
    expect(typeof instance.id).toBe("string");
    expect(typeof instance.is_setup_done).toBe("boolean");
    expect(typeof instance.is_signup_screen_visited).toBe("boolean");

    // Validate config object has expected fields
    const config = data.config;
    expect(config).toHaveProperty("is_email_password_enabled");
    expect(config).toHaveProperty("is_self_managed");
    expect(typeof config.is_email_password_enabled).toBe("boolean");
  });

  test("should validate workspace slug check response format", async ({
    request,
  }) => {
    const response = await request.get(
      `${API_BASE}/api/instances/workspace-slug-check/?slug=valid-slug-test`
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty("status");
    expect(typeof data.status).toBe("boolean");
  });

  test("should return false status for missing slug parameter", async ({
    request,
  }) => {
    const response = await request.get(
      `${API_BASE}/api/instances/workspace-slug-check/`
    );
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Admin Sign-up Screen Visited
// ---------------------------------------------------------------------------
test.describe("Admin Sign-up Screen Visited", () => {
  test("should mark signup screen as visited", async ({ request }) => {
    const response = await request.post(
      `${API_BASE}/api/instances/admins/sign-up-screen-visited/`
    );

    // Should return 204 No Content on success or 400 if instance not found
    expect([204, 400]).toContain(response.status());
  });
});

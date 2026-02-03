import { test as base, type Page, type APIRequestContext } from "@playwright/test";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

const ADMIN_EMAIL = "admin-e2e@plane.test";
const ADMIN_PASSWORD = "AdminPassword123!";

type TestFixtures = {
  authenticatedPage: Page;
  apiContext: APIRequestContext;
  adminPage: Page;
};

export const test = base.extend<TestFixtures>({
  authenticatedPage: async ({ page, request }, use) => {
    // Sign up a unique test user
    const email = `test-${Date.now()}@example.com`;
    const password = "TestPassword123!";

    const response = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: {
        email,
        password,
        first_name: "Test",
        last_name: "User",
      },
    });

    if (!response.ok()) {
      throw new Error(`Signup failed: ${response.status()} ${await response.text()}`);
    }

    // Extract session cookies from the signup response and set them on the page
    const cookies = response
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value);

    for (const cookie of cookies) {
      const parts = cookie.split(";")[0]!.split("=");
      const name = parts[0]!.trim();
      const value = parts.slice(1).join("=").trim();
      await page.context().addCookies([
        {
          name,
          value,
          domain: "localhost",
          path: "/",
        },
      ]);
    }

    await use(page);
  },

  adminPage: async ({ page, request }, use) => {
    // Create the first instance admin (ignore errors if already exists)
    await request.post(`${API_BASE}/api/instances/admins/sign-up/`, {
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        first_name: "Admin",
        last_name: "User",
        company_name: "E2E Test",
        is_telemetry_enabled: false,
      },
      maxRedirects: 0,
    }).catch(() => {});

    // Sign in via Better Auth to get a session cookie
    const signInRes = await request.post(`${API_BASE}/api/auth/sign-in/email`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    if (!signInRes.ok()) {
      throw new Error(`Admin sign-in failed: ${signInRes.status()} ${await signInRes.text()}`);
    }

    // Extract session cookies and set them on the page
    const cookies = signInRes
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value);

    for (const cookie of cookies) {
      const parts = cookie.split(";")[0]!.split("=");
      const name = parts[0]!.trim();
      const value = parts.slice(1).join("=").trim();
      await page.context().addCookies([
        { name, value, domain: "localhost", path: "/" },
      ]);
    }

    await use(page);
  },

  apiContext: async ({ playwright }, use) => {
    const email = `api-${Date.now()}@example.com`;
    const password = "TestPassword123!";

    const context = await playwright.request.newContext({
      baseURL: API_BASE,
    });

    const response = await context.post("/auth/sign-up/", {
      data: {
        email,
        password,
        first_name: "API",
        last_name: "User",
      },
    });

    if (!response.ok()) {
      throw new Error(`API signup failed: ${response.status()} ${await response.text()}`);
    }

    await use(context);
    await context.dispose();
  },
});

export { expect } from "@playwright/test";

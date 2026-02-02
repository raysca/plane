import { test as base, type Page, type APIRequestContext } from "@playwright/test";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

type TestFixtures = {
  authenticatedPage: Page;
  apiContext: APIRequestContext;
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

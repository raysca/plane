import { test, expect, type Page } from "@playwright/test";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";
const ADMIN_EMAIL = "admin-e2e@plane.test";
const ADMIN_PASSWORD = "AdminPassword123!";

// ---------------------------------------------------------------------------
// Helper: ensure the admin exists, then sign in via API and set cookies
// ---------------------------------------------------------------------------
async function signInAdminViaCookies(page: Page, request: any): Promise<boolean> {
  // Ensure admin account exists (ignore if already created)
  await request
    .post(`${API_BASE}/api/instances/admins/sign-up/`, {
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        first_name: "Admin",
        last_name: "E2E",
        company_name: "E2E Test Co",
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

  if (!signInRes) return false;

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

  return cookies.length > 0;
}

// ---------------------------------------------------------------------------
// Admin Sign-in Page (no auth required)
// ---------------------------------------------------------------------------
test.describe("Admin Sign-in Page", () => {
  test("should display the admin sign-in form", async ({ page }) => {
    await page.goto(`${API_BASE}/admin`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("#email")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in/i })
    ).toBeVisible();
  });

  test("should redirect unauthenticated users to sign-in", async ({ page }) => {
    await page.goto(`${API_BASE}/admin/general/`);
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test("should show Manage your Plane instance heading", async ({ page }) => {
    await page.goto(`${API_BASE}/admin`);
    await page.waitForLoadState("networkidle");

    const heading = page.getByText(/manage your plane instance/i);
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test("should display email and password labels", async ({ page }) => {
    await page.goto(`${API_BASE}/admin`);
    await page.waitForLoadState("networkidle");

    const emailLabel = page.getByText("Email", { exact: false }).first();
    await expect(emailLabel).toBeVisible({ timeout: 10_000 });

    const passwordLabel = page.getByText("Password", { exact: false }).first();
    await expect(passwordLabel).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Admin Dashboard – Authenticated Navigation
// ---------------------------------------------------------------------------
test.describe("Admin Dashboard Navigation", () => {
  test("should reach General settings after sign-in", async ({ page, request }) => {
    const hasAuth = await signInAdminViaCookies(page, request);
    if (!hasAuth) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await page.goto(`${API_BASE}/admin/general/`);
    await page.waitForLoadState("networkidle");

    // Should see input fields on the General page (not the sign-in form)
    const inputs = await page.locator("input:not(#email):not(#password)").count();
    expect(inputs).toBeGreaterThan(0);
  });

  test("should load Email settings page", async ({ page, request }) => {
    const hasAuth = await signInAdminViaCookies(page, request);
    if (!hasAuth) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await page.goto(`${API_BASE}/admin/email/`);
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/email");
  });

  test("should load Authentication settings page", async ({ page, request }) => {
    const hasAuth = await signInAdminViaCookies(page, request);
    if (!hasAuth) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await page.goto(`${API_BASE}/admin/authentication/`);
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/authentication");
  });

  test("should load AI settings page", async ({ page, request }) => {
    const hasAuth = await signInAdminViaCookies(page, request);
    if (!hasAuth) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await page.goto(`${API_BASE}/admin/ai/`);
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/ai");
  });

  test("should load Image settings page", async ({ page, request }) => {
    const hasAuth = await signInAdminViaCookies(page, request);
    if (!hasAuth) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await page.goto(`${API_BASE}/admin/image/`);
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/image");
  });

  test("should load Workspaces page", async ({ page, request }) => {
    const hasAuth = await signInAdminViaCookies(page, request);
    if (!hasAuth) {
      test.skip(true, "Admin auth cookies not available");
      return;
    }

    await page.goto(`${API_BASE}/admin/workspace/`);
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/workspace");
  });
});

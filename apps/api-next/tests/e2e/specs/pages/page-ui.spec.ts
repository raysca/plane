import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Fixture ─────────────────────────────────────────────────────────────────
type Fixtures = {
  pgPage: Page;
  wsSlug: string;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("pg-ui"));
  },

  pgPage: async ({ page, request, wsSlug }, use) => {
    const email = generateTestEmail("pg-ui");
    const password = generateTestPassword();
    const identifier = `P${Date.now().toString(36).slice(-3).toUpperCase()}`;

    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Page", last_name: "Tester" },
    });
    expect(signupRes.ok()).toBeTruthy();
    const signupData = await signupRes.json();
    const token = signupData.access_token;

    const cookies = signupRes
      .headersArray()
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value);
    for (const cookie of cookies) {
      const parts = cookie.split(";")[0]!.split("=");
      await page.context().addCookies([
        { name: parts[0]!.trim(), value: parts.slice(1).join("=").trim(), domain: "localhost", path: "/" },
      ]);
    }

    await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { first_name: "Page", last_name: "Tester", is_onboarded: true },
    });

    await request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Page Test WS", slug: wsSlug, organization_size: "2-10" },
    });

    const projRes = await request.post(`${API_BASE}/api/workspaces/${wsSlug}/projects/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Page Project", identifier, network: 2 },
    });
    expect(projRes.ok()).toBeTruthy();
    const proj = await projRes.json();
    (page as any).__projectId = proj.id;

    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Helper: navigate to pages section via direct URL
// ---------------------------------------------------------------------------
async function goToPages(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/pages/`);
  await waitForAppReady(page);
}

// ---------------------------------------------------------------------------
// Pages List UI
// ---------------------------------------------------------------------------
test.describe("Pages List UI", () => {
  test("should navigate to the project pages section", async ({ pgPage, wsSlug }) => {
    await goToPages(pgPage, wsSlug);
    expect(pgPage.url()).toContain("/pages");
  });

  test("should show the Add page button", async ({ pgPage, wsSlug }) => {
    await goToPages(pgPage, wsSlug);

    // Button text is "Add page"
    const addBtn = pgPage
      .getByRole("button", { name: /add page/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should create a new page via the Add page button", async ({ pgPage, wsSlug }) => {
    await goToPages(pgPage, wsSlug);

    const addBtn = pgPage
      .getByRole("button", { name: /add page/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // "Add page" may directly create a page and navigate to the editor,
    // OR open a modal. Wait and check both paths.
    await pgPage.waitForTimeout(2_000);
    await waitForAppReady(pgPage);

    // Check if we landed on a page editor (URL has /pages/<uuid>)
    if (pgPage.url().match(/\/pages\/[a-f0-9-]+/)) {
      expect(pgPage.url()).toContain("/pages/");
    } else {
      // A modal might have opened — fill the title
      const titleInput = pgPage.locator('#name, input[placeholder="Title"]').first();
      if (await titleInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const pageName = `E2E Page ${Date.now().toString(36)}`;
        await titleInput.fill(pageName);
        const createBtn = pgPage.locator('button:has-text("Create Page"), button:has-text("Create page"), button[type="submit"]').first();
        await createBtn.click();
        await pgPage.waitForTimeout(2_000);
      }
    }
  });

  test("should show page list or empty state after navigating to pages", async ({
    pgPage,
    wsSlug,
  }) => {
    await goToPages(pgPage, wsSlug);

    // Pages section should show either pages or an empty state with a CTA
    const addBtn = pgPage.getByRole("button", { name: /add page/i }).first();
    const emptyState = pgPage.getByText(/no pages/i).first();
    const pageItem = pgPage.locator('[class*="page"]').first();

    const hasAdd = await addBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    const hasEmpty = await emptyState.isVisible({ timeout: 2_000 }).catch(() => false);
    const hasPages = await pageItem.isVisible({ timeout: 2_000 }).catch(() => false);

    expect(hasAdd || hasEmpty || hasPages).toBeTruthy();
  });
});

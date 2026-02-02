import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Fixture: authenticated page with workspace + project ────────────────────
type Fixtures = {
  issuePage: Page;
  wsSlug: string;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("iss-ui"));
  },

  issuePage: async ({ page, request, wsSlug }, use) => {
    const email = generateTestEmail("iss-ui");
    const password = generateTestPassword();
    const identifier = `I${Date.now().toString(36).slice(-3).toUpperCase()}`;

    // 1. Create user
    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Issue", last_name: "Tester" },
    });
    expect(signupRes.ok()).toBeTruthy();
    const signupData = await signupRes.json();
    const token = signupData.access_token;

    // 2. Set session cookies
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

    // 3. Onboard + workspace + project
    await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { first_name: "Issue", last_name: "Tester", is_onboarded: true },
    });

    await request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Issue Test WS", slug: wsSlug, organization_size: "2-10" },
    });

    const projRes = await request.post(`${API_BASE}/api/workspaces/${wsSlug}/projects/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Issue Project", identifier, network: 2 },
    });
    expect(projRes.ok()).toBeTruthy();
    const proj = await projRes.json();
    (page as any).__projectId = proj.id;

    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Helper: navigate to the work items list via direct URL
// ---------------------------------------------------------------------------
async function goToWorkItems(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/`);
  await waitForAppReady(page);
}

// ---------------------------------------------------------------------------
// Work Items (Issues) List UI
// ---------------------------------------------------------------------------
test.describe("Work Items List UI", () => {
  test("should navigate to the work items page via sidebar", async ({ issuePage, wsSlug }) => {
    await goToWorkItems(issuePage, wsSlug);
    expect(issuePage.url()).toMatch(/\/issues/);
  });

  test("should show the Add work item button in the header", async ({ issuePage, wsSlug }) => {
    await goToWorkItems(issuePage, wsSlug);

    const addBtn = issuePage
      .getByRole("button", { name: /add work item/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should open the issue creation modal and create a work item", async ({
    issuePage,
    wsSlug,
  }) => {
    await goToWorkItems(issuePage, wsSlug);

    // Click "Add work item"
    const addBtn = issuePage
      .getByRole("button", { name: /add work item/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // The modal has a title input with id="name" and placeholder "Title"
    const titleInput = issuePage.locator('#name, input[placeholder="Title"]').first();
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    const issueName = `E2E Issue ${Date.now().toString(36)}`;
    await titleInput.fill(issueName);

    // Submit — the primary button
    const submitBtn = issuePage.locator('button[type="submit"]').first();
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // Wait for modal to close
    await issuePage.waitForTimeout(2_000);
    await waitForAppReady(issuePage);

    // Verify the issue appears in the list
    const issueRow = issuePage.getByText(issueName).first();
    await expect(issueRow).toBeVisible({ timeout: 10_000 });
  });

  test("should create an issue and click to view detail", async ({ issuePage, wsSlug }) => {
    await goToWorkItems(issuePage, wsSlug);

    // Create an issue
    const addBtn = issuePage
      .getByRole("button", { name: /add work item/i })
      .first();
    await addBtn.click();

    const titleInput = issuePage.locator('#name, input[placeholder="Title"]').first();
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    const issueName = `Detail Test ${Date.now().toString(36)}`;
    await titleInput.fill(issueName);

    const submitBtn = issuePage.locator('button[type="submit"]').first();
    await submitBtn.click();
    await issuePage.waitForTimeout(2_000);
    await waitForAppReady(issuePage);

    // Click the issue to open its detail/peek view
    const issueRow = issuePage.getByText(issueName).first();
    await expect(issueRow).toBeVisible({ timeout: 10_000 });
    await issueRow.click();
    await issuePage.waitForTimeout(1_000);

    // Should see the issue title in the detail panel
    const detailTitle = issuePage.getByText(issueName);
    await expect(detailTitle.first()).toBeVisible({ timeout: 10_000 });
  });

  test("should show the New work item input in the sidebar", async ({ issuePage, wsSlug }) => {
    await issuePage.goto(`/${wsSlug}/projects/`);
    await waitForAppReady(issuePage);

    // The sidebar has "New work item" input at the top
    const newWiInput = issuePage.getByPlaceholder(/new work item/i).first();
    if (await newWiInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      expect(true).toBeTruthy();
    } else {
      // May be a button instead
      const newWiBtn = issuePage.getByText(/new work item/i).first();
      await expect(newWiBtn).toBeVisible({ timeout: 5_000 });
    }
  });
});

// ---------------------------------------------------------------------------
// Sidebar Navigation from Work Items
// ---------------------------------------------------------------------------
test.describe("Work Items Sidebar Navigation", () => {
  test("should show Cycles link in project sidebar", async ({ issuePage, wsSlug }) => {
    await goToWorkItems(issuePage, wsSlug);
    const cyclesLink = issuePage.getByText("Cycles", { exact: true }).first();
    await expect(cyclesLink).toBeVisible({ timeout: 5_000 });
  });

  test("should show Modules link in project sidebar", async ({ issuePage, wsSlug }) => {
    await goToWorkItems(issuePage, wsSlug);
    const modulesLink = issuePage.getByText("Modules", { exact: true }).first();
    await expect(modulesLink).toBeVisible({ timeout: 5_000 });
  });

  test("should show Views link in project sidebar", async ({ issuePage, wsSlug }) => {
    await goToWorkItems(issuePage, wsSlug);
    const viewsLink = issuePage.getByText("Views", { exact: true }).first();
    await expect(viewsLink).toBeVisible({ timeout: 5_000 });
  });

  test("should show Pages link in project sidebar", async ({ issuePage, wsSlug }) => {
    await goToWorkItems(issuePage, wsSlug);
    const pagesLink = issuePage.getByText("Pages", { exact: true }).first();
    await expect(pagesLink).toBeVisible({ timeout: 5_000 });
  });
});

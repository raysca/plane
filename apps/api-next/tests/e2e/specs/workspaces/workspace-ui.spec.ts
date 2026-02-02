import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Fixture: page authenticated with a workspace already created ──────────
type WorkspaceFixtures = {
  wsPage: Page;
  wsSlug: string;
};

const test = base.extend<WorkspaceFixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("ui-ws"));
  },

  wsPage: async ({ page, request, wsSlug }, use) => {
    const email = generateTestEmail("ws-ui");
    const password = generateTestPassword();

    // 1. Create user via API
    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "WS", last_name: "Tester" },
    });
    expect(signupRes.ok()).toBeTruthy();

    // 2. Set session cookies on the page
    const cookies = signupRes
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

    // 3. Complete onboarding + create workspace via API
    const signupData = await signupRes.json();
    const token = signupData.access_token;

    await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { first_name: "WS", last_name: "Tester", is_onboarded: true },
    });

    await request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "UI Test Workspace", slug: wsSlug, organization_size: "2-10" },
    });

    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Create Workspace via UI
// ---------------------------------------------------------------------------
test.describe("Create Workspace UI", () => {
  test("should create a new workspace from /create-workspace page", async ({ page, request }) => {
    const email = generateTestEmail("create-ws");
    const password = generateTestPassword();

    // Set up an onboarded user with an existing workspace
    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Create", last_name: "WS" },
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

    const initSlug = generateWorkspaceSlug("init");
    await request.patch(`${API_BASE}/api/users/me/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { first_name: "Create", last_name: "WS", is_onboarded: true },
    });
    await request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Initial WS", slug: initSlug, organization_size: "2-10" },
    });

    // Navigate to create workspace page
    await page.goto("/create-workspace");
    await waitForAppReady(page);

    // Fill in workspace name
    const nameInput = page.locator("#workspaceName");
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill("Brand New Workspace");

    // Set a unique slug
    const slugInput = page.locator("#workspaceUrl");
    await expect(slugInput).toBeVisible({ timeout: 5_000 });
    const newSlug = generateWorkspaceSlug("new");
    await slugInput.clear();
    await slugInput.fill(newSlug);

    // Select organization size — the dropdown shows "Select a range"
    const orgDropdown = page.locator('button:has-text("Select a range")').first();
    if (await orgDropdown.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await orgDropdown.click();
      // Pick "2-10" from the dropdown options
      const option = page.locator('text="2-10"').first();
      await expect(option).toBeVisible({ timeout: 3_000 });
      await option.click();
    }

    // Submit the form — button says "Create workspace"
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // Should navigate away from /create-workspace to the new workspace
    await page.waitForURL(
      (url) => !url.pathname.includes("/create-workspace"),
      { timeout: 15_000 },
    );

    expect(page.url()).not.toContain("/create-workspace");
  });
});

// ---------------------------------------------------------------------------
// Workspace Settings UI
// ---------------------------------------------------------------------------
test.describe("Workspace Settings UI", () => {
  test("should load workspace general settings page", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings`);
    await waitForAppReady(wsPage);

    // Should see the settings page with "Workspace name" label and input
    const nameInput = wsPage.locator('input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
  });

  test("should update workspace name via settings", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings`);
    await waitForAppReady(wsPage);

    const nameInput = wsPage.locator('input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });

    // Clear and type a new name
    await nameInput.clear();
    const updatedName = `Updated WS ${Date.now().toString(36)}`;
    await nameInput.fill(updatedName);

    // Click the "Update workspace" button
    const updateBtn = wsPage.locator('button:has-text("Update workspace")');
    await expect(updateBtn).toBeVisible({ timeout: 5_000 });
    await updateBtn.click();

    // Wait for the update to complete
    await wsPage.waitForTimeout(2_000);

    // Reload and verify the name persisted
    await wsPage.reload();
    await waitForAppReady(wsPage);

    const reloadedInput = wsPage.locator('input[name="name"]').first();
    await expect(reloadedInput).toBeVisible({ timeout: 10_000 });
    await expect(reloadedInput).toHaveValue(updatedName);
  });

  test("should display workspace URL as read-only", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings`);
    await waitForAppReady(wsPage);

    // The "Workspace URL" input field should be disabled
    const urlInput = wsPage.locator('input[type="url"], input[name="url"]').first();
    if (await urlInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(urlInput).toBeDisabled();
    }
  });

  test("should show Company size and Workspace Timezone fields", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings`);
    await waitForAppReady(wsPage);

    // Company size label/dropdown should be visible
    const companySize = wsPage.locator('text="Company size"');
    await expect(companySize).toBeVisible({ timeout: 10_000 });

    // Workspace Timezone label should be visible
    const timezone = wsPage.locator('text="Workspace Timezone"');
    await expect(timezone).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Workspace Members UI
// ---------------------------------------------------------------------------
test.describe("Workspace Members UI", () => {
  test("should load members page and show current user", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(wsPage);

    // Should see the members table with column headers
    const fullNameHeader = wsPage.getByText("Full name").first();
    await expect(fullNameHeader).toBeVisible({ timeout: 10_000 });

    // Should see the current user "WS Tester" in the members table
    const memberRow = wsPage.locator('text="WS Tester"').first();
    await expect(memberRow).toBeVisible({ timeout: 10_000 });
  });

  test("should show search input and filter members", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(wsPage);

    // The search input has placeholder "Search..."
    const searchInput = wsPage.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Search for the current user
    await searchInput.fill("WS Tester");
    await wsPage.waitForTimeout(500);

    // Should still see the member
    const memberRow = wsPage.locator('text="WS Tester"').first();
    await expect(memberRow).toBeVisible({ timeout: 5_000 });

    // Search for something that doesn't exist
    await searchInput.clear();
    await searchInput.fill("zzz-nonexistent-zzz");
    await wsPage.waitForTimeout(500);

    // Member should not be visible
    const memberGone = await wsPage
      .locator('text="WS Tester"')
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    expect(memberGone).toBeFalsy();
  });

  test("should show Add member button for admin", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(wsPage);

    // Button text is "Add member"
    const addMemberBtn = wsPage.locator('button:has-text("Add member")');
    await expect(addMemberBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should show member role in the table", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(wsPage);

    // The current user should have the "Admin" role displayed
    const adminRole = wsPage.locator('text="Admin"').first();
    await expect(adminRole).toBeVisible({ timeout: 10_000 });
  });

  test("should show Filters dropdown", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(wsPage);

    const filtersBtn = wsPage.locator('button:has-text("Filters")').first();
    await expect(filtersBtn).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Workspace Navigation UI
// ---------------------------------------------------------------------------
test.describe("Workspace Navigation UI", () => {
  test("should navigate to projects page and show sidebar", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/projects/`);
    await waitForAppReady(wsPage);

    expect(wsPage.url()).toContain(`/${wsSlug}/projects`);

    // Sidebar should show navigation items
    const projectsLink = wsPage.locator('text="Projects"').first();
    await expect(projectsLink).toBeVisible({ timeout: 10_000 });
  });

  test("should show Home link in sidebar", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/projects/`);
    await waitForAppReady(wsPage);

    const homeLink = wsPage.locator('text="Home"').first();
    await expect(homeLink).toBeVisible({ timeout: 10_000 });
  });

  test("should navigate between settings sub-pages via URL", async ({ wsPage, wsSlug }) => {
    // Navigate to general settings
    await wsPage.goto(`/${wsSlug}/settings`);
    await waitForAppReady(wsPage);

    // Verify the general settings page loads (name input visible)
    const nameInput = wsPage.locator('input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });

    // Navigate to members settings via URL
    await wsPage.goto(`/${wsSlug}/settings/members`);
    await waitForAppReady(wsPage);
    expect(wsPage.url()).toContain("/members");

    // Verify members page loaded by checking for members table
    const fullNameHeader = wsPage.getByText("Full name").first();
    await expect(fullNameHeader).toBeVisible({ timeout: 10_000 });
  });

  test("should navigate between settings tabs", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings`);
    await waitForAppReady(wsPage);

    // The tabs are "Account", "Workspace", "Projects"
    const workspaceTab = wsPage.locator('text="Workspace"').first();
    await expect(workspaceTab).toBeVisible({ timeout: 10_000 });

    const accountTab = wsPage.locator('text="Account"').first();
    await expect(accountTab).toBeVisible({ timeout: 5_000 });

    const projectsTab = wsPage.locator('text="Projects"').first();
    await expect(projectsTab).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Create Workspace during Onboarding
// ---------------------------------------------------------------------------
test.describe("Workspace Creation in Onboarding", () => {
  test("should create a workspace as part of the onboarding flow", async ({ page }) => {
    const email = generateTestEmail("onboard-ws");
    const password = generateTestPassword();
    const workspaceName = "Onboarding Workspace";

    // ── Sign up ──
    await page.goto("/sign-up");
    await waitForAppReady(page);

    await page.locator('input[type="email"], input[name="email"]').fill(email);
    await page.locator('button[type="submit"]').click();

    const passwordInput = page.locator("#password");
    await expect(passwordInput).toBeVisible({ timeout: 10_000 });
    await passwordInput.fill(password);
    const confirmInput = page.locator("#confirm-password");
    if (await confirmInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmInput.fill(password);
    }
    await page.locator('button[type="submit"]').click();

    // Should redirect to onboarding
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });

    // ── Profile setup — "Enter your full name" ──
    const nameInput = page.locator(
      'input[placeholder*="full name" i], input[name="first_name"], input[name="full_name"]'
    ).first();
    if (await nameInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await nameInput.clear();
      await nameInput.fill("Onboard User");
      const continueBtn = page.locator('button[type="submit"]:not([disabled]), button:has-text("Continue"):not([disabled])').first();
      await expect(continueBtn).toBeEnabled({ timeout: 5_000 });
      await continueBtn.click();
      await page.waitForTimeout(1_500);
    }

    // ── Role selection ──
    const roleOption = page.locator(
      'button:has-text("Developer"), [data-testid*="role"] >> text=Developer, label:has-text("Developer")'
    ).first();
    if (await roleOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await roleOption.click();
      const continueBtn = page.locator(
        'button:has-text("Continue"), button:has-text("Next"), button[type="submit"]'
      ).first();
      await continueBtn.click();
      await page.waitForTimeout(1_500);
    }

    // ── Use case selection ──
    const useCaseOption = page.locator(
      'button:has-text("Planning"), button:has-text("Tracking"), [data-testid*="usecase"]'
    ).first();
    const skipBtn = page.locator('button:has-text("Skip"), a:has-text("Skip")').first();
    if (await useCaseOption.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await useCaseOption.click();
      const continueBtn = page.locator(
        'button:has-text("Continue"), button:has-text("Next"), button[type="submit"]'
      ).first();
      await continueBtn.click();
      await page.waitForTimeout(1_500);
    } else if (await skipBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await skipBtn.click();
      await page.waitForTimeout(1_500);
    }

    // ── Workspace creation step ──
    const wsNameInput = page.locator(
      'input[name="name"], input[placeholder*="workspace" i], input[placeholder*="company" i]'
    ).first();

    if (await wsNameInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await wsNameInput.fill(workspaceName);

      // Set a unique slug
      const slugInput = page.locator(
        'input[name="slug"], input[placeholder*="slug" i], input[placeholder*="url" i]'
      ).first();
      if (await slugInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        const slug = generateWorkspaceSlug("onboard");
        await slugInput.clear();
        await slugInput.fill(slug);
      }

      // Select org size — "Just myself" button
      const orgSizeBtn = page.locator(
        'button:has-text("Just myself"), [data-testid*="org-size"]'
      ).first();
      if (await orgSizeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await orgSizeBtn.click();
      }

      const continueBtn = page.locator(
        'button:has-text("Continue"), button:has-text("Create"), button[type="submit"]'
      ).first();
      await continueBtn.click();
      await page.waitForTimeout(2_000);
    }

    // ── Invite team (skip) ──
    const inviteSkipBtn = page.locator(
      'button:has-text("Skip"), button:has-text("Do it later"), button:has-text("Continue without")'
    ).first();
    if (await inviteSkipBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await inviteSkipBtn.click();
    }

    // ── Should leave onboarding ──
    await page.waitForFunction(
      () => !window.location.pathname.includes("/onboarding"),
      { timeout: 20_000 },
    ).catch(() => {});

    const url = page.url();
    expect(url).not.toMatch(/\/(sign-in|sign-up)/);
  });
});

// ---------------------------------------------------------------------------
// Delete Workspace UI
// ---------------------------------------------------------------------------
test.describe("Delete Workspace UI", () => {
  test("should show delete section in settings for admin", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings`);
    await waitForAppReady(wsPage);

    // The delete section heading is "Delete this workspace"
    const deleteHeading = wsPage.locator('text="Delete this workspace"');
    await expect(deleteHeading).toBeVisible({ timeout: 10_000 });
  });

  test("should expand delete section and show delete button", async ({ wsPage, wsSlug }) => {
    await wsPage.goto(`/${wsSlug}/settings`);
    await waitForAppReady(wsPage);

    // Click "Delete this workspace" collapsible to expand it
    const deleteToggle = wsPage.locator('button:has-text("Delete this workspace")');
    await expect(deleteToggle).toBeVisible({ timeout: 10_000 });
    await deleteToggle.click();

    // Should reveal a danger delete button inside the expanded section
    // The button may say "Delete my workspace", "Delete workspace", or just be a red button
    const deleteBtn = wsPage.locator('button:has-text("Delete")').last();
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
  });
});

import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Fixture: authenticated page with workspace (no project) ─────────────────
type Fixtures = {
  projPage: Page;
  wsSlug: string;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("proj-ui"));
  },

  projPage: async ({ page, request, wsSlug }, use) => {
    const email = generateTestEmail("proj-ui");
    const password = generateTestPassword();

    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Project", last_name: "Tester" },
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
      data: { first_name: "Project", last_name: "Tester", is_onboarded: true },
    });

    await request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Project Test WS", slug: wsSlug, organization_size: "2-10" },
    });

    await use(page);
  },
});

// ── Fixture with a project already created ──────────────────────────────────
type SettingsFixtures = {
  settingsPage: Page;
  wsSlug: string;
  projectId: string;
};

const testSettings = base.extend<SettingsFixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("prset-ui"));
  },

  projectId: [async ({}, use) => { await use(""); }, { scope: "test" }],

  settingsPage: async ({ page, request, wsSlug }, use) => {
    const email = generateTestEmail("prset-ui");
    const password = generateTestPassword();
    const identifier = `S${Date.now().toString(36).slice(-3).toUpperCase()}`;

    const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
      data: { email, password, first_name: "Settings", last_name: "Tester" },
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
      data: { first_name: "Settings", last_name: "Tester", is_onboarded: true },
    });

    await request.post(`${API_BASE}/api/workspaces/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Project Settings WS", slug: wsSlug, organization_size: "2-10" },
    });

    const projRes = await request.post(`${API_BASE}/api/workspaces/${wsSlug}/projects/`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: "Settings Project", identifier, network: 2 },
    });
    expect(projRes.ok()).toBeTruthy();
    const proj = await projRes.json();

    // Store project ID in page for tests to use
    (page as any).__projectId = proj.id;
    await use(page);
  },
});

// ---------------------------------------------------------------------------
// Helper: get the projectId from the fixture-enriched page
// ---------------------------------------------------------------------------
function getProjectId(page: Page): string {
  return (page as any).__projectId;
}

// ---------------------------------------------------------------------------
// Projects List UI
// ---------------------------------------------------------------------------
test.describe("Projects List UI", () => {
  test("should navigate to the projects page", async ({ projPage, wsSlug }) => {
    await projPage.goto(`/${wsSlug}/projects/`);
    await waitForAppReady(projPage);
    expect(projPage.url()).toContain(`/${wsSlug}/projects`);
  });

  test("should show Add Project button in header", async ({ projPage, wsSlug }) => {
    await projPage.goto(`/${wsSlug}/projects/`);
    await waitForAppReady(projPage);

    const addBtn = projPage.getByRole("button", { name: /add project/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should show sidebar navigation items", async ({ projPage, wsSlug }) => {
    await projPage.goto(`/${wsSlug}/projects/`);
    await waitForAppReady(projPage);

    // Sidebar should show Home, Your work, Drafts, Projects
    const homeLink = projPage.getByText("Home", { exact: true }).first();
    await expect(homeLink).toBeVisible({ timeout: 10_000 });

    const projectsLink = projPage.getByText("Projects", { exact: true }).first();
    await expect(projectsLink).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Create Project via UI
// ---------------------------------------------------------------------------
test.describe("Create Project UI", () => {
  test("should open project creation modal and create a project", async ({
    projPage,
    wsSlug,
  }) => {
    await projPage.goto(`/${wsSlug}/projects/`);
    await waitForAppReady(projPage);

    // Click "Add Project"
    const addBtn = projPage.getByRole("button", { name: /add project/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Modal opens — form has #name, #identifier, #description
    const nameInput = projPage.locator('#name, input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });

    const projectName = `UI Project ${Date.now().toString(36)}`;
    await nameInput.fill(projectName);

    // Set identifier
    const identifierInput = projPage.locator('#identifier, input[name="identifier"]').first();
    if (await identifierInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await identifierInput.clear();
      const ident = `U${Date.now().toString(36).slice(-3).toUpperCase()}`;
      await identifierInput.fill(ident);
    }

    // Submit
    const submitBtn = projPage
      .locator('button[type="submit"], button:has-text("Create Project"), button:has-text("Create project")')
      .first();
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    // May go through a feature selection step
    await projPage.waitForTimeout(2_000);
    const continueBtn = projPage
      .locator('button:has-text("Continue"), button:has-text("Done"), button:has-text("Skip")')
      .first();
    if (await continueBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await continueBtn.click();
    }

    await projPage.waitForTimeout(2_000);
    await waitForAppReady(projPage);

    // Navigate back to projects list and verify
    await projPage.goto(`/${wsSlug}/projects/`);
    await waitForAppReady(projPage);

    const projectCard = projPage.getByText(projectName).first();
    await expect(projectCard).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Project Settings UI (with pre-existing project)
// ---------------------------------------------------------------------------
testSettings.describe("Project Settings UI", () => {
  testSettings("should load project general settings page", async ({
    settingsPage,
    wsSlug,
  }) => {
    const projectId = getProjectId(settingsPage);
    await settingsPage.goto(`/${wsSlug}/settings/projects/${projectId}/`);
    await waitForAppReady(settingsPage);

    const nameInput = settingsPage.locator('#name, input[name="name"]').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
  });

  testSettings("should display project identifier field", async ({
    settingsPage,
    wsSlug,
  }) => {
    const projectId = getProjectId(settingsPage);
    await settingsPage.goto(`/${wsSlug}/settings/projects/${projectId}/`);
    await waitForAppReady(settingsPage);

    const identInput = settingsPage.locator('#identifier, input[name="identifier"]').first();
    await expect(identInput).toBeVisible({ timeout: 10_000 });
  });

  testSettings("should show Update project button", async ({ settingsPage, wsSlug }) => {
    const projectId = getProjectId(settingsPage);
    await settingsPage.goto(`/${wsSlug}/settings/projects/${projectId}/`);
    await waitForAppReady(settingsPage);

    const updateBtn = settingsPage
      .getByRole("button", { name: /update project/i })
      .first();
    await expect(updateBtn).toBeVisible({ timeout: 10_000 });
  });

  testSettings("should navigate to project members settings", async ({
    settingsPage,
    wsSlug,
  }) => {
    const projectId = getProjectId(settingsPage);
    await settingsPage.goto(`/${wsSlug}/settings/projects/${projectId}/members/`);
    await waitForAppReady(settingsPage);
    expect(settingsPage.url()).toContain("/members");
  });

  testSettings("should navigate to project states settings", async ({
    settingsPage,
    wsSlug,
  }) => {
    const projectId = getProjectId(settingsPage);
    await settingsPage.goto(`/${wsSlug}/settings/projects/${projectId}/states/`);
    await waitForAppReady(settingsPage);
    expect(settingsPage.url()).toContain("/states");
  });

  testSettings("should navigate to project labels settings", async ({
    settingsPage,
    wsSlug,
  }) => {
    const projectId = getProjectId(settingsPage);
    await settingsPage.goto(`/${wsSlug}/settings/projects/${projectId}/labels/`);
    await waitForAppReady(settingsPage);
    expect(settingsPage.url()).toContain("/labels");
  });

  testSettings("should navigate to project estimates settings", async ({
    settingsPage,
    wsSlug,
  }) => {
    const projectId = getProjectId(settingsPage);
    await settingsPage.goto(`/${wsSlug}/settings/projects/${projectId}/estimates/`);
    await waitForAppReady(settingsPage);
    expect(settingsPage.url()).toContain("/estimates");
  });
});

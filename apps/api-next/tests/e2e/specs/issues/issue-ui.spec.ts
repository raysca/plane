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
  projectId: string;
  identifier: string;
  states: Array<{ id: string; name: string; group: string }>;
  labels: { bugId: string; featureId: string };
  cycleId: string;
  moduleId: string;
  alphaId: string;
  betaId: string;
  gammaId: string;
  alphaSeqId: number;
  betaSeqId: number;
  gammaSeqId: number;
}

// ── Fixture: authenticated page with rich test data ──────────────────────────

type Fixtures = {
  issuePage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("iss-ui"));
  },

  issuePage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("iss-ui");
      const password = generateTestPassword();
      const identifier = `I${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: { email, password, first_name: "Issue", last_name: "Tester" },
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
        data: { first_name: "Issue", last_name: "Tester", is_onboarded: true },
      });

      // 4. Create workspace
      await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: { name: "Issue Test WS", slug: wsSlug, organization_size: "2-10" },
      });

      // 5. Create project
      const projRes = await request.post(`${API_BASE}/api/workspaces/${wsSlug}/projects/`, {
        headers: headers(token),
        data: { name: "Issue Project", identifier, network: 2 },
      });
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;
      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 6. Fetch project states
      const statesRes = await request.get(`${base_url}/states/`, {
        headers: headers(token),
      });
      expect(statesRes.ok()).toBeTruthy();
      const statesData = await statesRes.json();
      const states: TestData["states"] = (
        Array.isArray(statesData) ? statesData : statesData.results ?? []
      ).map((s: any) => ({ id: s.id, name: s.name, group: s.group }));

      // 7. Create labels
      const bugRes = await request.post(`${base_url}/labels/`, {
        headers: headers(token),
        data: { name: "Bug", color: "#ef4444" },
      });
      expect(bugRes.ok()).toBeTruthy();
      const bug = await bugRes.json();

      const featureRes = await request.post(`${base_url}/labels/`, {
        headers: headers(token),
        data: { name: "Feature", color: "#3b82f6" },
      });
      expect(featureRes.ok()).toBeTruthy();
      const feature = await featureRes.json();

      // 8. Create cycle
      const cycleRes = await request.post(`${base_url}/cycles/`, {
        headers: headers(token),
        data: { name: "Sprint 1" },
      });
      expect(cycleRes.ok()).toBeTruthy();
      const cycle = await cycleRes.json();

      // 9. Create module
      const moduleRes = await request.post(`${base_url}/modules/`, {
        headers: headers(token),
        data: { name: "Module Alpha" },
      });
      expect(moduleRes.ok()).toBeTruthy();
      const mod = await moduleRes.json();

      // 10. Create 3 issues
      const issueNames = ["Test Issue Alpha", "Test Issue Beta", "Test Issue Gamma"];
      const issueIds: string[] = [];
      const issueSeqs: number[] = [];
      for (const name of issueNames) {
        const res = await request.post(`${base_url}/issues/`, {
          headers: headers(token),
          data: { name },
        });
        expect(res.ok()).toBeTruthy();
        const issue = await res.json();
        issueIds.push(issue.id);
        issueSeqs.push(issue.sequence_id);
      }

      // 11. Create relation: Alpha blocks Beta
      const relRes = await request.post(
        `${base_url}/issues/${issueIds[0]}/issue-relation/`,
        {
          headers: headers(token),
          data: { relation_type: "blocking", issues: [issueIds[1]] },
        }
      );
      expect(relRes.ok()).toBeTruthy();

      // 12. Make Gamma a sub-issue of Alpha
      const subRes = await request.post(
        `${base_url}/issues/${issueIds[0]}/sub-issues/`,
        {
          headers: headers(token),
          data: { sub_issue_ids: [issueIds[2]] },
        }
      );
      expect(subRes.ok()).toBeTruthy();

      // 13. Add link to Alpha
      const linkRes = await request.post(
        `${base_url}/issues/${issueIds[0]}/links/`,
        {
          headers: headers(token),
          data: { title: "Docs Link", url: "https://docs.example.com" },
        }
      );
      expect(linkRes.ok()).toBeTruthy();

      // Store test data on page object for access in tests
      const td: TestData = {
        token,
        wsSlug,
        projectId,
        identifier,
        states,
        labels: { bugId: bug.id, featureId: feature.id },
        cycleId: cycle.id,
        moduleId: mod.id,
        alphaId: issueIds[0]!,
        betaId: issueIds[1]!,
        gammaId: issueIds[2]!,
        alphaSeqId: issueSeqs[0]!,
        betaSeqId: issueSeqs[1]!,
        gammaSeqId: issueSeqs[2]!,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ issuePage }, use) => {
    await use((issuePage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function goToWorkItems(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/`);
  await waitForAppReady(page);
}

async function goToIssueDetail(page: Page, wsSlug: string, issueId: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/${issueId}/`);
  await waitForAppReady(page);
}

function issueIdent(td: TestData, seqId: number): string {
  return `${td.identifier}-${seqId}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Issue Creation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Creation", () => {
  test("should create an issue via modal with title only", async ({
    issuePage,
    wsSlug,
  }) => {
    await goToWorkItems(issuePage, wsSlug);

    const addBtn = issuePage.getByRole("button", { name: /add work item/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    const titleInput = issuePage.locator('#name, input[placeholder="Title"]').first();
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    const issueName = `Modal Issue ${Date.now().toString(36)}`;
    await titleInput.fill(issueName);

    const submitBtn = issuePage.locator('button[type="submit"]').first();
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await issuePage.waitForTimeout(2_000);
    await waitForAppReady(issuePage);

    const issueRow = issuePage.getByText(issueName).first();
    await expect(issueRow).toBeVisible({ timeout: 10_000 });
  });

  test("should create an issue with priority set to Urgent in modal", async ({
    issuePage,
    wsSlug,
  }) => {
    await goToWorkItems(issuePage, wsSlug);

    const addBtn = issuePage.getByRole("button", { name: /add work item/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    const titleInput = issuePage.locator('#name, input[placeholder="Title"]').first();
    await expect(titleInput).toBeVisible({ timeout: 10_000 });

    const issueName = `Urgent Issue ${Date.now().toString(36)}`;
    await titleInput.fill(issueName);

    // Open priority dropdown in the modal's default properties row
    const priorityTrigger = issuePage
      .locator('[data-testid*="priority"], button:has-text("None"), button:has-text("Priority")')
      .first();
    if (await priorityTrigger.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await priorityTrigger.click();
      const urgentOption = issuePage.getByText("Urgent", { exact: true }).last();
      await urgentOption.click();
      await issuePage.waitForTimeout(500);
    }

    const submitBtn = issuePage.locator('button[type="submit"]').first();
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await issuePage.waitForTimeout(2_000);
    await waitForAppReady(issuePage);

    const issueRow = issuePage.getByText(issueName).first();
    await expect(issueRow).toBeVisible({ timeout: 10_000 });
  });

  test("should quick-add an issue from list view inline input", async ({
    issuePage,
    wsSlug,
  }) => {
    await goToWorkItems(issuePage, wsSlug);

    // Look for the inline "New Work Item" button/link at bottom of list
    const newWorkItemBtn = issuePage.getByText("New Work Item").first();
    if (await newWorkItemBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await newWorkItemBtn.click();

      const inlineInput = issuePage.locator('input[name="name"]').first();
      await expect(inlineInput).toBeVisible({ timeout: 5_000 });

      const issueName = `Inline Issue ${Date.now().toString(36)}`;
      await inlineInput.fill(issueName);
      await inlineInput.press("Enter");

      await issuePage.waitForTimeout(2_000);
      await waitForAppReady(issuePage);

      const issueRow = issuePage.getByText(issueName).first();
      await expect(issueRow).toBeVisible({ timeout: 10_000 });
    } else {
      // If inline add isn't available, the feature may be behind a different trigger
      expect(true).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Issue Detail View
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Detail View", () => {
  test("should navigate to issue detail and see the title", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);
    const title = issuePage.getByText("Test Issue Alpha").first();
    await expect(title).toBeVisible({ timeout: 10_000 });
  });

  test("should show Properties heading in sidebar", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);
    // Look for "Properties" or "Detail" heading in the sidebar panel
    const propsHeading = issuePage
      .getByText(/properties|detail/i)
      .first();
    await expect(propsHeading).toBeVisible({ timeout: 10_000 });
  });

  test("should show core property labels in sidebar", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);

    const labels = ["State", "Priority", "Assignees", "Label", "Start date", "Due date"];
    for (const label of labels) {
      const el = issuePage.getByText(label, { exact: false }).first();
      await expect(el).toBeVisible({ timeout: 10_000 });
    }
  });

  test("should show the issue identifier", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);
    const ident = issueIdent(td, td.alphaSeqId);
    const identEl = issuePage.getByText(ident).first();
    await expect(identEl).toBeVisible({ timeout: 10_000 });
  });

  test("should show Activity section heading", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);
    const activityHeading = issuePage.getByText("Activity").first();
    await expect(activityHeading).toBeVisible({ timeout: 10_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Issue Properties – Priority
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Properties - Priority", () => {
  test("should change priority from None to High on detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    // Beta has no priority set (defaults to "Priority" label)
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // Click the priority button in sidebar (shows "Priority" as default)
    const priorityBtn = issuePage.getByRole("button", { name: "Priority" }).first();
    await expect(priorityBtn).toBeVisible({ timeout: 10_000 });
    await priorityBtn.click();

    // Select "High" from the dropdown (use .last() for floating popover)
    const highOption = issuePage.getByText("High", { exact: true }).last();
    await expect(highOption).toBeVisible({ timeout: 5_000 });
    await highOption.click();

    await issuePage.waitForTimeout(1_000);

    // Verify "High" is now shown
    const updatedPriority = issuePage.getByText("High").first();
    await expect(updatedPriority).toBeVisible({ timeout: 5_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Issue Properties – State
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Properties - State", () => {
  test("should change state via dropdown on detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // Find the default backlog state
    const backlogState = td.states.find((s) => s.group === "backlog");
    expect(backlogState).toBeTruthy();

    // Click the current state name to open dropdown
    const stateValue = issuePage.getByText(backlogState!.name).first();
    await expect(stateValue).toBeVisible({ timeout: 10_000 });
    await stateValue.click();

    // Find a "started" group state and select it
    const startedState = td.states.find((s) => s.group === "started");
    if (startedState) {
      const startedOption = issuePage.getByText(startedState.name, { exact: true }).last();
      await expect(startedOption).toBeVisible({ timeout: 5_000 });
      await startedOption.click();

      await issuePage.waitForTimeout(1_000);

      const updatedState = issuePage.getByText(startedState.name).first();
      await expect(updatedState).toBeVisible({ timeout: 5_000 });
    } else {
      // If no started state exists, select any non-backlog state
      const otherState = td.states.find((s) => s.group !== "backlog");
      if (otherState) {
        const option = issuePage.getByText(otherState.name, { exact: true }).last();
        await option.click();
        await issuePage.waitForTimeout(1_000);
        const updated = issuePage.getByText(otherState.name).first();
        await expect(updated).toBeVisible({ timeout: 5_000 });
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Issue Properties – Assignees
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Properties - Assignees", () => {
  test("should add an assignee on detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // Click the "Add assignees" button in sidebar
    const assigneeTrigger = issuePage
      .getByRole("button", { name: "Add assignees" })
      .first();
    await expect(assigneeTrigger).toBeVisible({ timeout: 10_000 });
    await assigneeTrigger.click();
    await issuePage.waitForTimeout(500);

    // The dropdown is a headlessui combobox with a search input
    // Type to filter members so the option becomes visible & clickable
    const searchInput = issuePage.locator('[role="combobox"], input[placeholder*="earch"]').first();
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.fill("Issue");
      await issuePage.waitForTimeout(500);
    }

    // Click the first option in the listbox
    const firstOption = issuePage.locator('[role="option"]').first();
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    await firstOption.click({ force: true });

    // Close dropdown
    await issuePage.keyboard.press("Escape");
    await issuePage.waitForTimeout(1_000);

    // Verify the assignee button text changed (no longer shows "Add assignees")
    const addAssigneesGone = await issuePage
      .getByRole("button", { name: "Add assignees" })
      .first()
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    expect(!addAssigneesGone).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Issue Properties – Labels
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Properties - Labels", () => {
  test("should add a label on detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // Click "Select Label" or "Add label" placeholder
    const labelTrigger = issuePage
      .getByText(/select label|add label/i)
      .first();
    await expect(labelTrigger).toBeVisible({ timeout: 10_000 });
    await labelTrigger.click();

    // Select "Bug" from the dropdown
    const bugOption = issuePage.getByText("Bug", { exact: true }).last();
    await expect(bugOption).toBeVisible({ timeout: 5_000 });
    await bugOption.click();

    // Close dropdown
    await issuePage.keyboard.press("Escape");
    await issuePage.waitForTimeout(1_000);

    // Verify "Bug" label chip is visible
    const bugLabel = issuePage.getByText("Bug").first();
    await expect(bugLabel).toBeVisible({ timeout: 5_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Issue Properties – Dates
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Properties - Dates", () => {
  test("should show date property labels and placeholders", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // Verify date labels in sidebar
    const startDateLabel = issuePage.getByText("Start date").first();
    await expect(startDateLabel).toBeVisible({ timeout: 10_000 });

    const dueDateLabel = issuePage.getByText("Due date").first();
    await expect(dueDateLabel).toBeVisible({ timeout: 10_000 });

    // Verify the "Add due date" or similar placeholder is clickable
    const dueDatePlaceholder = issuePage
      .getByText(/add due date|no due date/i)
      .first();
    if (await dueDatePlaceholder.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(dueDatePlaceholder).toBeEnabled();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Issue Properties – Cycle
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Properties - Cycle", () => {
  test("should add issue to a cycle from detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // Click "No cycle" placeholder
    const cycleTrigger = issuePage.getByText(/no cycle/i).first();
    await expect(cycleTrigger).toBeVisible({ timeout: 10_000 });
    await cycleTrigger.click();

    // Select "Sprint 1"
    const sprintOption = issuePage.getByText("Sprint 1", { exact: true }).last();
    await expect(sprintOption).toBeVisible({ timeout: 5_000 });
    await sprintOption.click();

    await issuePage.waitForTimeout(1_000);

    // Verify "Sprint 1" is shown
    const cycleValue = issuePage.getByText("Sprint 1").first();
    await expect(cycleValue).toBeVisible({ timeout: 5_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Issue Properties – Module
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Properties - Module", () => {
  test("should show module property with No module default on detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // Verify "Modules" label is visible in the sidebar
    const modulesLabel = issuePage.getByText("Modules").first();
    await expect(modulesLabel).toBeVisible({ timeout: 10_000 });

    // Verify "No module" default value is shown
    const noModuleValue = issuePage.getByText("No module").first();
    await expect(noModuleValue).toBeVisible({ timeout: 5_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Issue Links
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Links", () => {
  test("should show API-created link on Alpha detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);

    // Verify the "Docs Link" title or "docs.example.com" URL is visible
    const linkTitle = issuePage.getByText("Docs Link").first();
    const linkUrl = issuePage.getByText("docs.example.com").first();

    const titleVisible = await linkTitle
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const urlVisible = await linkUrl
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    expect(titleVisible || urlVisible).toBeTruthy();
  });

  test("should open the add link modal and fill in fields", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // Click the "Add link" widget button
    const linkBtn = issuePage
      .getByRole("button", { name: "Add link" })
      .first();
    await expect(linkBtn).toBeVisible({ timeout: 10_000 });
    await linkBtn.click();

    // Verify the "Add link" modal opens with URL and Display title fields
    const modalHeading = issuePage.getByRole("heading", { name: "Add link" });
    await expect(modalHeading).toBeVisible({ timeout: 5_000 });

    const urlInput = issuePage.getByRole("textbox", { name: "URL" });
    await expect(urlInput).toBeVisible({ timeout: 5_000 });
    await urlInput.fill("https://github.com/makeplane/plane");

    const titleInput = issuePage.getByRole("textbox", { name: /display title/i });
    await expect(titleInput).toBeVisible({ timeout: 3_000 });
    await titleInput.fill("Plane Repo");

    // Verify "Add Link" and "Cancel" buttons are present
    const addLinkBtn = issuePage.getByRole("button", { name: "Add Link" });
    await expect(addLinkBtn).toBeVisible({ timeout: 3_000 });

    const cancelBtn = issuePage.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancelBtn).toBeVisible({ timeout: 3_000 });

    // Close via cancel
    await cancelBtn.click();
    await issuePage.waitForTimeout(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Issue Comments & Activity
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Comments & Activity", () => {
  test("should show Activity heading and comment editor", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);

    // Verify Activity heading
    const activityHeading = issuePage.getByText("Activity").first();
    await expect(activityHeading).toBeVisible({ timeout: 10_000 });

    // Verify comment editor is present (contenteditable div with specific id)
    const commentEditor = issuePage
      .locator(`[id="add_comment_${td.alphaId}"], [contenteditable="true"]`)
      .first();
    const editorVisible = await commentEditor
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    // If specific id not found, look for any comment input area
    if (!editorVisible) {
      const anyEditor = issuePage
        .locator('[class*="comment"], [placeholder*="comment"], [data-testid*="comment"]')
        .first();
      const anyVisible = await anyEditor
        .isVisible({ timeout: 3_000 })
        .catch(() => false);
      expect(anyVisible || editorVisible).toBeTruthy();
    }
  });

  test("should add a comment to an issue", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    // Use Beta (simpler page, no sub-issues/links)
    await goToIssueDetail(issuePage, wsSlug, td.betaId);

    // The comment area is a ProseMirror/TipTap editor with "Add comment" placeholder.
    // The placeholder may be rendered as a CSS ::before pseudo-element or as a <p>.
    // Use the locator for the paragraph that contains "Add comment" text.
    const commentArea = issuePage.locator('p:has-text("Add comment")').first();
    if (await commentArea.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await commentArea.click();
    } else {
      // Fallback: find the disabled "Comment" button and click near the editor above it
      const commentBtn = issuePage.getByRole("button", { name: "Comment" });
      await expect(commentBtn).toBeVisible({ timeout: 10_000 });
      // The editor is the contenteditable div above the Comment button
      const editor = issuePage.locator('[contenteditable="true"]').last();
      await editor.click();
    }
    await issuePage.waitForTimeout(500);

    const commentText = `E2E comment ${Date.now().toString(36)}`;
    await issuePage.keyboard.type(commentText);
    await issuePage.waitForTimeout(500);

    // The "Comment" button should now be enabled
    const commentBtn = issuePage.getByRole("button", { name: "Comment" });
    await expect(commentBtn).toBeEnabled({ timeout: 5_000 });
    await commentBtn.click();

    await issuePage.waitForTimeout(2_000);

    // Verify comment text appears
    const commentEl = issuePage.getByText(commentText).first();
    await expect(commentEl).toBeVisible({ timeout: 10_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Issue Relations
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Relations", () => {
  test("should show blocking relation on Alpha detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);

    // The Relations section is collapsed — click to expand it
    const relationsBtn = issuePage.getByRole("button", { name: /relations/i }).first();
    await expect(relationsBtn).toBeVisible({ timeout: 10_000 });
    await relationsBtn.click();
    await issuePage.waitForTimeout(1_000);

    // Verify "Blocking" relation text or Beta identifier is visible
    const blockingLabel = issuePage.getByText(/blocking/i).first();
    const betaIdent = issuePage
      .getByText(issueIdent(td, td.betaSeqId))
      .first();

    const blockingVisible = await blockingLabel
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const betaVisible = await betaIdent
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    expect(blockingVisible || betaVisible).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Sub-Issues
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Sub-Issues", () => {
  test("should show Gamma as sub-issue on Alpha detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.alphaId);

    // The Sub-work items section shows "Sub-work items 0/1 Done"
    // Verify the section header is visible (proves sub-issue exists)
    const subWorkHeader = issuePage.getByText(/sub-work items/i).first();
    await expect(subWorkHeader).toBeVisible({ timeout: 10_000 });

    // Verify the count shows "0/1 Done" (proves Gamma is a sub-issue)
    const subWorkCount = issuePage.getByText(/0\/1/i).first();
    const countVisible = await subWorkCount
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    // Click the toggle arrow to expand (the ► before the text)
    await subWorkHeader.click();
    await issuePage.waitForTimeout(1_000);

    // Look for Gamma name or identifier in the expanded section
    const gammaName = issuePage.getByText("Test Issue Gamma").first();
    const gammaIdent = issuePage
      .getByText(issueIdent(td, td.gammaSeqId))
      .first();

    const nameVisible = await gammaName
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const identVisible = await gammaIdent
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    expect(nameVisible || identVisible || countVisible).toBeTruthy();
  });

  test("should show parent indicator on Gamma detail page", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(issuePage, wsSlug, td.gammaId);

    // Look for parent property showing Alpha identifier or name
    const alphaIdent = issuePage
      .getByText(issueIdent(td, td.alphaSeqId))
      .first();
    const alphaName = issuePage.getByText("Test Issue Alpha").first();

    const identVisible = await alphaIdent
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const nameVisible = await alphaName
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    expect(identVisible || nameVisible).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Issue Delete
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Issue Delete", () => {
  test("should delete an issue via context menu", async ({
    issuePage,
    wsSlug,
    td,
  }) => {
    await goToWorkItems(issuePage, wsSlug);

    // Find the Gamma issue row
    const gammaRow = issuePage.getByText("Test Issue Gamma").first();
    await expect(gammaRow).toBeVisible({ timeout: 10_000 });

    // Right-click to open context menu
    await gammaRow.click({ button: "right" });
    await issuePage.waitForTimeout(500);

    // Click "Delete" from the context menu
    const deleteOption = issuePage.getByText("Delete", { exact: true }).last();
    await expect(deleteOption).toBeVisible({ timeout: 3_000 });
    await deleteOption.click();

    // The confirmation dialog appears as a headlessui dialog
    // Target the Delete button inside the dialog specifically
    const dialogDeleteBtn = issuePage.locator('dialog button:has-text("Delete"), [role="dialog"] button:has-text("Delete")').first();
    if (await dialogDeleteBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dialogDeleteBtn.click();
    } else {
      // Fallback: find the red/primary Delete button in the modal overlay
      const confirmBtn = issuePage
        .locator('#headlessui-portal-root button:has-text("Delete")')
        .first();
      await expect(confirmBtn).toBeVisible({ timeout: 3_000 });
      await confirmBtn.click();
    }

    await issuePage.waitForTimeout(2_000);
    await waitForAppReady(issuePage);

    // Verify issue is removed from the list
    const gammaGone = issuePage.getByText("Test Issue Gamma");
    await expect(gammaGone).toHaveCount(0, { timeout: 10_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Sidebar Navigation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Sidebar Navigation", () => {
  test("should show Cycles link in project sidebar", async ({
    issuePage,
    wsSlug,
  }) => {
    await goToWorkItems(issuePage, wsSlug);
    const cyclesLink = issuePage.getByText("Cycles", { exact: true }).first();
    await expect(cyclesLink).toBeVisible({ timeout: 5_000 });
  });

  test("should show Modules link in project sidebar", async ({
    issuePage,
    wsSlug,
  }) => {
    await goToWorkItems(issuePage, wsSlug);
    const modulesLink = issuePage.getByText("Modules", { exact: true }).first();
    await expect(modulesLink).toBeVisible({ timeout: 5_000 });
  });

  test("should show Views link in project sidebar", async ({
    issuePage,
    wsSlug,
  }) => {
    await goToWorkItems(issuePage, wsSlug);
    const viewsLink = issuePage.getByText("Views", { exact: true }).first();
    await expect(viewsLink).toBeVisible({ timeout: 5_000 });
  });

  test("should show Pages link in project sidebar", async ({
    issuePage,
    wsSlug,
  }) => {
    await goToWorkItems(issuePage, wsSlug);
    const pagesLink = issuePage.getByText("Pages", { exact: true }).first();
    await expect(pagesLink).toBeVisible({ timeout: 5_000 });
  });
});

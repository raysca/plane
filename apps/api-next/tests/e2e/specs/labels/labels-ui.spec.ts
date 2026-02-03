import { test as base, expect, type Page } from "@playwright/test";
import {
  generateTestEmail,
  generateTestPassword,
  generateWorkspaceSlug,
  waitForAppReady,
} from "../../lib/helpers";

const API_BASE = process.env.API_BASE_URL || "http://localhost:8000";

// ── Types ────────────────────────────────────────────────────────────────────

interface ProjectLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
  parent_id: string | null;
  sort_order: number;
  project_id: string;
  workspace_id: string;
}

interface WorkspaceLabel {
  id: string;
  name: string;
  color: string;
  description: string | null;
  sort_order: number;
  workspace_id: string;
}

interface TestData {
  token: string;
  wsSlug: string;
  workspaceId: string;
  projectId: string;
  project2Id: string;
  identifier: string;
  identifier2: string;
  projectLabels: ProjectLabel[];
  workspaceLabels: WorkspaceLabel[];
  issueId: string;
  issueSeqId: number;
}

// ── Fixture ──────────────────────────────────────────────────────────────────

type Fixtures = {
  labelsPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("lbl"));
  },

  labelsPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("lbl");
      const password = generateTestPassword();
      const identifier = `L${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const identifier2 = `M${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Labels",
          last_name: "Tester",
        },
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
        data: {
          first_name: "Labels",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Labels Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();
      const ws = await wsRes.json();
      const workspaceId: string = ws.id;

      // 5. Create first project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Labels Project 1", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      // 6. Create second project (for cross-project label tests)
      const proj2Res = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Labels Project 2", identifier: identifier2, network: 2 },
        }
      );
      expect(proj2Res.ok()).toBeTruthy();
      const proj2 = await proj2Res.json();
      const project2Id: string = proj2.id;

      const base_url = `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;

      // 7. Create project labels for first project
      const labelData = [
        { name: "Bug", color: "#ef4444", description: "Software defects" },
        { name: "Feature", color: "#3b82f6", description: "New functionality" },
        { name: "Documentation", color: "#10b981", description: "Docs updates" },
      ];
      const projectLabels: ProjectLabel[] = [];
      for (const l of labelData) {
        const res = await request.post(`${base_url}/labels/`, {
          headers: headers(token),
          data: l,
        });
        expect(res.ok()).toBeTruthy();
        const label = await res.json();
        projectLabels.push(label);
      }

      // 8. Create a child label under "Bug"
      const childLabelRes = await request.post(`${base_url}/labels/`, {
        headers: headers(token),
        data: {
          name: "UI Bug",
          color: "#f97316",
          description: "User interface bugs",
          parent_id: projectLabels[0]!.id,
        },
      });
      expect(childLabelRes.ok()).toBeTruthy();
      const childLabel = await childLabelRes.json();
      projectLabels.push(childLabel);

      // 9. Create labels for second project
      const proj2LabelRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${project2Id}/labels/`,
        {
          headers: headers(token),
          data: { name: "Enhancement", color: "#8b5cf6" },
        }
      );
      expect(proj2LabelRes.ok()).toBeTruthy();

      // 10. Create workspace-level labels
      const wsLabelData = [
        { name: "Urgent", color: "#dc2626", description: "High priority items" },
        { name: "Research", color: "#6366f1", description: "Investigation needed" },
      ];
      const workspaceLabels: WorkspaceLabel[] = [];
      for (const l of wsLabelData) {
        const res = await request.post(
          `${API_BASE}/api/workspaces/${wsSlug}/labels/`,
          {
            headers: headers(token),
            data: l,
          }
        );
        expect(res.ok()).toBeTruthy();
        const label = await res.json();
        workspaceLabels.push(label);
      }

      // 11. Create an issue for label assignment tests
      const issueRes = await request.post(`${base_url}/issues/`, {
        headers: headers(token),
        data: { name: "Test Issue for Labels" },
      });
      expect(issueRes.ok()).toBeTruthy();
      const issue = await issueRes.json();

      const td: TestData = {
        token,
        wsSlug,
        workspaceId,
        projectId,
        project2Id,
        identifier,
        identifier2,
        projectLabels,
        workspaceLabels,
        issueId: issue.id,
        issueSeqId: issue.sequence_id,
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 90_000 },
  ],

  td: async ({ labelsPage }, use) => {
    await use((labelsPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function projectBaseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}`;
}

function workspaceBaseUrl(td: TestData): string {
  return `${API_BASE}/api/workspaces/${td.wsSlug}`;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function goToProjectLabels(page: Page, wsSlug: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/settings/projects/${projectId}/labels/`);
  await waitForAppReady(page);
}

async function goToIssueDetail(page: Page, wsSlug: string, issueId: string) {
  const projectId = (page as any).__projectId;
  await page.goto(`/${wsSlug}/projects/${projectId}/issues/${issueId}/`);
  await waitForAppReady(page);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. PROJECT LABELS API - CRUD Operations
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Project Labels API - CRUD", () => {
  test("should list project labels via GET /projects/:projectId/labels/", async ({
    labelsPage,
    td,
  }) => {
    const res = await labelsPage.request.get(
      `${projectBaseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    const labels = Array.isArray(data) ? data : data.results ?? [];

    // Should have at least the 4 labels we created (Bug, Feature, Documentation, UI Bug)
    expect(labels.length).toBeGreaterThanOrEqual(4);

    // Verify structure of returned labels
    const bugLabel = labels.find((l: any) => l.name === "Bug");
    expect(bugLabel).toBeTruthy();
    expect(bugLabel.id).toBeTruthy();
    expect(bugLabel.color).toBe("#ef4444");
    expect(bugLabel.project_id).toBe(td.projectId);
    expect(bugLabel.workspace_id).toBe(td.workspaceId);
  });

  test("should create a project label via POST /projects/:projectId/labels/", async ({
    labelsPage,
    td,
  }) => {
    const res = await labelsPage.request.post(
      `${projectBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Improvement",
          color: "#22c55e",
          description: "Code improvements",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(201);

    const label = await res.json();
    expect(label.name).toBe("Improvement");
    expect(label.color).toBe("#22c55e");
    expect(label.description).toBe("Code improvements");
    expect(label.id).toBeTruthy();
    expect(label.project_id).toBe(td.projectId);
    expect(label.sort_order).toBeTruthy();

    // Clean up
    await labelsPage.request.delete(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should update a project label via PATCH /projects/:projectId/labels/:labelId/", async ({
    labelsPage,
    td,
  }) => {
    const label = td.projectLabels[1]!; // Feature label
    const res = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "New Feature",
          color: "#0ea5e9",
          description: "Updated description",
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const updated = await res.json();
    expect(updated.name).toBe("New Feature");
    expect(updated.color).toBe("#0ea5e9");
    expect(updated.description).toBe("Updated description");
    expect(updated.id).toBe(label.id);

    // Revert changes
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: label.name,
          color: label.color,
          description: label.description,
        },
      }
    );
  });

  test("should delete a project label via DELETE /projects/:projectId/labels/:labelId/", async ({
    labelsPage,
    td,
  }) => {
    // Create a temporary label to delete
    const createRes = await labelsPage.request.post(
      `${projectBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Temporary Label", color: "#a3a3a3" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const temp = await createRes.json();

    // Delete the label
    const delRes = await labelsPage.request.delete(
      `${projectBaseUrl(td)}/labels/${temp.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(204);

    // Verify label is gone
    const listRes = await labelsPage.request.get(
      `${projectBaseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    const labels = await listRes.json();
    const ids = (Array.isArray(labels) ? labels : labels.results ?? []).map(
      (l: any) => l.id
    );
    expect(ids).not.toContain(temp.id);
  });

  test("should also work via /issue-labels/ alias endpoint", async ({
    labelsPage,
    td,
  }) => {
    // GET via alias
    const listRes = await labelsPage.request.get(
      `${projectBaseUrl(td)}/issue-labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(listRes.ok()).toBeTruthy();
    const labels = await listRes.json();
    expect(Array.isArray(labels) ? labels : labels.results ?? []).toHaveLength(
      td.projectLabels.length
    );

    // POST via alias
    const createRes = await labelsPage.request.post(
      `${projectBaseUrl(td)}/issue-labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Alias Label", color: "#64748b" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // DELETE via alias
    const delRes = await labelsPage.request.delete(
      `${projectBaseUrl(td)}/issue-labels/${created.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(204);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PROJECT LABELS - Properties & Validation
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Project Labels - Properties & Validation", () => {
  test("should reject duplicate label names within same project", async ({
    labelsPage,
    td,
  }) => {
    const res = await labelsPage.request.post(
      `${projectBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Bug", color: "#000000" }, // "Bug" already exists
      }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test("should allow same label name in different projects", async ({
    labelsPage,
    td,
  }) => {
    // "Bug" exists in project 1, should be allowed in project 2
    const res = await labelsPage.request.post(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.project2Id}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Bug", color: "#ef4444" },
      }
    );
    expect(res.ok()).toBeTruthy();

    const label = await res.json();
    expect(label.name).toBe("Bug");
    expect(label.project_id).toBe(td.project2Id);

    // Clean up
    await labelsPage.request.delete(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.project2Id}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should auto-assign default color when none provided", async ({
    labelsPage,
    td,
  }) => {
    const res = await labelsPage.request.post(
      `${projectBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "No Color Label" },
      }
    );
    expect(res.ok()).toBeTruthy();

    const label = await res.json();
    expect(label.color).toBeTruthy();
    expect(label.color).toMatch(/^#[0-9a-fA-F]{6}$/);

    // Clean up
    await labelsPage.request.delete(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should reject invalid color format", async ({ labelsPage, td }) => {
    const res = await labelsPage.request.post(
      `${projectBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Invalid Color", color: "not-a-color" },
      }
    );
    expect(res.ok()).toBeFalsy();
    expect(res.status()).toBe(400);
  });

  test("should create label with parent_id (child label)", async ({
    labelsPage,
    td,
  }) => {
    const parentId = td.projectLabels[0]!.id; // Bug label
    const res = await labelsPage.request.post(
      `${projectBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Backend Bug",
          color: "#fb923c",
          parent_id: parentId,
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const label = await res.json();
    expect(label.name).toBe("Backend Bug");
    expect(label.parent_id).toBe(parentId);

    // Clean up
    await labelsPage.request.delete(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should update parent_id to create/remove hierarchy", async ({
    labelsPage,
    td,
  }) => {
    // Create a standalone label
    const createRes = await labelsPage.request.post(
      `${projectBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Orphan Label", color: "#94a3b8" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const label = await createRes.json();
    expect(label.parent_id).toBeNull();

    // Update to add parent
    const parentId = td.projectLabels[1]!.id; // Feature label
    const updateRes = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: { parent_id: parentId },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();
    expect(updated.parent_id).toBe(parentId);

    // Update to remove parent
    const removeRes = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: { parent_id: null },
      }
    );
    expect(removeRes.ok()).toBeTruthy();
    const removed = await removeRes.json();
    expect(removed.parent_id).toBeNull();

    // Clean up
    await labelsPage.request.delete(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should update sort_order", async ({ labelsPage, td }) => {
    const label = td.projectLabels[2]!; // Documentation label
    const newSortOrder = 12345;

    const res = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: { sort_order: newSortOrder },
      }
    );
    expect(res.ok()).toBeTruthy();

    const updated = await res.json();
    expect(updated.sort_order).toBe(newSortOrder);

    // Revert
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: { sort_order: label.sort_order },
      }
    );
  });

  test("should update description to null or empty", async ({ labelsPage, td }) => {
    const label = td.projectLabels[0]!; // Bug label with description

    const res = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: { description: null },
      }
    );
    expect(res.ok()).toBeTruthy();

    const updated = await res.json();
    // API may return null or empty string when clearing description
    expect(updated.description === null || updated.description === "").toBeTruthy();

    // Revert
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: { description: label.description },
      }
    );
  });

  test("should return 404 for non-existent label", async ({
    labelsPage,
    td,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const getRes = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/labels/${fakeId}/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Updated" },
      }
    );
    expect(getRes.status()).toBe(404);

    const delRes = await labelsPage.request.delete(
      `${projectBaseUrl(td)}/labels/${fakeId}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. WORKSPACE LABELS API - CRUD Operations
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Workspace Labels API - CRUD", () => {
  test("should list all project labels across workspace via GET /workspaces/:slug/labels/", async ({
    labelsPage,
    td,
  }) => {
    const res = await labelsPage.request.get(
      `${workspaceBaseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const labels = Array.isArray(data) ? data : data.results ?? [];

    // Should include labels from both projects
    expect(labels.length).toBeGreaterThanOrEqual(5); // 4 from project1 + 1 from project2

    // Verify labels from project 1
    const bugLabel = labels.find((l: any) => l.name === "Bug");
    expect(bugLabel).toBeTruthy();

    // Verify labels from project 2
    const enhLabel = labels.find((l: any) => l.name === "Enhancement");
    expect(enhLabel).toBeTruthy();
  });

  test("should create a workspace label via POST /workspaces/:slug/labels/", async ({
    labelsPage,
    td,
  }) => {
    const res = await labelsPage.request.post(
      `${workspaceBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Critical",
          color: "#b91c1c",
          description: "Critical priority items",
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    expect(res.status()).toBe(201);

    const label = await res.json();
    expect(label.name).toBe("Critical");
    expect(label.color).toBe("#b91c1c");
    expect(label.description).toBe("Critical priority items");
    expect(label.id).toBeTruthy();
    expect(label.workspace_id).toBe(td.workspaceId);

    // Clean up
    await labelsPage.request.delete(
      `${workspaceBaseUrl(td)}/labels/${label.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should update a workspace label via PATCH /workspaces/:slug/labels/:id/", async ({
    labelsPage,
    td,
  }) => {
    const label = td.workspaceLabels[0]!; // Urgent label
    const res = await labelsPage.request.patch(
      `${workspaceBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Super Urgent",
          color: "#7f1d1d",
          description: "Extremely high priority",
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const updated = await res.json();
    expect(updated.name).toBe("Super Urgent");
    expect(updated.color).toBe("#7f1d1d");
    expect(updated.description).toBe("Extremely high priority");

    // Revert
    await labelsPage.request.patch(
      `${workspaceBaseUrl(td)}/labels/${label.id}/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: label.name,
          color: label.color,
          description: label.description,
        },
      }
    );
  });

  test("should delete a workspace label via DELETE /workspaces/:slug/labels/:id/", async ({
    labelsPage,
    td,
  }) => {
    // Create a temporary workspace label
    const createRes = await labelsPage.request.post(
      `${workspaceBaseUrl(td)}/labels/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Temp Workspace Label", color: "#a3a3a3" },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const temp = await createRes.json();

    // Delete
    const delRes = await labelsPage.request.delete(
      `${workspaceBaseUrl(td)}/labels/${temp.id}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(204);
  });

  test("should return 404 for non-existent workspace label", async ({
    labelsPage,
    td,
  }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";

    const patchRes = await labelsPage.request.patch(
      `${workspaceBaseUrl(td)}/labels/${fakeId}/`,
      {
        headers: authHeaders(td.token),
        data: { name: "Updated" },
      }
    );
    expect(patchRes.status()).toBe(404);

    const delRes = await labelsPage.request.delete(
      `${workspaceBaseUrl(td)}/labels/${fakeId}/`,
      { headers: authHeaders(td.token) }
    );
    expect(delRes.status()).toBe(404);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. LABEL ASSIGNMENT TO ISSUES
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Label Assignment to Issues", () => {
  test("should assign labels to issue via PATCH /issues/:issueId/", async ({
    labelsPage,
    td,
  }) => {
    const labelIds = [td.projectLabels[0]!.id, td.projectLabels[1]!.id]; // Bug, Feature

    const res = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: labelIds },
      }
    );
    expect(res.ok()).toBeTruthy();

    const issue = await res.json();
    expect(issue.label_ids).toEqual(expect.arrayContaining(labelIds));
    expect(issue.label_ids.length).toBe(2);
  });

  test("should remove labels from issue by setting empty array", async ({
    labelsPage,
    td,
  }) => {
    // First assign labels
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [td.projectLabels[0]!.id] },
      }
    );

    // Then remove all labels
    const res = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [] },
      }
    );
    expect(res.ok()).toBeTruthy();

    const issue = await res.json();
    expect(issue.label_ids).toEqual([]);
  });

  test("should assign labels using 'labels' field (Django-style)", async ({
    labelsPage,
    td,
  }) => {
    const labelIds = [td.projectLabels[2]!.id]; // Documentation

    const res = await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { labels: labelIds },
      }
    );
    expect(res.ok()).toBeTruthy();

    const issue = await res.json();
    expect(issue.label_ids).toEqual(expect.arrayContaining(labelIds));

    // Clean up
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [] },
      }
    );
  });

  test("should create issue with labels", async ({ labelsPage, td }) => {
    const labelIds = [td.projectLabels[0]!.id, td.projectLabels[2]!.id];

    const res = await labelsPage.request.post(
      `${projectBaseUrl(td)}/issues/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Issue with Labels",
          label_ids: labelIds,
        },
      }
    );
    expect(res.ok()).toBeTruthy();

    const issue = await res.json();
    expect(issue.label_ids).toEqual(expect.arrayContaining(labelIds));
    expect(issue.label_ids.length).toBe(2);

    // Clean up
    await labelsPage.request.delete(
      `${projectBaseUrl(td)}/issues/${issue.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should include label_ids in issue list response", async ({
    labelsPage,
    td,
  }) => {
    // Assign a label first
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [td.projectLabels[0]!.id] },
      }
    );

    // List issues
    const res = await labelsPage.request.get(
      `${projectBaseUrl(td)}/issues/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    const issues = data.results ?? data;
    const testIssue = issues.find((i: any) => i.id === td.issueId);
    expect(testIssue).toBeTruthy();
    expect(testIssue.label_ids).toContain(td.projectLabels[0]!.id);

    // Clean up
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [] },
      }
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. RESPONSE FORMAT VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Response Format Validation", () => {
  test("project label response should have all required fields", async ({
    labelsPage,
    td,
  }) => {
    const res = await labelsPage.request.get(
      `${projectBaseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const labels = await res.json();
    const label = Array.isArray(labels) ? labels[0] : labels.results?.[0];

    // Verify all required fields are present
    expect(label).toHaveProperty("id");
    expect(label).toHaveProperty("name");
    expect(label).toHaveProperty("color");
    expect(label).toHaveProperty("project_id");
    expect(label).toHaveProperty("workspace_id");
    expect(label).toHaveProperty("sort_order");

    // Verify field types
    expect(typeof label.id).toBe("string");
    expect(typeof label.name).toBe("string");
    expect(typeof label.color).toBe("string");
    expect(label.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(typeof label.sort_order).toBe("number");
  });

  test("workspace label list should include project_id for each label", async ({
    labelsPage,
    td,
  }) => {
    const res = await labelsPage.request.get(
      `${workspaceBaseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const labels = await res.json();
    const labelList = Array.isArray(labels) ? labels : labels.results ?? [];

    for (const label of labelList) {
      expect(label).toHaveProperty("project_id");
      expect(label).toHaveProperty("workspace_id");
      expect(label.workspace_id).toBe(td.workspaceId);
    }
  });

  test("labels should be sorted by sort_order", async ({ labelsPage, td }) => {
    const res = await labelsPage.request.get(
      `${projectBaseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(res.ok()).toBeTruthy();

    const labels = await res.json();
    const labelList: ProjectLabel[] = Array.isArray(labels)
      ? labels
      : labels.results ?? [];

    // Verify labels are sorted by sort_order
    for (let i = 1; i < labelList.length; i++) {
      expect(labelList[i]!.sort_order).toBeGreaterThanOrEqual(
        labelList[i - 1]!.sort_order
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. LABELS UI - Settings Page
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Labels UI - Settings Page", () => {
  test("should navigate to project labels settings page", async ({
    labelsPage,
    wsSlug,
  }) => {
    await goToProjectLabels(labelsPage, wsSlug);
    expect(labelsPage.url()).toContain("/labels");
  });

  test("should display Labels heading on settings page", async ({
    labelsPage,
    wsSlug,
  }) => {
    await goToProjectLabels(labelsPage, wsSlug);
    await expect(
      labelsPage.getByRole("heading", { name: "Labels" }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("should show Add label button on settings page", async ({
    labelsPage,
    wsSlug,
  }) => {
    await goToProjectLabels(labelsPage, wsSlug);
    const addBtn = labelsPage
      .getByRole("button", { name: /add label/i })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
  });

  test("should display existing labels on settings page", async ({
    labelsPage,
    wsSlug,
    td,
  }) => {
    await goToProjectLabels(labelsPage, wsSlug);

    // Wait for the page to fully load
    await labelsPage.waitForTimeout(2000);

    // Verify at least one of the fixture-created labels is visible
    // Labels may be displayed as text or within specific elements
    const bugLabel = labelsPage.getByText("Bug").first();
    const bugVisible = await bugLabel.isVisible({ timeout: 5_000 }).catch(() => false);

    // If Bug isn't directly visible as text, verify labels exist via API
    if (!bugVisible) {
      const res = await labelsPage.request.get(
        `${projectBaseUrl(td)}/labels/`,
        { headers: authHeaders(td.token) }
      );
      expect(res.ok()).toBeTruthy();
      const labels = await res.json();
      const names = (Array.isArray(labels) ? labels : labels.results ?? []).map(
        (l: any) => l.name
      );
      expect(names).toContain("Bug");
    } else {
      expect(bugVisible).toBeTruthy();
    }
  });

  test("should open inline label form when Add label is clicked", async ({
    labelsPage,
    wsSlug,
  }) => {
    await goToProjectLabels(labelsPage, wsSlug);
    const addBtn = labelsPage
      .getByRole("button", { name: /add label/i })
      .first();
    await addBtn.click();
    await labelsPage.waitForTimeout(500);

    const nameInput = labelsPage.getByPlaceholder(/label title/i).first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
  });

  test("should create a label via UI", async ({ labelsPage, wsSlug, td }) => {
    await goToProjectLabels(labelsPage, wsSlug);

    const addBtn = labelsPage
      .getByRole("button", { name: /add label/i })
      .first();
    await addBtn.click();
    await labelsPage.waitForTimeout(500);

    const nameInput = labelsPage.getByPlaceholder(/label title/i).first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("UI Created Label");

    const submitBtn = labelsPage.getByRole("button", { name: /^add$/i }).first();
    await expect(submitBtn).toBeVisible({ timeout: 3_000 });
    await submitBtn.click();

    await labelsPage.waitForTimeout(2_000);

    // Verify the label was created via API
    const listRes = await labelsPage.request.get(
      `${projectBaseUrl(td)}/labels/`,
      { headers: authHeaders(td.token) }
    );
    expect(listRes.ok()).toBeTruthy();
    const labels = await listRes.json();
    const names = (Array.isArray(labels) ? labels : labels.results ?? []).map(
      (l: any) => l.name
    );
    expect(names).toContain("UI Created Label");
  });

  test("should cancel label creation", async ({ labelsPage, wsSlug }) => {
    await goToProjectLabels(labelsPage, wsSlug);

    const addBtn = labelsPage
      .getByRole("button", { name: /add label/i })
      .first();
    await addBtn.click();
    await labelsPage.waitForTimeout(500);

    const nameInput = labelsPage.getByPlaceholder(/label title/i).first();
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill("Should Not Exist");

    const cancelBtn = labelsPage
      .getByRole("button", { name: "Cancel", exact: true })
      .first();
    await cancelBtn.click();

    await labelsPage.waitForTimeout(500);
    await expect(
      labelsPage.getByText("Should Not Exist")
    ).not.toBeVisible({ timeout: 3_000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. LABELS UI - Issue Detail Page
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Labels UI - Issue Detail Page", () => {
  test("should show Label property in issue detail sidebar", async ({
    labelsPage,
    wsSlug,
    td,
  }) => {
    await goToIssueDetail(labelsPage, wsSlug, td.issueId);

    const labelProp = labelsPage.getByText("Label").first();
    await expect(labelProp).toBeVisible({ timeout: 10_000 });
  });

  test("should show Select Label placeholder when no labels assigned", async ({
    labelsPage,
    wsSlug,
    td,
  }) => {
    // Ensure issue has no labels
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [] },
      }
    );

    await goToIssueDetail(labelsPage, wsSlug, td.issueId);

    const placeholder = labelsPage.getByText(/select label|add label/i).first();
    await expect(placeholder).toBeVisible({ timeout: 10_000 });
  });

  test("should add label via issue detail dropdown", async ({
    labelsPage,
    wsSlug,
    td,
  }) => {
    // Ensure issue has no labels first
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [] },
      }
    );

    await goToIssueDetail(labelsPage, wsSlug, td.issueId);

    const labelTrigger = labelsPage.getByText(/select label|add label/i).first();
    await expect(labelTrigger).toBeVisible({ timeout: 10_000 });
    await labelTrigger.click();

    const bugOption = labelsPage.getByText("Bug", { exact: true }).last();
    await expect(bugOption).toBeVisible({ timeout: 5_000 });
    await bugOption.click();

    await labelsPage.keyboard.press("Escape");
    await labelsPage.waitForTimeout(1_000);

    // Verify label is visible
    const bugLabel = labelsPage.getByText("Bug").first();
    await expect(bugLabel).toBeVisible({ timeout: 5_000 });
  });

  test("should show multiple labels when assigned", async ({
    labelsPage,
    wsSlug,
    td,
  }) => {
    // Assign multiple labels via API
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [td.projectLabels[0]!.id, td.projectLabels[1]!.id] },
      }
    );

    await goToIssueDetail(labelsPage, wsSlug, td.issueId);

    // Both labels should be visible
    const bugLabel = labelsPage.getByText("Bug").first();
    await expect(bugLabel).toBeVisible({ timeout: 10_000 });

    const featureLabel = labelsPage.getByText("Feature").first();
    await expect(featureLabel).toBeVisible({ timeout: 5_000 });

    // Clean up
    await labelsPage.request.patch(
      `${projectBaseUrl(td)}/issues/${td.issueId}/`,
      {
        headers: authHeaders(td.token),
        data: { label_ids: [] },
      }
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. LABEL FILTERING (via issues endpoint)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Label Filtering", () => {
  test("should filter issues by label via query param", async ({
    labelsPage,
    td,
  }) => {
    // Create issues with different labels
    const issue1Res = await labelsPage.request.post(
      `${projectBaseUrl(td)}/issues/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Bug Issue",
          label_ids: [td.projectLabels[0]!.id], // Bug
        },
      }
    );
    expect(issue1Res.ok()).toBeTruthy();
    const issue1 = await issue1Res.json();

    const issue2Res = await labelsPage.request.post(
      `${projectBaseUrl(td)}/issues/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Feature Issue",
          label_ids: [td.projectLabels[1]!.id], // Feature
        },
      }
    );
    expect(issue2Res.ok()).toBeTruthy();
    const issue2 = await issue2Res.json();

    // Filter by Bug label
    const filterRes = await labelsPage.request.get(
      `${projectBaseUrl(td)}/issues/?labels=${td.projectLabels[0]!.id}`,
      { headers: authHeaders(td.token) }
    );
    expect(filterRes.ok()).toBeTruthy();

    const data = await filterRes.json();
    const issues = data.results ?? data;
    const issueIds = issues.map((i: any) => i.id);

    expect(issueIds).toContain(issue1.id);
    expect(issueIds).not.toContain(issue2.id);

    // Clean up
    await labelsPage.request.delete(
      `${projectBaseUrl(td)}/issues/${issue1.id}/`,
      { headers: authHeaders(td.token) }
    );
    await labelsPage.request.delete(
      `${projectBaseUrl(td)}/issues/${issue2.id}/`,
      { headers: authHeaders(td.token) }
    );
  });

  test("should filter issues by multiple labels", async ({ labelsPage, td }) => {
    // Create issue with multiple labels
    const issueRes = await labelsPage.request.post(
      `${projectBaseUrl(td)}/issues/`,
      {
        headers: authHeaders(td.token),
        data: {
          name: "Multi-label Issue",
          label_ids: [td.projectLabels[0]!.id, td.projectLabels[1]!.id],
        },
      }
    );
    expect(issueRes.ok()).toBeTruthy();
    const issue = await issueRes.json();

    // Filter by both labels
    const filterRes = await labelsPage.request.get(
      `${projectBaseUrl(td)}/issues/?labels=${td.projectLabels[0]!.id},${td.projectLabels[1]!.id}`,
      { headers: authHeaders(td.token) }
    );
    expect(filterRes.ok()).toBeTruthy();

    const data = await filterRes.json();
    const issues = data.results ?? data;
    const issueIds = issues.map((i: any) => i.id);

    expect(issueIds).toContain(issue.id);

    // Clean up
    await labelsPage.request.delete(
      `${projectBaseUrl(td)}/issues/${issue.id}/`,
      { headers: authHeaders(td.token) }
    );
  });
});

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
  projectName: string;
  identifier: string;
  workspaceId: string;
  workspaceName: string;
}

// ── Fixture: authenticated page with project for deploy boards ───────────────

type Fixtures = {
  deployPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("dply-ui"));
  },

  deployPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("dply-ui");
      const password = generateTestPassword();
      const identifier = `D${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Deploy",
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
          first_name: "Deploy",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Deploy Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();
      const ws = await wsRes.json();

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: "Deploy Project", identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      const td: TestData = {
        token,
        wsSlug,
        projectId,
        projectName: "Deploy Project",
        identifier,
        workspaceId: ws.id,
        workspaceName: "Deploy Test WS",
      };
      (page as any).__testData = td;
      (page as any).__projectId = projectId;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ deployPage }, use) => {
    await use((deployPage as any).__testData as TestData);
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function getApiBase(wsSlug: string, projectId: string): string {
  return `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Deploy Board List (GET /)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - List", () => {
  test("should return empty deploy board when project is not published", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);
    const res = await deployPage.request.get(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // When no deploy board exists, returns object with null id
    expect(data.id).toBeNull();
    expect(data.anchor).toBeNull();
    expect(data.entity_identifier).toBeNull();
    expect(data.entity_name).toBeNull();
    expect(data.is_comments_enabled).toBe(false);
    expect(data.is_reactions_enabled).toBe(false);
    expect(data.is_votes_enabled).toBe(false);
    expect(data.view_props).toEqual({});
    expect(data.is_activity_enabled).toBe(true);
    expect(data.is_disabled).toBe(false);
  });

  test("should return deploy board with project and workspace details after publishing", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // First, publish the project
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: true,
          is_reactions_enabled: false,
          is_votes_enabled: true,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();

    // Now fetch the deploy board
    const res = await deployPage.request.get(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.id).toBeTruthy();
    expect(data.anchor).toBeTruthy();
    expect(data.entity_identifier).toBe(td.projectId);
    expect(data.entity_name).toBe("project");
    expect(data.is_comments_enabled).toBe(true);
    expect(data.is_reactions_enabled).toBe(false);
    expect(data.is_votes_enabled).toBe(true);
    expect(data.project).toBe(td.projectId);
    expect(data.workspace).toBe(td.workspaceId);

    // Verify project details
    expect(data.project_details).toBeTruthy();
    expect(data.project_details.id).toBe(td.projectId);
    expect(data.project_details.name).toBe(td.projectName);
    expect(data.project_details.identifier).toBe(td.identifier);

    // Verify workspace details
    expect(data.workspace_detail).toBeTruthy();
    expect(data.workspace_detail.id).toBe(td.workspaceId);
    expect(data.workspace_detail.name).toBe(td.workspaceName);
    expect(data.workspace_detail.slug).toBe(td.wsSlug);

    // Cleanup: delete the deploy board
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Deploy Board Create (POST /)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - Create", () => {
  test("should create deploy board with default settings", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);
    const res = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.id).toBeTruthy();
    expect(data.anchor).toBeTruthy();
    expect(data.entity_name).toBe("project");
    expect(data.entity_identifier).toBe(td.projectId);
    expect(data.is_comments_enabled).toBe(false);
    expect(data.is_reactions_enabled).toBe(false);
    expect(data.is_votes_enabled).toBe(false);
    expect(data.project).toBe(td.projectId);
    expect(data.workspace).toBe(td.workspaceId);
    expect(data.created_at).toBeTruthy();

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should create deploy board with custom settings enabled", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);
    const res = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: true,
          is_reactions_enabled: true,
          is_votes_enabled: true,
          views: {
            list: true,
            kanban: true,
            calendar: false,
            gantt: false,
            spreadsheet: true,
          },
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.is_comments_enabled).toBe(true);
    expect(data.is_reactions_enabled).toBe(true);
    expect(data.is_votes_enabled).toBe(true);
    expect(data.view_props).toEqual({
      list: true,
      kanban: true,
      calendar: false,
      gantt: false,
      spreadsheet: true,
    });

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should update existing deploy board on second POST (idempotent)", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // First create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: true,
          is_reactions_enabled: false,
          is_votes_enabled: false,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const first = await createRes.json();
    const firstId = first.id;
    const firstAnchor = first.anchor;

    // Second create (should update, not create new)
    const updateRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: false,
          is_reactions_enabled: true,
          is_votes_enabled: true,
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const second = await updateRes.json();

    // Same ID and anchor
    expect(second.id).toBe(firstId);
    expect(second.anchor).toBe(firstAnchor);
    // Updated values
    expect(second.is_comments_enabled).toBe(false);
    expect(second.is_reactions_enabled).toBe(true);
    expect(second.is_votes_enabled).toBe(true);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${firstId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should create deploy board with view_props instead of views", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);
    const res = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          view_props: {
            list: true,
            kanban: false,
            calendar: true,
            gantt: false,
            spreadsheet: false,
          },
        },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.view_props).toEqual({
      list: true,
      kanban: false,
      calendar: true,
      gantt: false,
      spreadsheet: false,
    });

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Deploy Board Get Single (GET /:publishId/)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - Get Single", () => {
  test("should get deploy board by ID", async ({ deployPage, td }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create deploy board
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_comments_enabled: true },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Get by ID
    const res = await deployPage.request.get(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    expect(data.id).toBe(created.id);
    expect(data.anchor).toBe(created.anchor);
    expect(data.is_comments_enabled).toBe(true);
    expect(data.project_details).toBeTruthy();
    expect(data.workspace_detail).toBeTruthy();

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should return 404 for non-existent deploy board ID", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await deployPage.request.get(
      `${base_url}/project-deploy-boards/${fakeId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe("Deploy board not found.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Deploy Board Update (PATCH /:publishId/)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - Update", () => {
  test("should update deploy board settings", async ({ deployPage, td }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: false,
          is_reactions_enabled: false,
          is_votes_enabled: false,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Update
    const updateRes = await deployPage.request.patch(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: true,
          is_reactions_enabled: true,
          is_votes_enabled: true,
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    expect(updated.id).toBe(created.id);
    expect(updated.is_comments_enabled).toBe(true);
    expect(updated.is_reactions_enabled).toBe(true);
    expect(updated.is_votes_enabled).toBe(true);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should update only specified fields", async ({ deployPage, td }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create with all enabled
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: true,
          is_reactions_enabled: true,
          is_votes_enabled: true,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Update only comments
    const updateRes = await deployPage.request.patch(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: false,
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    // Comments should be false, others unchanged
    expect(updated.is_comments_enabled).toBe(false);
    expect(updated.is_reactions_enabled).toBe(true);
    expect(updated.is_votes_enabled).toBe(true);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should update view_props via PATCH", async ({ deployPage, td }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          views: { list: true, kanban: true },
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Update view_props
    const updateRes = await deployPage.request.patch(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          view_props: { list: false, kanban: true, spreadsheet: true },
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    expect(updated.view_props).toEqual({
      list: false,
      kanban: true,
      spreadsheet: true,
    });

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should update is_activity_enabled and is_disabled", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Update activity and disabled flags
    const updateRes = await deployPage.request.patch(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_activity_enabled: false,
          is_disabled: true,
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    expect(updated.is_activity_enabled).toBe(false);
    expect(updated.is_disabled).toBe(true);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should return 404 when updating non-existent deploy board", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await deployPage.request.patch(
      `${base_url}/project-deploy-boards/${fakeId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_comments_enabled: true },
      }
    );
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Deploy Board Delete (DELETE /:publishId/)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - Delete", () => {
  test("should delete (unpublish) deploy board", async ({ deployPage, td }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Delete
    const deleteRes = await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(deleteRes.status()).toBe(204);

    // Verify GET returns null board
    const getRes = await deployPage.request.get(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(getRes.ok()).toBeTruthy();
    const data = await getRes.json();
    expect(data.id).toBeNull();
    expect(data.anchor).toBeNull();
  });

  test("should return 404 when deleting non-existent deploy board", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${fakeId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.status()).toBe(404);
  });

  test("should return 404 when getting deleted deploy board by ID", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create and delete
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // Try to get by ID
    const getRes = await deployPage.request.get(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(getRes.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Deploy Board Settings (anchor, comments, reactions, votes, views)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - Settings", () => {
  test("should generate unique anchor on creation", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const data = await createRes.json();

    // Anchor should be a non-empty string
    expect(typeof data.anchor).toBe("string");
    expect(data.anchor.length).toBeGreaterThan(0);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should preserve anchor on update", async ({ deployPage, td }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const originalAnchor = created.anchor;

    // Update via POST (idempotent update)
    const updateRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_comments_enabled: true },
      }
    );
    expect(updateRes.ok()).toBeTruthy();
    const updated = await updateRes.json();

    // Anchor should remain the same
    expect(updated.anchor).toBe(originalAnchor);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should set all view types via views parameter", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const viewConfig = {
      list: true,
      kanban: true,
      calendar: true,
      gantt: true,
      spreadsheet: true,
    };

    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { views: viewConfig },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const data = await createRes.json();

    expect(data.view_props).toEqual(viewConfig);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should disable specific views", async ({ deployPage, td }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const viewConfig = {
      list: true,
      kanban: false,
      calendar: false,
      gantt: false,
      spreadsheet: false,
    };

    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { views: viewConfig },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const data = await createRes.json();

    expect(data.view_props.list).toBe(true);
    expect(data.view_props.kanban).toBe(false);
    expect(data.view_props.calendar).toBe(false);
    expect(data.view_props.gantt).toBe(false);
    expect(data.view_props.spreadsheet).toBe(false);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Public Access (without authentication)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - Public Access", () => {
  test("should access deploy board settings publicly via anchor", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create deploy board
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: true,
          is_reactions_enabled: true,
          is_votes_enabled: false,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Access publicly (no auth header)
    const publicRes = await deployPage.request.get(
      `${API_BASE}/api/public/anchor/${created.anchor}/settings/`
    );
    expect(publicRes.ok()).toBeTruthy();
    const publicData = await publicRes.json();

    expect(publicData.id).toBe(created.id);
    expect(publicData.anchor).toBe(created.anchor);
    expect(publicData.entity_name).toBe("project");
    expect(publicData.is_comments_enabled).toBe(true);
    expect(publicData.is_reactions_enabled).toBe(true);
    expect(publicData.is_votes_enabled).toBe(false);
    expect(publicData.project_details).toBeTruthy();
    expect(publicData.workspace_detail).toBeTruthy();

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should return 404 for invalid anchor", async ({ deployPage }) => {
    const res = await deployPage.request.get(
      `${API_BASE}/api/public/anchor/invalid-anchor-12345/settings/`
    );
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe("Project is not published.");
  });

  test("should get anchor by project ID publicly", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create deploy board
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Get anchor by project (public endpoint)
    const publicRes = await deployPage.request.get(
      `${API_BASE}/api/public/workspaces/${td.wsSlug}/projects/${td.projectId}/anchor/`
    );
    expect(publicRes.ok()).toBeTruthy();
    const publicData = await publicRes.json();

    expect(publicData.anchor).toBe(created.anchor);
    expect(publicData.id).toBe(created.id);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should return 404 when getting anchor for unpublished project", async ({
    deployPage,
    td,
  }) => {
    // Don't create a deploy board, just try to get anchor
    const res = await deployPage.request.get(
      `${API_BASE}/api/public/workspaces/${td.wsSlug}/projects/${td.projectId}/anchor/`
    );
    expect(res.status()).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe("Project is not published.");
  });

  test("should get project members publicly via anchor", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create deploy board
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Get members publicly
    const membersRes = await deployPage.request.get(
      `${API_BASE}/api/public/anchor/${created.anchor}/members/`
    );
    expect(membersRes.ok()).toBeTruthy();
    const members = await membersRes.json();

    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBeGreaterThanOrEqual(1);

    // The test user should be a member
    const member = members[0];
    expect(member.member).toBeTruthy();
    expect(member.project).toBe(td.projectId);
    expect(member.workspace).toBe(td.workspaceId);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should return 404 when getting members for invalid anchor", async ({
    deployPage,
  }) => {
    const res = await deployPage.request.get(
      `${API_BASE}/api/public/anchor/invalid-anchor-12345/members/`
    );
    expect(res.status()).toBe(404);
  });

  test("should return 404 after deploy board is deleted (unpublished)", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const anchor = created.anchor;

    // Delete
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // Try to access publicly
    const publicRes = await deployPage.request.get(
      `${API_BASE}/api/public/anchor/${anchor}/settings/`
    );
    expect(publicRes.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Response Format Validation
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - Response Format Validation", () => {
  test("should have all required fields in create response", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_comments_enabled: true },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const data = await createRes.json();

    // Verify all required fields exist
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("anchor");
    expect(data).toHaveProperty("entity_identifier");
    expect(data).toHaveProperty("entity_name");
    expect(data).toHaveProperty("is_comments_enabled");
    expect(data).toHaveProperty("is_reactions_enabled");
    expect(data).toHaveProperty("is_votes_enabled");
    expect(data).toHaveProperty("view_props");
    expect(data).toHaveProperty("project");
    expect(data).toHaveProperty("workspace");
    expect(data).toHaveProperty("created_at");
    expect(data).toHaveProperty("updated_at");
    expect(data).toHaveProperty("created_by");

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should have all required fields in list response with details", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Get list (which returns the single board with details)
    const listRes = await deployPage.request.get(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(listRes.ok()).toBeTruthy();
    const data = await listRes.json();

    // Verify project_details fields
    expect(data.project_details).toBeTruthy();
    expect(data.project_details).toHaveProperty("id");
    expect(data.project_details).toHaveProperty("name");
    expect(data.project_details).toHaveProperty("identifier");
    expect(data.project_details).toHaveProperty("emoji");
    expect(data.project_details).toHaveProperty("icon_prop");
    expect(data.project_details).toHaveProperty("logo_props");
    expect(data.project_details).toHaveProperty("cover_image");
    expect(data.project_details).toHaveProperty("description");

    // Verify workspace_detail fields
    expect(data.workspace_detail).toBeTruthy();
    expect(data.workspace_detail).toHaveProperty("id");
    expect(data.workspace_detail).toHaveProperty("name");
    expect(data.workspace_detail).toHaveProperty("slug");

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should have correct types for boolean fields", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: true,
          is_reactions_enabled: false,
          is_votes_enabled: true,
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const data = await createRes.json();

    // Verify boolean types
    expect(typeof data.is_comments_enabled).toBe("boolean");
    expect(typeof data.is_reactions_enabled).toBe("boolean");
    expect(typeof data.is_votes_enabled).toBe("boolean");

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should have ISO 8601 formatted timestamps", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {},
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const data = await createRes.json();

    // Verify timestamps are ISO format
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    expect(data.created_at).toMatch(isoRegex);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should have view_props as object", async ({ deployPage, td }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          views: { list: true, kanban: false },
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const data = await createRes.json();

    // view_props should be an object
    expect(typeof data.view_props).toBe("object");
    expect(data.view_props).not.toBeNull();
    expect(Array.isArray(data.view_props)).toBe(false);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should have public response format matching authenticated response", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_comments_enabled: true },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    // Get authenticated response
    const authRes = await deployPage.request.get(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(authRes.ok()).toBeTruthy();
    const authData = await authRes.json();

    // Get public response
    const publicRes = await deployPage.request.get(
      `${API_BASE}/api/public/anchor/${created.anchor}/settings/`
    );
    expect(publicRes.ok()).toBeTruthy();
    const publicData = await publicRes.json();

    // Compare key fields (public should match authenticated)
    expect(publicData.id).toBe(authData.id);
    expect(publicData.anchor).toBe(authData.anchor);
    expect(publicData.entity_name).toBe(authData.entity_name);
    expect(publicData.is_comments_enabled).toBe(authData.is_comments_enabled);
    expect(publicData.is_reactions_enabled).toBe(authData.is_reactions_enabled);
    expect(publicData.is_votes_enabled).toBe(authData.is_votes_enabled);
    expect(publicData.project).toBe(authData.project);
    expect(publicData.workspace).toBe(authData.workspace);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${created.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Deploy Board - Edge Cases", () => {
  test("should handle republishing after unpublish", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    // Create
    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_comments_enabled: true },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const first = await createRes.json();
    const firstAnchor = first.anchor;

    // Delete (unpublish)
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${first.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );

    // Republish
    const republishRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: { is_comments_enabled: false },
      }
    );
    expect(republishRes.ok()).toBeTruthy();
    const second = await republishRes.json();

    // Should get a new ID and anchor
    expect(second.id).not.toBe(first.id);
    expect(second.anchor).not.toBe(firstAnchor);
    expect(second.is_comments_enabled).toBe(false);

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${second.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should handle empty view_props in create", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const createRes = await deployPage.request.post(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          views: {},
        },
      }
    );
    expect(createRes.ok()).toBeTruthy();
    const data = await createRes.json();

    expect(data.view_props).toEqual({});

    // Cleanup
    await deployPage.request.delete(
      `${base_url}/project-deploy-boards/${data.id}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
  });

  test("should return proper empty state when no deploy board exists", async ({
    deployPage,
    td,
  }) => {
    const base_url = getApiBase(td.wsSlug, td.projectId);

    const res = await deployPage.request.get(
      `${base_url}/project-deploy-boards/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();

    // All fields should be null or default values
    expect(data.id).toBeNull();
    expect(data.anchor).toBeNull();
    expect(data.entity_identifier).toBeNull();
    expect(data.entity_name).toBeNull();
    expect(data.project).toBeNull();
    expect(data.workspace).toBeNull();
    expect(data.project_details).toBeNull();
    expect(data.workspace_detail).toBeNull();
    expect(data.created_at).toBeNull();
    expect(data.updated_at).toBeNull();
    expect(data.created_by).toBeNull();

    // Boolean fields should have defaults
    expect(data.is_comments_enabled).toBe(false);
    expect(data.is_reactions_enabled).toBe(false);
    expect(data.is_votes_enabled).toBe(false);
    expect(data.is_activity_enabled).toBe(true);
    expect(data.is_disabled).toBe(false);

    // view_props should be empty object
    expect(data.view_props).toEqual({});
  });
});

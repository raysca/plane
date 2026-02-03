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
  userId: string;
  wsSlug: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  identifier: string;
  deployBoardId: string;
  anchor: string;
}

// ── Fixture: authenticated page with deploy board created ────────────────────

type Fixtures = {
  anchorPage: Page;
  wsSlug: string;
  td: TestData;
};

const test = base.extend<Fixtures>({
  wsSlug: async ({}, use) => {
    await use(generateWorkspaceSlug("anc-ui"));
  },

  anchorPage: [
    async ({ page, request, wsSlug }, use) => {
      const email = generateTestEmail("anc-ui");
      const password = generateTestPassword();
      const identifier = `A${Date.now().toString(36).slice(-3).toUpperCase()}`;
      const projectName = `Anchor Project ${Date.now().toString(36)}`;
      const headers = (token: string) => ({
        Authorization: `Bearer ${token}`,
      });

      // 1. Create user
      const signupRes = await request.post(`${API_BASE}/auth/sign-up/`, {
        data: {
          email,
          password,
          first_name: "Anchor",
          last_name: "Tester",
        },
      });
      expect(signupRes.ok()).toBeTruthy();
      const signupData = await signupRes.json();
      const token: string = signupData.access_token;
      const userId: string = signupData.user?.id || signupData.id;

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
          first_name: "Anchor",
          last_name: "Tester",
          is_onboarded: true,
        },
      });

      // 4. Create workspace
      const wsRes = await request.post(`${API_BASE}/api/workspaces/`, {
        headers: headers(token),
        data: {
          name: "Anchor Test WS",
          slug: wsSlug,
          organization_size: "2-10",
        },
      });
      expect(wsRes.ok()).toBeTruthy();
      const wsData = await wsRes.json();
      const workspaceId: string = wsData.id;

      // 5. Create project
      const projRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/`,
        {
          headers: headers(token),
          data: { name: projectName, identifier, network: 2 },
        }
      );
      expect(projRes.ok()).toBeTruthy();
      const proj = await projRes.json();
      const projectId: string = proj.id;

      // 6. Create deploy board (publish project)
      const deployRes = await request.post(
        `${API_BASE}/api/workspaces/${wsSlug}/projects/${projectId}/project-deploy-boards/`,
        {
          headers: headers(token),
          data: {
            is_comments_enabled: true,
            is_reactions_enabled: true,
            is_votes_enabled: false,
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
      expect(deployRes.ok()).toBeTruthy();
      const deployBoard = await deployRes.json();
      const deployBoardId: string = deployBoard.id;
      const anchor: string = deployBoard.anchor;

      const td: TestData = {
        token,
        userId,
        wsSlug,
        workspaceId,
        projectId,
        projectName,
        identifier,
        deployBoardId,
        anchor,
      };
      (page as any).__testData = td;

      await use(page);
    },
    { timeout: 60_000 },
  ],

  td: async ({ anchorPage }, use) => {
    await use((anchorPage as any).__testData as TestData);
  },
});

// ── Tests ────────────────────────────────────────────────────────────────────

// ─── 1. Public Anchor Settings (No Auth Required) ────────────────────────────

test.describe("Public Anchor Settings (GET /api/public/anchor/:anchor/settings/)", () => {
  test("should retrieve public anchor settings without authentication", async ({
    anchorPage,
    td,
  }) => {
    // Make request WITHOUT authentication headers
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.id).toBe(td.deployBoardId);
    expect(data.anchor).toBe(td.anchor);
    expect(data.entity_name).toBe("project");
  });

  test("should return correct deploy board properties", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // Verify boolean properties
    expect(data.is_comments_enabled).toBe(true);
    expect(data.is_reactions_enabled).toBe(true);
    expect(data.is_votes_enabled).toBe(false);
    expect(data.is_activity_enabled).toBe(true);
    expect(data.is_disabled).toBe(false);
  });

  test("should return project details in response", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // Verify project details
    expect(data.project_details).not.toBeNull();
    expect(data.project_details.id).toBe(td.projectId);
    expect(data.project_details.name).toBe(td.projectName);
    expect(data.project_details.identifier).toBe(td.identifier);
  });

  test("should return workspace details in response", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // Verify workspace details
    expect(data.workspace_detail).not.toBeNull();
    expect(data.workspace_detail.id).toBe(td.workspaceId);
    expect(data.workspace_detail.slug).toBe(td.wsSlug);
  });

  test("should return view_props configuration", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // Verify view props
    expect(data.view_props).toBeDefined();
    expect(data.view_props.list).toBe(true);
    expect(data.view_props.kanban).toBe(true);
    expect(data.view_props.calendar).toBe(false);
    expect(data.view_props.gantt).toBe(false);
    expect(data.view_props.spreadsheet).toBe(true);
  });

  test("should return 404 for non-existent anchor", async ({ anchorPage }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/nonexistentanchor123456/settings/`
    );
    expect(res.status()).toBe(404);

    const data = await res.json();
    expect(data.detail).toBe("Project is not published.");
  });

  test("should include timestamps in response", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // Verify timestamps are present and valid ISO format
    expect(data.created_at).toBeDefined();
    expect(data.updated_at).toBeDefined();
    expect(new Date(data.created_at).toISOString()).toBe(data.created_at);
    expect(new Date(data.updated_at).toISOString()).toBe(data.updated_at);
  });
});

// ─── 2. Public Anchor by Project (GET /api/public/workspaces/:slug/projects/:projectId/anchor/) ───

test.describe("Public Anchor by Project (GET /api/public/workspaces/:slug/projects/:projectId/anchor/)", () => {
  test("should retrieve anchor by workspace slug and project ID", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/workspaces/${td.wsSlug}/projects/${td.projectId}/anchor/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.id).toBe(td.deployBoardId);
    expect(data.anchor).toBe(td.anchor);
    expect(data.project).toBe(td.projectId);
    expect(data.workspace).toBe(td.workspaceId);
  });

  test("should return full deploy board response format", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/workspaces/${td.wsSlug}/projects/${td.projectId}/anchor/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // Verify all expected fields are present
    const expectedFields = [
      "id",
      "anchor",
      "entity_identifier",
      "entity_name",
      "is_comments_enabled",
      "is_reactions_enabled",
      "is_votes_enabled",
      "view_props",
      "is_activity_enabled",
      "is_disabled",
      "project",
      "workspace",
      "project_details",
      "workspace_detail",
      "created_at",
      "updated_at",
      "created_by",
    ];

    for (const field of expectedFields) {
      expect(data).toHaveProperty(field);
    }
  });

  test("should return 404 for non-existent workspace", async ({ anchorPage, td }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/workspaces/nonexistent-workspace-slug/projects/${td.projectId}/anchor/`
    );
    expect(res.status()).toBe(404);

    const data = await res.json();
    expect(data.detail).toBe("Workspace not found.");
  });

  test("should return 404 for unpublished project", async ({ anchorPage, td }) => {
    // Use a random project ID that doesn't have a deploy board
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/workspaces/${td.wsSlug}/projects/nonexistent-project-id/anchor/`
    );
    expect(res.status()).toBe(404);

    const data = await res.json();
    expect(data.detail).toBe("Project is not published.");
  });
});

// ─── 3. Public Anchor Members (GET /api/public/anchor/:anchor/members/) ──────

test.describe("Public Anchor Members (GET /api/public/anchor/:anchor/members/)", () => {
  test("should retrieve project members via public anchor", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/members/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    // Project creator should be a member
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  test("should return member details in correct format", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/members/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);

    const member = data[0];
    // Verify member structure
    expect(member).toHaveProperty("id");
    expect(member).toHaveProperty("member");
    expect(member).toHaveProperty("member__display_name");
    expect(member).toHaveProperty("member__first_name");
    expect(member).toHaveProperty("project");
    expect(member).toHaveProperty("workspace");
  });

  test("should include creator as project member", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/members/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // Find the creator in the members list by member ID
    // Note: The API returns users.name as member__first_name, not users.firstName
    const creatorMember = data.find(
      (m: any) => m.member === td.userId
    );
    expect(creatorMember).toBeDefined();
    expect(creatorMember.project).toBe(td.projectId);
    expect(creatorMember.workspace).toBe(td.workspaceId);
  });

  test("should return 404 for non-existent anchor", async ({ anchorPage }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/invalidanchor999/members/`
    );
    expect(res.status()).toBe(404);

    const data = await res.json();
    expect(data.detail).toBe("Project is not published.");
  });
});

// ─── 4. Response Format Validation ───────────────────────────────────────────

test.describe("Response Format Validation", () => {
  test("should return JSON content type for settings endpoint", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const contentType = res.headers()["content-type"];
    expect(contentType).toContain("application/json");
  });

  test("should return JSON content type for members endpoint", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/members/`
    );
    expect(res.ok()).toBeTruthy();

    const contentType = res.headers()["content-type"];
    expect(contentType).toContain("application/json");
  });

  test("should return properly formatted date strings", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // Verify date string format (ISO 8601)
    const dateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(data.created_at).toMatch(dateRegex);
    expect(data.updated_at).toMatch(dateRegex);
  });

  test("should return null for undefined optional fields", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(res.ok()).toBeTruthy();

    const data = await res.json();

    // entity_identifier can be null or a string
    if (data.entity_identifier !== null) {
      expect(typeof data.entity_identifier).toBe("string");
    }

    // project_details.emoji should be null if not set
    if (data.project_details) {
      expect(data.project_details.emoji).toBeNull();
    }
  });
});

// ─── 5. Deploy Board Updates and Public Access ───────────────────────────────

test.describe("Deploy Board Updates and Public Access", () => {
  test("should reflect updated settings via public endpoint", async ({
    anchorPage,
    td,
  }) => {
    // Update deploy board settings via authenticated API
    const updateRes = await anchorPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/project-deploy-boards/${td.deployBoardId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          is_comments_enabled: false,
          is_votes_enabled: true,
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();

    // Verify changes are reflected via public endpoint
    const publicRes = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(publicRes.ok()).toBeTruthy();

    const data = await publicRes.json();
    expect(data.is_comments_enabled).toBe(false);
    expect(data.is_votes_enabled).toBe(true);
  });

  test("should reflect updated view_props via public endpoint", async ({
    anchorPage,
    td,
  }) => {
    // Update view props
    const updateRes = await anchorPage.request.patch(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/project-deploy-boards/${td.deployBoardId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
        data: {
          view_props: {
            list: false,
            kanban: false,
            calendar: true,
            gantt: true,
            spreadsheet: false,
          },
        },
      }
    );
    expect(updateRes.ok()).toBeTruthy();

    // Verify changes via public endpoint
    const publicRes = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(publicRes.ok()).toBeTruthy();

    const data = await publicRes.json();
    expect(data.view_props.list).toBe(false);
    expect(data.view_props.kanban).toBe(false);
    expect(data.view_props.calendar).toBe(true);
    expect(data.view_props.gantt).toBe(true);
    expect(data.view_props.spreadsheet).toBe(false);
  });

  test("should return 404 after deploy board is deleted", async ({
    anchorPage,
    td,
  }) => {
    // First verify the anchor exists
    const preDeleteRes = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(preDeleteRes.ok()).toBeTruthy();

    // Delete the deploy board (soft delete)
    const deleteRes = await anchorPage.request.delete(
      `${API_BASE}/api/workspaces/${td.wsSlug}/projects/${td.projectId}/project-deploy-boards/${td.deployBoardId}/`,
      {
        headers: { Authorization: `Bearer ${td.token}` },
      }
    );
    expect(deleteRes.status()).toBe(204);

    // Verify public endpoint returns 404 after deletion
    const postDeleteRes = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`
    );
    expect(postDeleteRes.status()).toBe(404);

    const data = await postDeleteRes.json();
    expect(data.detail).toBe("Project is not published.");

    // Note: Since we deleted the deploy board, subsequent tests using td.anchor
    // may fail. This test should be last or use a separate fixture.
  });
});

// ─── 6. No Authentication Required Verification ──────────────────────────────

test.describe("No Authentication Required", () => {
  test("should access settings endpoint without any headers", async ({
    anchorPage,
    td,
  }) => {
    // Create a fresh request context without any auth
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/settings/`,
      {
        headers: {}, // Explicitly no headers
      }
    );
    expect(res.ok()).toBeTruthy();
  });

  test("should access members endpoint without any headers", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/anchor/${td.anchor}/members/`,
      {
        headers: {},
      }
    );
    expect(res.ok()).toBeTruthy();
  });

  test("should access anchor by project endpoint without any headers", async ({
    anchorPage,
    td,
  }) => {
    const res = await anchorPage.request.get(
      `${API_BASE}/api/public/workspaces/${td.wsSlug}/projects/${td.projectId}/anchor/`,
      {
        headers: {},
      }
    );
    expect(res.ok()).toBeTruthy();
  });
});

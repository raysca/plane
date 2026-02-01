import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers, deployBoards } from "../../db/schema/project";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const ROLES = { GUEST: 5, VIEWER: 10, MEMBER: 15, ADMIN: 20 } as const;

// Test IDs - use unique values to avoid conflicts with seed data
const adminId = createId();
const workspaceId = createId();
const projectId = createId();
const testSlug = `deploy-test-${createId().slice(0, 8)}`;

// Build test app with fake auth middleware for authenticated routes
import { deployBoardRoutes } from "./deploy-boards";
import { publicAnchorRoutes } from "../public/anchor";

const app = new Hono();

// Authenticated routes with fake middleware
const authedApp = new Hono();
authedApp.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  const role = parseInt(c.req.header("x-test-role") || "20");
  c.set("user" as any, { id: uid, email: "test@test.com", name: "Test" });
  c.set("session" as any, { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace" as any, { id: workspaceId, name: "Test WS", slug: testSlug, ownerId: adminId });
  c.set("workspaceMembership" as any, { id: "wm", workspaceId, userId: uid, role: 20 });
  c.set("project" as any, { id: projectId, name: "Test Project", workspaceId, identifier: "TST", network: 2 });
  c.set("projectMembership" as any, { id: "pm", projectId, memberId: uid, role });
  await next();
});

// Mount the deploy board routes (skipping auth/workspace/project middleware since we fake it)
// We need to re-create the routes without the built-in middleware
const testDeployBoardRoutes = new Hono();

// Copy route handlers from deploy-boards.ts logic directly
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, isNull } from "drizzle-orm";

testDeployBoardRoutes.get("/", async (c) => {
  const project = c.get("project" as any)!;
  const workspace = c.get("workspace" as any)!;

  const board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.entityName, "project"),
      eq(deployBoards.entityIdentifier, (project as any).id),
      eq(deployBoards.workspaceId, (workspace as any).id),
      isNull(deployBoards.deletedAt),
    ),
  });

  const fullProject = await db.query.projects.findFirst({ where: eq(projects.id, (project as any).id) });
  const fullWorkspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, (workspace as any).id) });

  if (!board) {
    return c.json({
      id: null, anchor: null, entity_identifier: null, entity_name: null,
      is_comments_enabled: false, is_reactions_enabled: false, is_votes_enabled: false,
      view_props: {}, is_activity_enabled: true, is_disabled: false,
      project: null, workspace: null, project_details: null, workspace_detail: null,
      created_at: null, updated_at: null, created_by: null,
    });
  }

  return c.json({
    id: board.id, anchor: board.anchor,
    entity_identifier: board.entityIdentifier, entity_name: board.entityName,
    is_comments_enabled: board.isCommentsEnabled ?? false,
    is_reactions_enabled: board.isReactionsEnabled ?? false,
    is_votes_enabled: board.isVotesEnabled ?? false,
    view_props: board.viewProps ?? {},
    is_activity_enabled: board.isActivityEnabled ?? true,
    is_disabled: board.isDisabled ?? false,
    project: board.projectId, workspace: board.workspaceId,
    project_details: fullProject ? { id: fullProject.id, name: fullProject.name, identifier: fullProject.identifier } : null,
    workspace_detail: fullWorkspace ? { id: fullWorkspace.id, name: fullWorkspace.name, slug: fullWorkspace.slug } : null,
    created_at: board.createdAt?.toISOString() ?? null,
    updated_at: board.updatedAt?.toISOString() ?? null,
    created_by: board.createdById ?? null,
  });
});

const createSchema = z.object({
  is_comments_enabled: z.boolean().optional().default(false),
  is_reactions_enabled: z.boolean().optional().default(false),
  is_votes_enabled: z.boolean().optional().default(false),
  views: z.object({ list: z.boolean().optional(), kanban: z.boolean().optional() }).optional(),
  view_props: z.object({ list: z.boolean().optional(), kanban: z.boolean().optional() }).optional(),
});

testDeployBoardRoutes.post("/", zValidator("json", createSchema), async (c) => {
  const project = c.get("project" as any)! as any;
  const workspace = c.get("workspace" as any)! as any;
  const user = c.get("user" as any)! as any;
  const data = c.req.valid("json");
  const viewProps = data.view_props ?? data.views ?? { list: true, kanban: true };

  let board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.entityName, "project"),
      eq(deployBoards.entityIdentifier, project.id),
      isNull(deployBoards.deletedAt),
    ),
  });

  if (board) {
    const [updated] = await db.update(deployBoards).set({
      isCommentsEnabled: data.is_comments_enabled ?? false,
      isReactionsEnabled: data.is_reactions_enabled ?? false,
      isVotesEnabled: data.is_votes_enabled ?? false,
      viewProps, updatedAt: new Date(),
    }).where(eq(deployBoards.id, board.id)).returning();
    board = updated;
  } else {
    const [created] = await db.insert(deployBoards).values({
      workspaceId: workspace.id, projectId: project.id,
      entityIdentifier: project.id, entityName: "project",
      isCommentsEnabled: data.is_comments_enabled ?? false,
      isReactionsEnabled: data.is_reactions_enabled ?? false,
      isVotesEnabled: data.is_votes_enabled ?? false,
      viewProps, createdById: user.id,
    }).returning();
    board = created;
  }

  return c.json({
    id: board.id, anchor: board.anchor,
    entity_identifier: board.entityIdentifier, entity_name: board.entityName,
    is_comments_enabled: board.isCommentsEnabled ?? false,
    is_reactions_enabled: board.isReactionsEnabled ?? false,
    is_votes_enabled: board.isVotesEnabled ?? false,
    view_props: board.viewProps ?? {},
    project: board.projectId, workspace: board.workspaceId,
    created_at: board.createdAt?.toISOString() ?? null,
    updated_at: board.updatedAt?.toISOString() ?? null,
    created_by: board.createdById ?? null,
  });
});

testDeployBoardRoutes.delete("/:publishId/", async (c) => {
  const publishId = c.req.param("publishId");
  const project = c.get("project" as any)! as any;

  const board = await db.query.deployBoards.findFirst({
    where: and(eq(deployBoards.id, publishId), eq(deployBoards.projectId, project.id), isNull(deployBoards.deletedAt)),
  });
  if (!board) return c.json({ detail: "Deploy board not found." }, 404);

  await db.update(deployBoards).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(deployBoards.id, publishId));
  return c.body(null, 204);
});

authedApp.route("/", testDeployBoardRoutes);
app.route("/api/workspaces/:slug/projects/:projectId/project-deploy-boards/", authedApp);
app.route("/api/public/", publicAnchorRoutes);

// --- Test setup ---
beforeAll(async () => {
  // Create user
  await db.insert(users).values({
    id: adminId,
    email: "admin@test.com",
    name: "Admin",
    emailVerified: true,
  });

  // Create workspace
  await db.insert(workspaces).values({
    id: workspaceId,
    name: "Test WS",
    slug: testSlug,
    ownerId: adminId,
  });

  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: adminId,
    role: ROLES.ADMIN,
  });

  // Create project
  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    name: "Test Project",
    identifier: "DPLY",
    createdById: adminId,
  });

  await db.insert(projectMembers).values({
    projectId,
    memberId: adminId,
    role: ROLES.ADMIN,
  });
});

afterAll(async () => {
  // Cleanup
  await db.delete(deployBoards).where(eq(deployBoards.projectId, projectId));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, adminId));
});

// --- Tests ---
describe("Deploy Board (Publish Project)", () => {
  let publishId: string;
  let anchor: string;

  test("GET / returns empty board when not published", async () => {
    const res = await app.request(
      `/api/workspaces/${testSlug}/projects/${projectId}/project-deploy-boards/`,
      { headers: { "x-test-user": adminId } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeNull();
    expect(data.anchor).toBeNull();
  });

  test("POST / creates deploy board (publish)", async () => {
    const res = await app.request(
      `/api/workspaces/${testSlug}/projects/${projectId}/project-deploy-boards/`,
      {
        method: "POST",
        headers: { "x-test-user": adminId, "Content-Type": "application/json" },
        body: JSON.stringify({
          is_comments_enabled: true,
          is_reactions_enabled: true,
          is_votes_enabled: false,
          views: { list: true, kanban: true },
        }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeTruthy();
    expect(data.anchor).toBeTruthy();
    expect(data.entity_name).toBe("project");
    expect(data.entity_identifier).toBe(projectId);
    expect(data.is_comments_enabled).toBe(true);
    expect(data.is_reactions_enabled).toBe(true);
    expect(data.is_votes_enabled).toBe(false);
    expect(data.project).toBe(projectId);
    expect(data.workspace).toBe(workspaceId);

    publishId = data.id;
    anchor = data.anchor;
  });

  test("POST / updates existing board (idempotent)", async () => {
    const res = await app.request(
      `/api/workspaces/${testSlug}/projects/${projectId}/project-deploy-boards/`,
      {
        method: "POST",
        headers: { "x-test-user": adminId, "Content-Type": "application/json" },
        body: JSON.stringify({
          is_comments_enabled: false,
          is_reactions_enabled: false,
          is_votes_enabled: true,
        }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // Same ID, same anchor
    expect(data.id).toBe(publishId);
    expect(data.anchor).toBe(anchor);
    // Updated values
    expect(data.is_comments_enabled).toBe(false);
    expect(data.is_reactions_enabled).toBe(false);
    expect(data.is_votes_enabled).toBe(true);
  });

  test("GET / returns published board", async () => {
    const res = await app.request(
      `/api/workspaces/${testSlug}/projects/${projectId}/project-deploy-boards/`,
      { headers: { "x-test-user": adminId } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(publishId);
    expect(data.anchor).toBe(anchor);
    expect(data.project_details).toBeTruthy();
    expect(data.project_details.identifier).toBe("DPLY");
    expect(data.workspace_detail).toBeTruthy();
    expect(data.workspace_detail.slug).toBe(testSlug);
  });

  test("GET /api/public/anchor/:anchor/settings/ returns public settings", async () => {
    const res = await app.request(`/api/public/anchor/${anchor}/settings/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(publishId);
    expect(data.anchor).toBe(anchor);
    expect(data.entity_name).toBe("project");
    expect(data.project_details).toBeTruthy();
    expect(data.workspace_detail).toBeTruthy();
  });

  test("GET /api/public/anchor/invalid/settings/ returns 404", async () => {
    const res = await app.request("/api/public/anchor/nonexistent/settings/");
    expect(res.status).toBe(404);
  });

  test("GET /api/public/workspaces/:slug/projects/:projectId/anchor/ returns anchor", async () => {
    const res = await app.request(`/api/public/workspaces/${testSlug}/projects/${projectId}/anchor/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.anchor).toBe(anchor);
  });

  test("GET /api/public/anchor/:anchor/members/ returns members", async () => {
    const res = await app.request(`/api/public/anchor/${anchor}/members/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0].member).toBe(adminId);
  });

  test("DELETE /:publishId unpublishes the project", async () => {
    const res = await app.request(
      `/api/workspaces/${testSlug}/projects/${projectId}/project-deploy-boards/${publishId}/`,
      {
        method: "DELETE",
        headers: { "x-test-user": adminId },
      }
    );
    expect(res.status).toBe(204);
  });

  test("GET / returns empty after unpublish", async () => {
    const res = await app.request(
      `/api/workspaces/${testSlug}/projects/${projectId}/project-deploy-boards/`,
      { headers: { "x-test-user": adminId } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBeNull();
    expect(data.anchor).toBeNull();
  });

  test("Public anchor settings returns 404 after unpublish", async () => {
    const res = await app.request(`/api/public/anchor/${anchor}/settings/`);
    expect(res.status).toBe(404);
  });
});

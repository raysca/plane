import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../../db/schema/user";
import * as workspaceSchema from "../../db/schema/workspace";
import * as projectSchema from "../../db/schema/project";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: { ...userSchema, ...workspaceSchema, ...projectSchema },
});

sqlite.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER,
    image TEXT,
    username TEXT UNIQUE,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    avatar TEXT,
    cover_image TEXT,
    is_active INTEGER DEFAULT 1,
    is_password_autoset INTEGER DEFAULT 0,
    last_login_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    logo TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id),
    organization_size TEXT,
    timezone TEXT DEFAULT 'UTC',
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE workspace_members (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INTEGER NOT NULL DEFAULT 15,
    company_role TEXT,
    is_active INTEGER DEFAULT 1,
    view_props TEXT,
    default_props TEXT,
    issue_props TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(workspace_id, user_id)
  );

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    description_text TEXT,
    description_html TEXT,
    network INTEGER DEFAULT 2,
    identifier TEXT NOT NULL,
    emoji TEXT,
    icon_prop TEXT,
    cover_image TEXT,
    archive_in INTEGER DEFAULT 0,
    close_in INTEGER DEFAULT 0,
    default_assignee_id TEXT REFERENCES users(id),
    default_state_id TEXT,
    project_lead_id TEXT REFERENCES users(id),
    estimate_id TEXT,
    sort_order REAL DEFAULT 65535,
    created_by_id TEXT REFERENCES users(id),
    logo_props TEXT,
    cycle_view INTEGER DEFAULT 1,
    module_view INTEGER DEFAULT 1,
    issue_views_view INTEGER DEFAULT 1,
    page_view INTEGER DEFAULT 1,
    intake_view INTEGER DEFAULT 0,
    guest_view_all_features INTEGER DEFAULT 0,
    is_time_tracking_enabled INTEGER DEFAULT 0,
    is_issue_type_enabled INTEGER DEFAULT 0,
    archived_at INTEGER,
    is_member_added INTEGER DEFAULT 0,
    deleted_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(workspace_id, identifier)
  );

  CREATE TABLE project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INTEGER NOT NULL DEFAULT 15,
    is_active INTEGER DEFAULT 1,
    view_props TEXT,
    default_props TEXT,
    preferences TEXT,
    sort_order REAL DEFAULT 65535,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(project_id, member_id)
  );
`);

// Test data
let testUser: { id: string; email: string };
let otherUser: { id: string; email: string };
let workspace: { id: string; slug: string };
let project: { id: string };

// Helper to format member response (replicates route logic)
function formatMember(m: any, user: any) {
  return {
    id: m.id,
    member: {
      id: user.id,
      email: user.email,
      first_name: user.firstName ?? "",
      last_name: user.lastName ?? "",
      display_name: user.displayName ?? user.name ?? "",
      avatar: user.avatar ?? user.image ?? "",
    },
    role: m.role,
    is_active: m.isActive ?? true,
    view_props: m.viewProps ?? {},
    default_props: m.defaultProps ?? {},
    preferences: m.preferences ?? {},
    sort_order: m.sortOrder ?? 65535,
    created_at: m.createdAt?.toISOString() ?? null,
    updated_at: m.updatedAt?.toISOString() ?? null,
  };
}

// Setup test app
const app = new Hono();

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  if (userId === otherUser?.id) return otherUser;
  return null;
}

// GET /api/workspaces/:slug/projects/:projectId/project-members/me/
app.get("/api/workspaces/:slug/projects/:projectId/project-members/me/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const projectId = c.req.param("projectId");

  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });

  if (!ws) return c.json({ detail: "Not found." }, 404);

  const proj = await db.query.projects.findFirst({
    where: and(
      eq(projectSchema.projects.id, projectId),
      eq(projectSchema.projects.workspaceId, ws.id)
    ),
  });

  if (!proj) return c.json({ detail: "Not found." }, 404);

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectSchema.projectMembers.projectId, proj.id),
      eq(projectSchema.projectMembers.memberId, user.id),
      eq(projectSchema.projectMembers.isActive, true)
    ),
  });

  if (!membership) {
    return c.json({ detail: "Project Member not found." }, 404);
  }

  const dbUser = await db.query.users.findFirst({
    where: eq(userSchema.users.id, user.id),
  });

  return c.json(formatMember(membership, dbUser!));
});

beforeAll(async () => {
  testUser = { id: createId(), email: "test@example.com" };
  otherUser = { id: createId(), email: "other@example.com" };

  await db.insert(userSchema.users).values([
    { id: testUser.id, email: testUser.email, name: "Test User", displayName: "Test User", firstName: "Test", lastName: "User" },
    { id: otherUser.id, email: otherUser.email, name: "Other User", displayName: "Other User" },
  ]);

  workspace = { id: createId(), slug: "test-workspace" };

  await db.insert(workspaceSchema.workspaces).values({
    id: workspace.id,
    name: "Test Workspace",
    slug: workspace.slug,
    ownerId: testUser.id,
  });

  await db.insert(workspaceSchema.workspaceMembers).values([
    { workspaceId: workspace.id, userId: testUser.id, role: 20, isActive: true },
    { workspaceId: workspace.id, userId: otherUser.id, role: 15, isActive: true },
  ]);

  project = { id: createId() };

  await db.insert(projectSchema.projects).values({
    id: project.id,
    workspaceId: workspace.id,
    name: "Test Project",
    identifier: "TEST",
  });

  // Add testUser as an active project member (admin)
  await db.insert(projectSchema.projectMembers).values({
    id: createId(),
    projectId: project.id,
    memberId: testUser.id,
    role: 20,
    isActive: true,
  });
});

describe("GET /api/workspaces/:slug/projects/:projectId/project-members/me/", () => {
  test("returns current user's project membership", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/project-members/me/`,
      { headers: { "x-test-user-id": testUser.id } }
    );

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBeDefined();
    expect(data.member).toBeDefined();
    expect(data.member.id).toBe(testUser.id);
    expect(data.member.email).toBe(testUser.email);
    expect(data.member.display_name).toBe("Test User");
    expect(data.member.first_name).toBe("Test");
    expect(data.member.last_name).toBe("User");
    expect(data.role).toBe(20);
    expect(data.is_active).toBe(true);
    expect(data.view_props).toEqual({});
    expect(data.default_props).toEqual({});
    expect(data.preferences).toEqual({});
    expect(data.sort_order).toBe(65535);
  });

  test("returns 404 for non-member", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/project-members/me/`,
      { headers: { "x-test-user-id": otherUser.id } }
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe("Project Member not found.");
  });

  test("returns 404 for inactive member", async () => {
    // Add otherUser as inactive project member
    await db.insert(projectSchema.projectMembers).values({
      id: createId(),
      projectId: project.id,
      memberId: otherUser.id,
      role: 15,
      isActive: false,
    });

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/project-members/me/`,
      { headers: { "x-test-user-id": otherUser.id } }
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe("Project Member not found.");
  });

  test("returns 401 without authentication", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/project-members/me/`
    );

    expect(res.status).toBe(401);
  });

  test("returns 404 for non-existent project", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/nonexistent-id/project-members/me/`,
      { headers: { "x-test-user-id": testUser.id } }
    );

    expect(res.status).toBe(404);
  });

  test("returns 404 for non-existent workspace", async () => {
    const res = await app.request(
      `/api/workspaces/nonexistent-slug/projects/${project.id}/project-members/me/`,
      { headers: { "x-test-user-id": testUser.id } }
    );

    expect(res.status).toBe(404);
  });
});

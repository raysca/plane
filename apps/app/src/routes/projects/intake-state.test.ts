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

  CREATE TABLE states (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    "group" TEXT NOT NULL,
    description TEXT,
    sequence REAL DEFAULT 65535,
    is_default INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );
`);

function formatState(s: typeof projectSchema.states.$inferSelect) {
  return {
    id: s.id,
    project_id: s.projectId,
    workspace_id: s.workspaceId,
    name: s.name,
    color: s.color,
    group: s.group,
    description: s.description ?? "",
    sequence: s.sequence ?? 65535,
    is_default: s.isDefault ?? false,
    created_at: s.createdAt?.toISOString() ?? null,
    updated_at: s.updatedAt?.toISOString() ?? null,
  };
}

// Test data
let testUser: { id: string; email: string };
let workspace: { id: string; slug: string };
let project: { id: string };
let projectWithoutTriage: { id: string };
let triageState: { id: string };

// Setup test app
const app = new Hono();

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  return null;
}

// GET /api/workspaces/:slug/projects/:projectId/intake-state/
app.get("/api/workspaces/:slug/projects/:projectId/intake-state/", async (c) => {
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

  const state = await db.query.states.findFirst({
    where: and(
      eq(projectSchema.states.projectId, proj.id),
      eq(projectSchema.states.group, "triage")
    ),
  });

  if (!state) {
    return c.json({ error: "Triage state not found" }, 404);
  }

  return c.json(formatState(state));
});

beforeAll(async () => {
  testUser = { id: createId(), email: "test@example.com" };

  await db.insert(userSchema.users).values({
    id: testUser.id,
    email: testUser.email,
    name: "Test User",
    displayName: "Test User",
  });

  workspace = { id: createId(), slug: "test-workspace" };

  await db.insert(workspaceSchema.workspaces).values({
    id: workspace.id,
    name: "Test Workspace",
    slug: workspace.slug,
    ownerId: testUser.id,
  });

  await db.insert(workspaceSchema.workspaceMembers).values({
    workspaceId: workspace.id,
    userId: testUser.id,
    role: 20,
    isActive: true,
  });

  // Project with triage state
  project = { id: createId() };

  await db.insert(projectSchema.projects).values({
    id: project.id,
    workspaceId: workspace.id,
    name: "Test Project",
    identifier: "TEST",
  });

  await db.insert(projectSchema.projectMembers).values({
    id: createId(),
    projectId: project.id,
    memberId: testUser.id,
    role: 20,
    isActive: true,
  });

  triageState = { id: createId() };

  await db.insert(projectSchema.states).values({
    id: triageState.id,
    projectId: project.id,
    workspaceId: workspace.id,
    name: "Triage",
    color: "#ff7700",
    group: "triage",
    sequence: 0,
    isDefault: false,
  });

  // Also add a non-triage state to ensure filtering works
  await db.insert(projectSchema.states).values({
    id: createId(),
    projectId: project.id,
    workspaceId: workspace.id,
    name: "Backlog",
    color: "#a3a3a3",
    group: "backlog",
    sequence: 1,
    isDefault: true,
  });

  // Project without triage state
  projectWithoutTriage = { id: createId() };

  await db.insert(projectSchema.projects).values({
    id: projectWithoutTriage.id,
    workspaceId: workspace.id,
    name: "No Triage Project",
    identifier: "NOTR",
  });

  await db.insert(projectSchema.projectMembers).values({
    id: createId(),
    projectId: projectWithoutTriage.id,
    memberId: testUser.id,
    role: 20,
    isActive: true,
  });

  await db.insert(projectSchema.states).values({
    id: createId(),
    projectId: projectWithoutTriage.id,
    workspaceId: workspace.id,
    name: "Backlog",
    color: "#a3a3a3",
    group: "backlog",
    sequence: 1,
    isDefault: true,
  });
});

describe("GET /api/workspaces/:slug/projects/:projectId/intake-state/", () => {
  test("returns the triage state for a project", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/intake-state/`,
      { headers: { "x-test-user-id": testUser.id } }
    );

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe(triageState.id);
    expect(data.name).toBe("Triage");
    expect(data.color).toBe("#ff7700");
    expect(data.group).toBe("triage");
    expect(data.project_id).toBe(project.id);
    expect(data.workspace_id).toBe(workspace.id);
    expect(data.is_default).toBe(false);
    expect(data.sequence).toBe(0);
    expect(data.description).toBe("");
  });

  test("returns 404 when no triage state exists", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${projectWithoutTriage.id}/intake-state/`,
      { headers: { "x-test-user-id": testUser.id } }
    );

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Triage state not found");
  });

  test("returns 401 without authentication", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/intake-state/`
    );

    expect(res.status).toBe(401);
  });

  test("returns 404 for non-existent project", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/nonexistent-id/intake-state/`,
      { headers: { "x-test-user-id": testUser.id } }
    );

    expect(res.status).toBe(404);
  });

  test("returns 404 for non-existent workspace", async () => {
    const res = await app.request(
      `/api/workspaces/nonexistent-slug/projects/${project.id}/intake-state/`,
      { headers: { "x-test-user-id": testUser.id } }
    );

    expect(res.status).toBe(404);
  });
});

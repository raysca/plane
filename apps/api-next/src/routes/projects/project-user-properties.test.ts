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
  schema: {
    ...userSchema,
    ...workspaceSchema,
    ...projectSchema,
  },
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

  CREATE TABLE project_user_properties (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filters TEXT DEFAULT '{}',
    display_filters TEXT DEFAULT '{}',
    display_properties TEXT DEFAULT '{}',
    rich_filters TEXT DEFAULT '{}',
    preferences TEXT DEFAULT '{}',
    sort_order REAL DEFAULT 65535,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(project_id, user_id)
  );
`);

let testUser: { id: string; email: string };
let otherUser: { id: string; email: string };
let workspace: { id: string; slug: string };
let project: { id: string };

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  if (userId === otherUser?.id) return otherUser;
  return null;
}

function formatProps(p: any) {
  return {
    id: p.id,
    project: p.projectId,
    workspace: p.workspaceId,
    user: p.userId,
    filters: p.filters ?? {},
    display_filters: p.displayFilters ?? {},
    display_properties: p.displayProperties ?? {},
    rich_filters: p.richFilters ?? {},
    preferences: p.preferences ?? { pages: { block_display: true }, navigation: { default_tab: "work_items", hide_in_more_menu: [] } },
    sort_order: p.sortOrder ?? 65535,
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
  };
}

const app = new Hono();

// GET
app.get("/api/workspaces/:slug/projects/:projectId/user-properties/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");

  let props = await db.query.projectUserProperties.findFirst({
    where: and(
      eq(projectSchema.projectUserProperties.projectId, projectId),
      eq(projectSchema.projectUserProperties.userId, user.id)
    ),
  });

  if (!props) {
    const [created] = await db.insert(projectSchema.projectUserProperties).values({
      projectId,
      workspaceId: workspace.id,
      userId: user.id,
    }).returning();
    props = created;
  }

  return c.json(formatProps(props!));
});

// PATCH
app.patch("/api/workspaces/:slug/projects/:projectId/user-properties/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");

  let props = await db.query.projectUserProperties.findFirst({
    where: and(
      eq(projectSchema.projectUserProperties.projectId, projectId),
      eq(projectSchema.projectUserProperties.userId, user.id)
    ),
  });

  if (!props) {
    const [created] = await db.insert(projectSchema.projectUserProperties).values({
      projectId,
      workspaceId: workspace.id,
      userId: user.id,
    }).returning();
    props = created;
  }

  const body = await c.req.json();
  const updateData: Record<string, any> = { updatedAt: new Date() };

  if (body.filters !== undefined) updateData.filters = body.filters;
  if (body.display_filters !== undefined) updateData.displayFilters = body.display_filters;
  if (body.display_properties !== undefined) updateData.displayProperties = body.display_properties;
  if (body.rich_filters !== undefined) updateData.richFilters = body.rich_filters;
  if (body.preferences !== undefined) updateData.preferences = body.preferences;
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

  await db.update(projectSchema.projectUserProperties)
    .set(updateData)
    .where(eq(projectSchema.projectUserProperties.id, props!.id));

  const updated = await db.query.projectUserProperties.findFirst({
    where: eq(projectSchema.projectUserProperties.id, props!.id),
  });

  return c.json(formatProps(updated!));
});

beforeAll(async () => {
  testUser = { id: createId(), email: "test@example.com" };
  otherUser = { id: createId(), email: "other@example.com" };

  await db.insert(userSchema.users).values([
    { id: testUser.id, email: testUser.email, name: "Test User" },
    { id: otherUser.id, email: otherUser.email, name: "Other User" },
  ]);

  workspace = { id: createId(), slug: "test-workspace" };

  await db.insert(workspaceSchema.workspaces).values({
    id: workspace.id,
    name: "Test Workspace",
    slug: workspace.slug,
    ownerId: testUser.id,
  });

  project = { id: createId() };

  await db.insert(projectSchema.projects).values({
    id: project.id,
    workspaceId: workspace.id,
    name: "Test Project",
    identifier: "TEST",
  });
});

describe("Project User Properties - GET", () => {
  test("auto-creates default properties on first access", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      { headers: { "x-test-user-id": testUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.project).toBe(project.id);
    expect(data.workspace).toBe(workspace.id);
    expect(data.user).toBe(testUser.id);
    expect(data.id).toBeDefined();

    // Check defaults match Django's get_default_* functions
    expect(data.filters).toEqual({
      priority: null, state: null, state_group: null, assignees: null,
      created_by: null, labels: null, start_date: null, target_date: null, subscriber: null,
    });
    expect(data.display_filters).toEqual({
      group_by: null, order_by: "-created_at", type: null,
      sub_issue: true, show_empty_groups: true, layout: "list", calendar_date_range: "",
    });
    expect(data.display_properties).toEqual({
      assignee: true, attachment_count: true, created_on: true, due_date: true,
      estimate: true, key: true, labels: true, link: true, priority: true,
      start_date: true, state: true, sub_issue_count: true, updated_on: true,
    });
    expect(data.rich_filters).toEqual({});
    expect(data.sort_order).toBe(65535);
    expect(data.preferences).toEqual({
      pages: { block_display: true },
      navigation: { default_tab: "work_items", hide_in_more_menu: [] },
    });
  });

  test("returns same properties on subsequent access", async () => {
    const res1 = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      { headers: { "x-test-user-id": testUser.id } }
    );
    const data1 = await res1.json();

    const res2 = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      { headers: { "x-test-user-id": testUser.id } }
    );
    const data2 = await res2.json();

    expect(data1.id).toBe(data2.id);
  });

  test("different users get separate properties", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      { headers: { "x-test-user-id": otherUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toBe(otherUser.id);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`
    );
    expect(res.status).toBe(401);
  });
});

describe("Project User Properties - PATCH", () => {
  test("updates display_filters", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({
          display_filters: { group_by: "priority", order_by: "-updated_at", layout: "kanban" },
        }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.display_filters).toEqual({ group_by: "priority", order_by: "-updated_at", layout: "kanban" });
  });

  test("updates display_properties", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({
          display_properties: { assignee: true, priority: true, state: false },
        }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.display_properties).toEqual({ assignee: true, priority: true, state: false });
  });

  test("updates filters and rich_filters", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({
          filters: { priority: ["high", "urgent"] },
          rich_filters: { AND: [{ property: "priority", operator: "in", values: ["high"] }] },
        }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.filters).toEqual({ priority: ["high", "urgent"] });
    expect(data.rich_filters).toEqual({ AND: [{ property: "priority", operator: "in", values: ["high"] }] });
  });

  test("updates preferences", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({
          preferences: { pages: { block_display: false }, navigation: { default_tab: "pages", hide_in_more_menu: ["modules"] } },
        }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.preferences.pages.block_display).toBe(false);
    expect(data.preferences.navigation.default_tab).toBe("pages");
  });

  test("persists changes across GET requests", async () => {
    // First update
    await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({
          display_filters: { layout: "spreadsheet" },
        }),
      }
    );

    // Then GET
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      { headers: { "x-test-user-id": testUser.id } }
    );
    const data = await res.json();
    expect(data.display_filters).toEqual({ layout: "spreadsheet" });
  });

  test("partial update does not reset other fields", async () => {
    // Set filters
    await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": otherUser.id },
        body: JSON.stringify({
          filters: { state: ["open"] },
          display_filters: { layout: "list" },
        }),
      }
    );

    // Update only filters
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/user-properties/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": otherUser.id },
        body: JSON.stringify({
          filters: { state: ["closed"] },
        }),
      }
    );
    const data = await res.json();
    expect(data.filters).toEqual({ state: ["closed"] });
    // display_filters should be preserved
    expect(data.display_filters).toEqual({ layout: "list" });
  });

  test("auto-creates properties on PATCH if not exists", async () => {
    // Create a new project with no properties for testUser
    const newProject = { id: createId() };
    await db.insert(projectSchema.projects).values({
      id: newProject.id,
      workspaceId: workspace.id,
      name: "New Project",
      identifier: "NEW",
    });

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${newProject.id}/user-properties/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({
          display_filters: { layout: "kanban" },
        }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project).toBe(newProject.id);
    expect(data.display_filters).toEqual({ layout: "kanban" });
  });
});

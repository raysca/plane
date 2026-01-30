import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, asc, sql, max } from "drizzle-orm";
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

  CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id TEXT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#000000',
    description TEXT,
    sort_order REAL DEFAULT 65535,
    created_by_id TEXT REFERENCES users(id),
    created_at INTEGER,
    updated_at INTEGER
  );
`);

// Test data
let testUser: { id: string; email: string };
let workspace: { id: string; slug: string };
let project: { id: string };

// Setup test app replicating route logic
const app = new Hono();

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  return null;
}

// LIST (shared for /labels/ and /issue-labels/)
async function handleList(c: any) {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");

  const labelList = await db.query.labels.findMany({
    where: eq(projectSchema.labels.projectId, projectId),
    orderBy: [asc(projectSchema.labels.sortOrder)],
  });

  return c.json(labelList.map((l) => ({
    id: l.id,
    project_id: l.projectId,
    workspace_id: l.workspaceId,
    parent_id: l.parentId ?? null,
    name: l.name,
    color: l.color,
    description: l.description ?? "",
    sort_order: l.sortOrder ?? 65535,
    created_by_id: l.createdById ?? null,
    created_at: l.createdAt?.toISOString() ?? null,
    updated_at: l.updatedAt?.toISOString() ?? null,
  })));
}

// CREATE
async function handleCreate(c: any) {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  // Case-insensitive name uniqueness
  const existing = await db.query.labels.findFirst({
    where: and(
      eq(projectSchema.labels.projectId, projectId),
      sql`LOWER(${projectSchema.labels.name}) = LOWER(${body.name})`
    ),
  });
  if (existing) {
    return c.json({ error: "Label with the same name already exists in the project" }, 400);
  }

  // Auto-calculate sort_order
  let sortOrder = body.sort_order;
  if (sortOrder === undefined) {
    const maxResult = await db
      .select({ largest: max(projectSchema.labels.sortOrder) })
      .from(projectSchema.labels)
      .where(eq(projectSchema.labels.projectId, projectId));
    const largest = maxResult[0]?.largest;
    sortOrder = largest != null ? largest + 10000 : 65535;
  }

  const [result] = await db
    .insert(projectSchema.labels)
    .values({
      projectId,
      workspaceId: workspace.id,
      name: body.name,
      color: body.color ?? "#000000",
      description: body.description,
      parentId: body.parent_id,
      sortOrder,
      createdById: user.id,
    })
    .returning();

  return c.json({
    id: result.id,
    project_id: result.projectId,
    workspace_id: result.workspaceId,
    parent_id: result.parentId ?? null,
    name: result.name,
    color: result.color,
    description: result.description ?? "",
    sort_order: result.sortOrder ?? 65535,
    created_by_id: result.createdById ?? null,
    created_at: result.createdAt?.toISOString() ?? null,
    updated_at: result.updatedAt?.toISOString() ?? null,
  }, 201);
}

// UPDATE
async function handleUpdate(c: any) {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const labelId = c.req.param("labelId");

  const label = await db.query.labels.findFirst({
    where: and(
      eq(projectSchema.labels.id, labelId),
      eq(projectSchema.labels.projectId, projectId)
    ),
  });
  if (!label) return c.json({ detail: "Label not found." }, 404);

  const body = await c.req.json();

  // Case-insensitive uniqueness (excluding self)
  if (body.name !== undefined) {
    const existing = await db.query.labels.findFirst({
      where: and(
        eq(projectSchema.labels.projectId, projectId),
        sql`LOWER(${projectSchema.labels.name}) = LOWER(${body.name})`,
        sql`${projectSchema.labels.id} != ${labelId}`
      ),
    });
    if (existing) {
      return c.json({ error: "Label with the same name already exists in the project" }, 400);
    }
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.color !== undefined) updateData.color = body.color;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.parent_id !== undefined) updateData.parentId = body.parent_id;
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

  await db.update(projectSchema.labels).set(updateData).where(eq(projectSchema.labels.id, labelId));

  const updated = await db.query.labels.findFirst({
    where: eq(projectSchema.labels.id, labelId),
  });

  return c.json({
    id: updated!.id,
    project_id: updated!.projectId,
    workspace_id: updated!.workspaceId,
    parent_id: updated!.parentId ?? null,
    name: updated!.name,
    color: updated!.color,
    description: updated!.description ?? "",
    sort_order: updated!.sortOrder ?? 65535,
    created_by_id: updated!.createdById ?? null,
    created_at: updated!.createdAt?.toISOString() ?? null,
    updated_at: updated!.updatedAt?.toISOString() ?? null,
  });
}

// DELETE
async function handleDelete(c: any) {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const labelId = c.req.param("labelId");

  const label = await db.query.labels.findFirst({
    where: and(
      eq(projectSchema.labels.id, labelId),
      eq(projectSchema.labels.projectId, projectId)
    ),
  });
  if (!label) return c.json({ detail: "Label not found." }, 404);

  await db.delete(projectSchema.labels).where(eq(projectSchema.labels.id, labelId));

  return c.body(null, 204);
}

// Register both /labels/ and /issue-labels/ paths
app.get("/api/workspaces/:slug/projects/:projectId/labels/", handleList);
app.post("/api/workspaces/:slug/projects/:projectId/labels/", handleCreate);
app.patch("/api/workspaces/:slug/projects/:projectId/labels/:labelId/", handleUpdate);
app.delete("/api/workspaces/:slug/projects/:projectId/labels/:labelId/", handleDelete);

app.get("/api/workspaces/:slug/projects/:projectId/issue-labels/", handleList);
app.post("/api/workspaces/:slug/projects/:projectId/issue-labels/", handleCreate);
app.patch("/api/workspaces/:slug/projects/:projectId/issue-labels/:labelId/", handleUpdate);
app.delete("/api/workspaces/:slug/projects/:projectId/issue-labels/:labelId/", handleDelete);

beforeAll(async () => {
  testUser = { id: createId(), email: "test@example.com" };

  await db.insert(userSchema.users).values({
    id: testUser.id,
    email: testUser.email,
    name: "Test User",
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
});

describe("Project Labels - LIST", () => {
  test("lists labels for a project ordered by sort_order", async () => {
    // Seed labels with different sort orders
    await db.insert(projectSchema.labels).values([
      { id: "label-b", projectId: project.id, workspaceId: workspace.id, name: "Bug", color: "#FF0000", sortOrder: 20000, createdById: testUser.id },
      { id: "label-a", projectId: project.id, workspaceId: workspace.id, name: "Feature", color: "#00FF00", sortOrder: 10000, createdById: testUser.id },
    ]);

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/`,
      { headers: { "x-test-user-id": testUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(2);
    // Ordered by sort_order ascending
    expect(data[0].name).toBe("Feature");
    expect(data[1].name).toBe("Bug");
  });

  test("issue-labels path also works", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/issue-labels/`,
      { headers: { "x-test-user-id": testUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThanOrEqual(2);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/`
    );
    expect(res.status).toBe(401);
  });
});

describe("Project Labels - CREATE", () => {
  test("creates a label with auto sort_order", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "Enhancement", color: "#0000FF" }),
      }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Enhancement");
    expect(data.color).toBe("#0000FF");
    expect(data.project_id).toBe(project.id);
    expect(data.workspace_id).toBe(workspace.id);
    expect(data.created_by_id).toBe(testUser.id);
    // sort_order should be max existing + 10000 (20000 + 10000 = 30000)
    expect(data.sort_order).toBe(30000);
  });

  test("creates first label with default sort_order 65535", async () => {
    // Create a separate project with no labels
    const emptyProject = { id: createId() };
    await db.insert(projectSchema.projects).values({
      id: emptyProject.id,
      workspaceId: workspace.id,
      name: "Empty Project",
      identifier: "EMPTY",
    });

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${emptyProject.id}/labels/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "First Label" }),
      }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.sort_order).toBe(65535);
    expect(data.color).toBe("#000000"); // default color
  });

  test("rejects duplicate name (case-insensitive)", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "bug", color: "#FF0000" }), // "bug" vs "Bug"
      }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("same name already exists");
  });

  test("creates label with parent", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "Sub Bug", color: "#FF5555", parent_id: "label-b" }),
      }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.parent_id).toBe("label-b");
  });

  test("issue-labels path also creates", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/issue-labels/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "Via Issue Labels Path", color: "#AABBCC" }),
      }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Via Issue Labels Path");
  });
});

describe("Project Labels - UPDATE", () => {
  test("updates label name and color", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/label-a/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "Feature Request", color: "#00AA00" }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Feature Request");
    expect(data.color).toBe("#00AA00");
  });

  test("rejects updating to existing name (case-insensitive)", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/label-a/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "BUG" }), // "BUG" already exists as "Bug"
      }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("same name already exists");
  });

  test("allows updating other fields without name conflict", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/label-b/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ color: "#DD0000" }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.color).toBe("#DD0000");
    expect(data.name).toBe("Bug"); // unchanged
  });

  test("returns 404 for non-existent label", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/nonexistent/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "Nope" }),
      }
    );
    expect(res.status).toBe(404);
  });

  test("issue-labels path also updates", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/issue-labels/label-b/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ description: "Updated via issue-labels" }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.description).toBe("Updated via issue-labels");
  });
});

describe("Project Labels - DELETE", () => {
  test("deletes a label", async () => {
    // Create a disposable label
    const createRes = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "To Delete", color: "#999999" }),
      }
    );
    const created = await createRes.json();

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/${created.id}/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": testUser.id },
      }
    );
    expect(res.status).toBe(204);

    // Verify gone
    const listRes = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/`,
      { headers: { "x-test-user-id": testUser.id } }
    );
    const list = await listRes.json();
    expect(list.find((l: any) => l.id === created.id)).toBeUndefined();
  });

  test("returns 404 for non-existent label", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/nonexistent/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": testUser.id },
      }
    );
    expect(res.status).toBe(404);
  });

  test("issue-labels path also deletes", async () => {
    const createRes = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/issue-labels/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ name: "Delete Via Alias", color: "#888888" }),
      }
    );
    const created = await createRes.json();

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/issue-labels/${created.id}/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": testUser.id },
      }
    );
    expect(res.status).toBe(204);
  });
});

describe("Project Labels - Response Format", () => {
  test("returns all expected fields", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${project.id}/labels/label-b/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
        body: JSON.stringify({ sort_order: 5000 }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    // Verify all fields present matching IIssueLabel type
    expect(data.id).toBe("label-b");
    expect(data.project_id).toBe(project.id);
    expect(data.workspace_id).toBe(workspace.id);
    expect(typeof data.name).toBe("string");
    expect(typeof data.color).toBe("string");
    expect(data.sort_order).toBe(5000);
    expect(data).toHaveProperty("parent_id");
    expect(data).toHaveProperty("description");
    expect(data).toHaveProperty("created_by_id");
    expect(data).toHaveProperty("created_at");
    expect(data).toHaveProperty("updated_at");
  });
});

import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, desc, isNull, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../../db/schema/user";
import * as workspaceSchema from "../../db/schema/workspace";
import * as viewSchema from "../../db/schema/view";
import * as projectSchema from "../../db/schema/project";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: {
    ...userSchema,
    ...workspaceSchema,
    ...viewSchema,
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

  CREATE TABLE views (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    query TEXT NOT NULL DEFAULT '{}',
    query_data TEXT,
    filters_data TEXT,
    display_filters TEXT,
    display_properties TEXT,
    access_level INTEGER DEFAULT 1,
    sort_order REAL DEFAULT 65535,
    is_locked INTEGER DEFAULT 0,
    owned_by_id TEXT REFERENCES users(id),
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE view_favorites (
    id TEXT PRIMARY KEY,
    view_id TEXT NOT NULL REFERENCES views(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(view_id, user_id)
  );
`);

// Test data
let adminUser: { id: string; email: string };
let memberUser: { id: string; email: string };
let guestUser: { id: string; email: string };
let workspace: { id: string; slug: string };

const ROLES = { GUEST: 5, VIEWER: 10, MEMBER: 15, ADMIN: 20 };

// Helper: get current user from header
function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === adminUser?.id) return adminUser;
  if (userId === memberUser?.id) return memberUser;
  if (userId === guestUser?.id) return guestUser;
  return null;
}

function getMembership(userId: string) {
  if (userId === adminUser?.id) return { role: ROLES.ADMIN };
  if (userId === memberUser?.id) return { role: ROLES.MEMBER };
  if (userId === guestUser?.id) return { role: ROLES.GUEST };
  return null;
}

// Setup test app replicating route logic
const app = new Hono();

// LIST
app.get("/api/workspaces/:slug/views/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });
  if (!ws) return c.json({ detail: "Not found." }, 404);

  const membership = getMembership(user.id);
  if (!membership) return c.json({ detail: "Not a member." }, 403);

  const isGuest = membership.role === ROLES.GUEST;

  const allViews = await db.query.views.findMany({
    where: and(
      eq(viewSchema.views.workspaceId, ws.id),
      isNull(viewSchema.views.projectId)
    ),
    orderBy: [desc(viewSchema.views.createdAt)],
  });

  const filtered = isGuest
    ? allViews.filter((v) => v.ownedById === user.id)
    : allViews.filter((v) => v.ownedById === user.id || v.accessLevel === 1);

  const userFavorites = await db
    .select({ viewId: viewSchema.viewFavorites.viewId })
    .from(viewSchema.viewFavorites)
    .where(eq(viewSchema.viewFavorites.userId, user.id));
  const favSet = new Set(userFavorites.map((f) => f.viewId));

  const result = filtered.map((v) => ({
    id: v.id,
    workspace: ws.id,
    project: v.projectId,
    name: v.name,
    description: v.description ?? "",
    query: v.query ?? {},
    query_data: v.queryData ?? {},
    filters: v.filtersData ?? {},
    display_filters: v.displayFilters ?? {},
    display_properties: v.displayProperties ?? {},
    access: v.accessLevel ?? 1,
    sort_order: v.sortOrder ?? 65535,
    is_locked: v.isLocked ?? false,
    is_favorite: favSet.has(v.id),
    owned_by: v.ownedById,
    created_at: v.createdAt?.toISOString() ?? null,
    updated_at: v.updatedAt?.toISOString() ?? null,
  }));

  return c.json(result);
});

// CREATE
app.post("/api/workspaces/:slug/views/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });
  if (!ws) return c.json({ detail: "Not found." }, 404);

  const body = await c.req.json();

  // Auto-calculate sort_order (max + 10000)
  let sortOrder = body.sort_order;
  if (sortOrder === undefined) {
    const maxResult = await db
      .select({ largest: sql<number>`MAX(${viewSchema.views.sortOrder})` })
      .from(viewSchema.views)
      .where(
        and(
          eq(viewSchema.views.workspaceId, ws.id),
          isNull(viewSchema.views.projectId)
        )
      );
    const largest = maxResult[0]?.largest;
    sortOrder = largest != null ? largest + 10000 : 65535;
  }

  const [created] = await db
    .insert(viewSchema.views)
    .values({
      workspaceId: ws.id,
      name: body.name,
      description: body.description ?? "",
      query: body.query ?? {},
      queryData: body.query_data ?? {},
      filtersData: body.filters ?? {},
      displayFilters: body.display_filters ?? {},
      displayProperties: body.display_properties ?? {},
      accessLevel: body.access ?? 1,
      sortOrder,
      isLocked: body.is_locked ?? false,
      ownedById: user.id,
    })
    .returning();

  return c.json(
    {
      id: created.id,
      workspace: ws.id,
      project: null,
      name: created.name,
      description: created.description ?? "",
      query: created.query ?? {},
      query_data: created.queryData ?? {},
      filters: created.filtersData ?? {},
      display_filters: created.displayFilters ?? {},
      display_properties: created.displayProperties ?? {},
      access: created.accessLevel ?? 1,
      sort_order: created.sortOrder ?? 65535,
      is_locked: created.isLocked ?? false,
      is_favorite: false,
      owned_by: created.ownedById,
      created_at: created.createdAt?.toISOString() ?? null,
      updated_at: created.updatedAt?.toISOString() ?? null,
    },
    201
  );
});

// RETRIEVE
app.get("/api/workspaces/:slug/views/:viewId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const viewId = c.req.param("viewId");

  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });
  if (!ws) return c.json({ detail: "Not found." }, 404);

  const view = await db.query.views.findFirst({
    where: and(
      eq(viewSchema.views.id, viewId),
      eq(viewSchema.views.workspaceId, ws.id),
      isNull(viewSchema.views.projectId)
    ),
  });
  if (!view) return c.json({ detail: "Not found." }, 404);

  const fav = await db.query.viewFavorites.findFirst({
    where: and(
      eq(viewSchema.viewFavorites.viewId, view.id),
      eq(viewSchema.viewFavorites.userId, user.id)
    ),
  });

  return c.json({
    id: view.id,
    workspace: ws.id,
    project: view.projectId,
    name: view.name,
    description: view.description ?? "",
    query: view.query ?? {},
    query_data: view.queryData ?? {},
    filters_data: view.filtersData ?? {},
    display_filters: view.displayFilters ?? {},
    display_properties: view.displayProperties ?? {},
    access: view.accessLevel ?? 1,
    sort_order: view.sortOrder ?? 65535,
    is_locked: view.isLocked ?? false,
    is_favorite: !!fav,
    owned_by: view.ownedById,
    created_at: view.createdAt?.toISOString() ?? null,
    updated_at: view.updatedAt?.toISOString() ?? null,
  });
});

// PARTIAL UPDATE
app.patch("/api/workspaces/:slug/views/:viewId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const viewId = c.req.param("viewId");

  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });
  if (!ws) return c.json({ detail: "Not found." }, 404);

  const view = await db.query.views.findFirst({
    where: and(
      eq(viewSchema.views.id, viewId),
      eq(viewSchema.views.workspaceId, ws.id),
      isNull(viewSchema.views.projectId)
    ),
  });
  if (!view) return c.json({ detail: "Not found." }, 404);

  if (view.ownedById !== user.id) {
    return c.json({ detail: "Only the owner can update this view." }, 403);
  }

  const body = await c.req.json();

  if (view.isLocked && body.is_locked !== false) {
    return c.json({ detail: "View is locked." }, 400);
  }

  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.query !== undefined) updateData.query = body.query;
  if (body.query_data !== undefined) updateData.queryData = body.query_data;
  if (body.filters !== undefined) updateData.filtersData = body.filters;
  if (body.display_filters !== undefined) updateData.displayFilters = body.display_filters;
  if (body.display_properties !== undefined) updateData.displayProperties = body.display_properties;
  if (body.access !== undefined) updateData.accessLevel = body.access;
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;
  if (body.is_locked !== undefined) updateData.isLocked = body.is_locked;

  const [updated] = await db
    .update(viewSchema.views)
    .set(updateData)
    .where(eq(viewSchema.views.id, viewId))
    .returning();

  const fav = await db.query.viewFavorites.findFirst({
    where: and(
      eq(viewSchema.viewFavorites.viewId, updated.id),
      eq(viewSchema.viewFavorites.userId, user.id)
    ),
  });

  return c.json({
    id: updated.id,
    workspace: ws.id,
    project: updated.projectId,
    name: updated.name,
    description: updated.description ?? "",
    query: updated.query ?? {},
    query_data: updated.queryData ?? {},
    filters: updated.filtersData ?? {},
    display_filters: updated.displayFilters ?? {},
    display_properties: updated.displayProperties ?? {},
    access: updated.accessLevel ?? 1,
    sort_order: updated.sortOrder ?? 65535,
    is_locked: updated.isLocked ?? false,
    is_favorite: !!fav,
    owned_by: updated.ownedById,
    created_at: updated.createdAt?.toISOString() ?? null,
    updated_at: updated.updatedAt?.toISOString() ?? null,
  });
});

// DELETE
app.delete("/api/workspaces/:slug/views/:viewId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const viewId = c.req.param("viewId");

  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });
  if (!ws) return c.json({ detail: "Not found." }, 404);

  const membership = getMembership(user.id);
  if (!membership) return c.json({ detail: "Not a member." }, 403);

  const view = await db.query.views.findFirst({
    where: and(
      eq(viewSchema.views.id, viewId),
      eq(viewSchema.views.workspaceId, ws.id),
      isNull(viewSchema.views.projectId)
    ),
  });
  if (!view) return c.json({ detail: "Not found." }, 404);

  const isAdmin = membership.role === ROLES.ADMIN;
  const isOwner = view.ownedById === user.id;
  if (!isAdmin && !isOwner) {
    return c.json({ detail: "Only the owner or admin can delete this view." }, 403);
  }

  await db.delete(viewSchema.viewFavorites).where(eq(viewSchema.viewFavorites.viewId, viewId));
  await db.delete(viewSchema.views).where(eq(viewSchema.views.id, viewId));

  return c.body(null, 204);
});

beforeAll(async () => {
  adminUser = { id: createId(), email: "admin@example.com" };
  memberUser = { id: createId(), email: "member@example.com" };
  guestUser = { id: createId(), email: "guest@example.com" };

  await db.insert(userSchema.users).values([
    { id: adminUser.id, email: adminUser.email, name: "Admin User" },
    { id: memberUser.id, email: memberUser.email, name: "Member User" },
    { id: guestUser.id, email: guestUser.email, name: "Guest User" },
  ]);

  workspace = { id: createId(), slug: "test-workspace" };

  await db.insert(workspaceSchema.workspaces).values({
    id: workspace.id,
    name: "Test Workspace",
    slug: workspace.slug,
    ownerId: adminUser.id,
  });

  await db.insert(workspaceSchema.workspaceMembers).values([
    { workspaceId: workspace.id, userId: adminUser.id, role: ROLES.ADMIN, isActive: true },
    { workspaceId: workspace.id, userId: memberUser.id, role: ROLES.MEMBER, isActive: true },
    { workspaceId: workspace.id, userId: guestUser.id, role: ROLES.GUEST, isActive: true },
  ]);

  // Seed some workspace-level views
  // Public view owned by admin
  await db.insert(viewSchema.views).values({
    id: "view-public-admin",
    workspaceId: workspace.id,
    name: "Public Admin View",
    query: {},
    accessLevel: 1, // Public
    ownedById: adminUser.id,
  });

  // Private view owned by admin
  await db.insert(viewSchema.views).values({
    id: "view-private-admin",
    workspaceId: workspace.id,
    name: "Private Admin View",
    query: {},
    accessLevel: 0, // Private
    ownedById: adminUser.id,
  });

  // Public view owned by member
  await db.insert(viewSchema.views).values({
    id: "view-public-member",
    workspaceId: workspace.id,
    name: "Public Member View",
    query: {},
    accessLevel: 1,
    ownedById: memberUser.id,
  });

  // Private view owned by member
  await db.insert(viewSchema.views).values({
    id: "view-private-member",
    workspaceId: workspace.id,
    name: "Private Member View",
    query: {},
    accessLevel: 0,
    ownedById: memberUser.id,
  });

  // Locked view owned by member
  await db.insert(viewSchema.views).values({
    id: "view-locked-member",
    workspaceId: workspace.id,
    name: "Locked Member View",
    query: {},
    accessLevel: 1,
    isLocked: true,
    ownedById: memberUser.id,
  });

  // Favorite the public admin view for memberUser
  await db.insert(viewSchema.viewFavorites).values({
    id: createId(),
    viewId: "view-public-admin",
    userId: memberUser.id,
  });
});

describe("Workspace Views - LIST", () => {
  test("admin sees own views + public views from others", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      { headers: { "x-test-user-id": adminUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    // Admin should see: own public + own private + member's public + member's locked (public)
    // NOT member's private view
    const ids = data.map((v: any) => v.id);
    expect(ids).toContain("view-public-admin");
    expect(ids).toContain("view-private-admin");
    expect(ids).toContain("view-public-member");
    expect(ids).toContain("view-locked-member");
    expect(ids).not.toContain("view-private-member");
  });

  test("member sees own views + public views from others", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      { headers: { "x-test-user-id": memberUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    const ids = data.map((v: any) => v.id);
    expect(ids).toContain("view-public-admin");
    expect(ids).toContain("view-public-member");
    expect(ids).toContain("view-private-member");
    expect(ids).toContain("view-locked-member");
    expect(ids).not.toContain("view-private-admin");
  });

  test("guest only sees own views", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      { headers: { "x-test-user-id": guestUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(0); // guest has no views
  });

  test("includes is_favorite for favorited views", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      { headers: { "x-test-user-id": memberUser.id } }
    );
    const data = await res.json();
    const publicAdminView = data.find((v: any) => v.id === "view-public-admin");
    expect(publicAdminView.is_favorite).toBe(true);
    const publicMemberView = data.find((v: any) => v.id === "view-public-member");
    expect(publicMemberView.is_favorite).toBe(false);
  });

  test("returns 401 without authentication", async () => {
    const res = await app.request(`/api/workspaces/${workspace.slug}/views/`);
    expect(res.status).toBe(401);
  });
});

describe("Workspace Views - CREATE", () => {
  test("creates a new workspace view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": memberUser.id,
        },
        body: JSON.stringify({
          name: "My New View",
          description: "A test view",
          access: 1,
          query: { priority: ["high"] },
        }),
      }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("My New View");
    expect(data.description).toBe("A test view");
    expect(data.access).toBe(1);
    expect(data.owned_by).toBe(memberUser.id);
    expect(data.is_favorite).toBe(false);
    expect(data.project).toBeNull();
    expect(data.id).toBeDefined();
  });

  test("creates view with defaults", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": adminUser.id,
        },
        body: JSON.stringify({ name: "Minimal View" }),
      }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Minimal View");
    expect(data.access).toBe(1);
    expect(data.is_locked).toBe(false);
    // sort_order auto-calculated: max existing + 10000
    expect(data.sort_order).toBeGreaterThan(65535);
  });
});

describe("Workspace Views - RETRIEVE", () => {
  test("retrieves a specific view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/view-public-admin/`,
      { headers: { "x-test-user-id": adminUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("view-public-admin");
    expect(data.name).toBe("Public Admin View");
    expect(data.workspace).toBe(workspace.id);
  });

  test("shows is_favorite for favorited view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/view-public-admin/`,
      { headers: { "x-test-user-id": memberUser.id } }
    );
    const data = await res.json();
    expect(data.is_favorite).toBe(true);
  });

  test("returns 404 for non-existent view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/nonexistent/`,
      { headers: { "x-test-user-id": adminUser.id } }
    );
    expect(res.status).toBe(404);
  });
});

describe("Workspace Views - PARTIAL UPDATE", () => {
  test("owner can update their view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/view-public-member/`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": memberUser.id,
        },
        body: JSON.stringify({ name: "Updated Member View" }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Member View");
  });

  test("non-owner cannot update view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/view-public-admin/`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": memberUser.id,
        },
        body: JSON.stringify({ name: "Hijacked" }),
      }
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.detail).toBe("Only the owner can update this view.");
  });

  test("locked view cannot be updated (except to unlock)", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/view-locked-member/`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": memberUser.id,
        },
        body: JSON.stringify({ name: "Try Update Locked" }),
      }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.detail).toBe("View is locked.");
  });

  test("owner can unlock a locked view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/view-locked-member/`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": memberUser.id,
        },
        body: JSON.stringify({ is_locked: false }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.is_locked).toBe(false);
  });
});

describe("Workspace Views - DELETE", () => {
  test("owner can delete their view", async () => {
    // Create a view to delete
    const createRes = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": memberUser.id,
        },
        body: JSON.stringify({ name: "To Delete" }),
      }
    );
    const created = await createRes.json();

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/${created.id}/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": memberUser.id },
      }
    );
    expect(res.status).toBe(204);

    // Verify it's gone
    const getRes = await app.request(
      `/api/workspaces/${workspace.slug}/views/${created.id}/`,
      { headers: { "x-test-user-id": memberUser.id } }
    );
    expect(getRes.status).toBe(404);
  });

  test("admin can delete any view", async () => {
    // Create a view owned by member
    const createRes = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": memberUser.id,
        },
        body: JSON.stringify({ name: "Admin Will Delete" }),
      }
    );
    const created = await createRes.json();

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/${created.id}/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": adminUser.id },
      }
    );
    expect(res.status).toBe(204);
  });

  test("non-owner non-admin cannot delete view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/view-public-admin/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": memberUser.id },
      }
    );
    expect(res.status).toBe(403);
  });

  test("returns 404 for non-existent view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/views/nonexistent/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": adminUser.id },
      }
    );
    expect(res.status).toBe(404);
  });

  test("deleting view also removes favorites", async () => {
    // Create view, favorite it, then delete
    const createRes = await app.request(
      `/api/workspaces/${workspace.slug}/views/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": memberUser.id,
        },
        body: JSON.stringify({ name: "Favorited Then Deleted" }),
      }
    );
    const created = await createRes.json();

    // Add a favorite
    await db.insert(viewSchema.viewFavorites).values({
      id: createId(),
      viewId: created.id,
      userId: memberUser.id,
    });

    // Delete
    const delRes = await app.request(
      `/api/workspaces/${workspace.slug}/views/${created.id}/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": memberUser.id },
      }
    );
    expect(delRes.status).toBe(204);

    // Verify favorites are cleaned up
    const remainingFavs = await db.query.viewFavorites.findMany({
      where: eq(viewSchema.viewFavorites.viewId, created.id),
    });
    expect(remainingFavs).toHaveLength(0);
  });
});

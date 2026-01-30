import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, isNull, isNotNull, inArray, desc, max, count as countFn } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../../db/schema/user";
import * as workspaceSchema from "../../db/schema/workspace";
import * as projectSchema from "../../db/schema/project";
import * as moduleSchema from "../../db/schema/module";
import * as issueSchema from "../../db/schema/issue";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: {
    ...userSchema,
    ...workspaceSchema,
    ...projectSchema,
    ...moduleSchema,
    ...issueSchema,
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

  CREATE TABLE states (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#858e96',
    "group" TEXT DEFAULT 'backlog',
    is_default INTEGER DEFAULT 0,
    sort_order REAL DEFAULT 65535,
    is_triage INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE modules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    description_text TEXT,
    description_html TEXT,
    start_date INTEGER,
    target_date INTEGER,
    status TEXT DEFAULT 'backlog',
    lead_id TEXT REFERENCES users(id),
    sort_order REAL DEFAULT 65535,
    view_props TEXT,
    archived_at INTEGER,
    created_by_id TEXT REFERENCES users(id),
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE module_issues (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(module_id, issue_id)
  );

  CREATE TABLE module_members (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(module_id, member_id)
  );

  CREATE TABLE module_favorites (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(module_id, user_id)
  );

  CREATE TABLE module_links (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    title TEXT,
    url TEXT NOT NULL,
    metadata TEXT,
    created_by_id TEXT REFERENCES users(id),
    created_at INTEGER
  );

  CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    state_id TEXT REFERENCES states(id),
    name TEXT NOT NULL,
    description TEXT,
    description_html TEXT,
    description_stripped TEXT,
    priority TEXT DEFAULT 'none',
    parent_id TEXT REFERENCES issues(id),
    sort_order REAL DEFAULT 65535,
    start_date INTEGER,
    target_date INTEGER,
    sequence_id INTEGER,
    archived_at INTEGER,
    deleted_at INTEGER,
    created_by_id TEXT REFERENCES users(id),
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE issue_assignees (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    assignee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(issue_id, assignee_id)
  );

  CREATE TABLE recent_visits (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    visited_at INTEGER,
    created_at INTEGER
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

const app = new Hono();

// --- Module CRUD ---

// POST - Create module
app.post("/api/workspaces/:slug/projects/:projectId/modules/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  let startDate: Date | null = null;
  let targetDate: Date | null = null;
  if (body.start_date) startDate = new Date(body.start_date);
  if (body.target_date) targetDate = new Date(body.target_date);

  let sortOrder = body.sort_order;
  if (sortOrder === undefined) {
    const maxResult = await db.select({ largest: max(moduleSchema.modules.sortOrder) }).from(moduleSchema.modules).where(eq(moduleSchema.modules.projectId, projectId));
    sortOrder = maxResult[0]?.largest != null ? maxResult[0].largest + 10000 : 65535;
  }

  const [created] = await db.insert(moduleSchema.modules).values({
    projectId,
    workspaceId: workspace.id,
    name: body.name,
    description: body.description ?? null,
    descriptionText: body.description_text ?? null,
    descriptionHtml: body.description_html ?? null,
    startDate,
    targetDate,
    status: body.status ?? "backlog",
    leadId: body.lead_id ?? null,
    sortOrder,
    createdById: user.id,
  }).returning();

  const memberIds = body.member_ids ?? [];
  if (memberIds.length > 0) {
    await db.insert(moduleSchema.moduleMembers).values(
      memberIds.map((memberId: string) => ({ moduleId: created.id, memberId }))
    );
  }

  return c.json({
    id: created.id,
    workspace_id: created.workspaceId,
    project_id: created.projectId,
    name: created.name,
    description: created.description ?? "",
    start_date: created.startDate?.toISOString().split("T")[0] ?? null,
    target_date: created.targetDate?.toISOString().split("T")[0] ?? null,
    status: created.status ?? "backlog",
    lead_id: created.leadId ?? null,
    member_ids: memberIds,
    sort_order: created.sortOrder ?? 65535,
    is_favorite: false,
    total_issues: 0,
    created_at: created.createdAt?.toISOString() ?? null,
    updated_at: created.updatedAt?.toISOString() ?? null,
    archived_at: null,
  }, 201);
});

// GET - List modules
app.get("/api/workspaces/:slug/projects/:projectId/modules/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");

  const allModules = await db
    .select()
    .from(moduleSchema.modules)
    .where(and(eq(moduleSchema.modules.projectId, projectId), isNull(moduleSchema.modules.archivedAt)))
    .orderBy(desc(moduleSchema.modules.createdAt));

  if (allModules.length === 0) return c.json([]);

  const moduleIds = allModules.map((m) => m.id);

  const allMembers = await db
    .select({ moduleId: moduleSchema.moduleMembers.moduleId, memberId: moduleSchema.moduleMembers.memberId })
    .from(moduleSchema.moduleMembers)
    .where(inArray(moduleSchema.moduleMembers.moduleId, moduleIds));

  const membersByModule = new Map<string, string[]>();
  for (const mm of allMembers) {
    const existing = membersByModule.get(mm.moduleId) || [];
    existing.push(mm.memberId);
    membersByModule.set(mm.moduleId, existing);
  }

  const userFavorites = await db
    .select({ moduleId: moduleSchema.moduleFavorites.moduleId })
    .from(moduleSchema.moduleFavorites)
    .where(and(inArray(moduleSchema.moduleFavorites.moduleId, moduleIds), eq(moduleSchema.moduleFavorites.userId, user.id)));

  const favModuleIds = new Set(userFavorites.map((f) => f.moduleId));

  const result = allModules.map((m) => ({
    id: m.id,
    workspace_id: m.workspaceId,
    project_id: m.projectId,
    name: m.name,
    description: m.description ?? "",
    start_date: m.startDate?.toISOString().split("T")[0] ?? null,
    target_date: m.targetDate?.toISOString().split("T")[0] ?? null,
    status: m.status ?? "backlog",
    lead_id: m.leadId ?? null,
    member_ids: membersByModule.get(m.id) || [],
    sort_order: m.sortOrder ?? 65535,
    is_favorite: favModuleIds.has(m.id),
    created_at: m.createdAt?.toISOString() ?? null,
    updated_at: m.updatedAt?.toISOString() ?? null,
    archived_at: m.archivedAt?.toISOString() ?? null,
  }));

  result.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return 0;
  });

  return c.json(result);
});

// GET - Retrieve single module
app.get("/api/workspaces/:slug/projects/:projectId/modules/:moduleId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: and(eq(moduleSchema.modules.id, moduleId), eq(moduleSchema.modules.projectId, projectId), isNull(moduleSchema.modules.archivedAt)),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  const members = await db
    .select({ memberId: moduleSchema.moduleMembers.memberId })
    .from(moduleSchema.moduleMembers)
    .where(eq(moduleSchema.moduleMembers.moduleId, moduleId));

  const fav = await db.query.moduleFavorites.findFirst({
    where: and(eq(moduleSchema.moduleFavorites.moduleId, moduleId), eq(moduleSchema.moduleFavorites.userId, user.id)),
  });

  const links = await db.select().from(moduleSchema.moduleLinks).where(eq(moduleSchema.moduleLinks.moduleId, moduleId));

  return c.json({
    id: mod.id,
    workspace_id: mod.workspaceId,
    project_id: mod.projectId,
    name: mod.name,
    description: mod.description ?? "",
    start_date: mod.startDate?.toISOString().split("T")[0] ?? null,
    target_date: mod.targetDate?.toISOString().split("T")[0] ?? null,
    status: mod.status ?? "backlog",
    lead_id: mod.leadId ?? null,
    member_ids: members.map((m) => m.memberId),
    sort_order: mod.sortOrder ?? 65535,
    is_favorite: !!fav,
    link_module: links.map((l) => ({
      id: l.id,
      module: l.moduleId,
      title: l.title ?? "",
      url: l.url,
    })),
    created_at: mod.createdAt?.toISOString() ?? null,
    updated_at: mod.updatedAt?.toISOString() ?? null,
    archived_at: mod.archivedAt?.toISOString() ?? null,
  });
});

// PATCH - Update module
app.patch("/api/workspaces/:slug/projects/:projectId/modules/:moduleId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: eq(moduleSchema.modules.id, moduleId),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  if (mod.archivedAt) {
    return c.json({ error: "Archived module cannot be updated" }, 400);
  }

  const body = await c.req.json();
  const updateData: Record<string, any> = { updatedAt: new Date() };

  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.lead_id !== undefined) updateData.leadId = body.lead_id;
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;
  if (body.start_date !== undefined) updateData.startDate = body.start_date ? new Date(body.start_date) : null;
  if (body.target_date !== undefined) updateData.targetDate = body.target_date ? new Date(body.target_date) : null;

  await db.update(moduleSchema.modules).set(updateData).where(eq(moduleSchema.modules.id, moduleId));

  if (body.member_ids !== undefined) {
    await db.delete(moduleSchema.moduleMembers).where(eq(moduleSchema.moduleMembers.moduleId, moduleId));
    if (body.member_ids.length > 0) {
      await db.insert(moduleSchema.moduleMembers).values(
        body.member_ids.map((memberId: string) => ({ moduleId, memberId }))
      );
    }
  }

  const updated = await db.query.modules.findFirst({ where: eq(moduleSchema.modules.id, moduleId) });
  const members = await db
    .select({ memberId: moduleSchema.moduleMembers.memberId })
    .from(moduleSchema.moduleMembers)
    .where(eq(moduleSchema.moduleMembers.moduleId, moduleId));

  return c.json({
    id: updated!.id,
    name: updated!.name,
    description: updated!.description ?? "",
    status: updated!.status ?? "backlog",
    lead_id: updated!.leadId ?? null,
    member_ids: members.map((m) => m.memberId),
    sort_order: updated!.sortOrder ?? 65535,
    start_date: updated!.startDate?.toISOString().split("T")[0] ?? null,
    target_date: updated!.targetDate?.toISOString().split("T")[0] ?? null,
    created_at: updated!.createdAt?.toISOString() ?? null,
    updated_at: updated!.updatedAt?.toISOString() ?? null,
    archived_at: updated!.archivedAt?.toISOString() ?? null,
  });
});

// DELETE - Delete module
app.delete("/api/workspaces/:slug/projects/:projectId/modules/:moduleId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: eq(moduleSchema.modules.id, moduleId),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  await db.delete(moduleSchema.modules).where(eq(moduleSchema.modules.id, moduleId));
  await db.delete(moduleSchema.moduleFavorites).where(eq(moduleSchema.moduleFavorites.moduleId, moduleId));

  return c.body(null, 204);
});

// --- Module Links ---

app.post("/api/workspaces/:slug/projects/:projectId/modules/:moduleId/module-links/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: eq(moduleSchema.modules.id, moduleId),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  const body = await c.req.json();

  const [link] = await db.insert(moduleSchema.moduleLinks).values({
    moduleId,
    title: body.title ?? null,
    url: body.url,
    metadata: body.metadata ?? null,
    createdById: user.id,
  }).returning();

  return c.json({
    id: link.id,
    module: link.moduleId,
    title: link.title ?? "",
    url: link.url,
    created_by: link.createdById ?? null,
    created_at: link.createdAt?.toISOString() ?? null,
  }, 201);
});

app.patch("/api/workspaces/:slug/projects/:projectId/modules/:moduleId/module-links/:linkId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const linkId = c.req.param("linkId");
  const moduleId = c.req.param("moduleId");

  const link = await db.query.moduleLinks.findFirst({
    where: and(eq(moduleSchema.moduleLinks.id, linkId), eq(moduleSchema.moduleLinks.moduleId, moduleId)),
  });
  if (!link) return c.json({ error: "Link not found" }, 404);

  const body = await c.req.json();
  const updateData: Record<string, any> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.url !== undefined) updateData.url = body.url;

  await db.update(moduleSchema.moduleLinks).set(updateData).where(eq(moduleSchema.moduleLinks.id, linkId));
  const updated = await db.query.moduleLinks.findFirst({ where: eq(moduleSchema.moduleLinks.id, linkId) });

  return c.json({
    id: updated!.id,
    module: updated!.moduleId,
    title: updated!.title ?? "",
    url: updated!.url,
    created_by: updated!.createdById ?? null,
    created_at: updated!.createdAt?.toISOString() ?? null,
  });
});

app.delete("/api/workspaces/:slug/projects/:projectId/modules/:moduleId/module-links/:linkId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const linkId = c.req.param("linkId");
  const moduleId = c.req.param("moduleId");

  const link = await db.query.moduleLinks.findFirst({
    where: and(eq(moduleSchema.moduleLinks.id, linkId), eq(moduleSchema.moduleLinks.moduleId, moduleId)),
  });
  if (!link) return c.json({ error: "Link not found" }, 404);

  await db.delete(moduleSchema.moduleLinks).where(eq(moduleSchema.moduleLinks.id, linkId));
  return c.body(null, 204);
});

// --- Module Favorites ---

app.post("/api/workspaces/:slug/projects/:projectId/user-favorite-modules/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const body = await c.req.json();

  await db.insert(moduleSchema.moduleFavorites).values({
    moduleId: body.module,
    userId: user.id,
  });

  return c.body(null, 204);
});

app.delete("/api/workspaces/:slug/projects/:projectId/user-favorite-modules/:moduleId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const moduleId = c.req.param("moduleId");

  await db.delete(moduleSchema.moduleFavorites).where(
    and(eq(moduleSchema.moduleFavorites.moduleId, moduleId), eq(moduleSchema.moduleFavorites.userId, user.id))
  );

  return c.body(null, 204);
});

// --- Archive / Unarchive ---

app.get("/api/workspaces/:slug/projects/:projectId/archived-modules/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");

  const allModules = await db
    .select()
    .from(moduleSchema.modules)
    .where(and(eq(moduleSchema.modules.projectId, projectId), isNotNull(moduleSchema.modules.archivedAt)))
    .orderBy(desc(moduleSchema.modules.createdAt));

  return c.json(allModules.map((m) => ({
    id: m.id,
    name: m.name,
    status: m.status ?? "backlog",
    archived_at: m.archivedAt?.toISOString() ?? null,
  })));
});

app.post("/api/workspaces/:slug/projects/:projectId/modules/:moduleId/archive/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: eq(moduleSchema.modules.id, moduleId),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  if (mod.status !== "completed" && mod.status !== "cancelled") {
    return c.json({ error: "Only completed or cancelled modules can be archived" }, 400);
  }

  const now = new Date();
  await db.update(moduleSchema.modules).set({ archivedAt: now }).where(eq(moduleSchema.modules.id, moduleId));
  await db.delete(moduleSchema.moduleFavorites).where(eq(moduleSchema.moduleFavorites.moduleId, moduleId));

  return c.json({ archived_at: now.toISOString() });
});

app.delete("/api/workspaces/:slug/projects/:projectId/modules/:moduleId/archive/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: eq(moduleSchema.modules.id, moduleId),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  await db.update(moduleSchema.modules).set({ archivedAt: null }).where(eq(moduleSchema.modules.id, moduleId));

  return c.body(null, 204);
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

const baseUrl = () => `/api/workspaces/${workspace.slug}/projects/${project.id}`;
const modulesUrl = () => `${baseUrl()}/modules/`;
const moduleUrl = (id: string) => `${baseUrl()}/modules/${id}/`;

describe("Module CRUD - LIST", () => {
  test("returns empty list", async () => {
    const res = await app.request(modulesUrl(), {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request(modulesUrl());
    expect(res.status).toBe(401);
  });
});

describe("Module CRUD - CREATE", () => {
  test("creates module with minimal fields", async () => {
    const res = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Module Alpha" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Module Alpha");
    expect(data.status).toBe("backlog");
    expect(data.project_id).toBe(project.id);
    expect(data.workspace_id).toBe(workspace.id);
    expect(data.is_favorite).toBe(false);
    expect(data.total_issues).toBe(0);
    expect(data.id).toBeDefined();
  });

  test("creates module with dates and members", async () => {
    const res = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({
        name: "Module Beta",
        description: "Beta module",
        start_date: "2025-03-01",
        target_date: "2025-04-01",
        status: "planned",
        member_ids: [testUser.id, otherUser.id],
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Module Beta");
    expect(data.description).toBe("Beta module");
    expect(data.start_date).toBe("2025-03-01");
    expect(data.target_date).toBe("2025-04-01");
    expect(data.status).toBe("planned");
    expect(data.member_ids).toContain(testUser.id);
    expect(data.member_ids).toContain(otherUser.id);
  });
});

describe("Module CRUD - RETRIEVE", () => {
  test("retrieves module by id", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Module Gamma" }),
    });
    const created = await createRes.json();

    const res = await app.request(moduleUrl(created.id), {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(created.id);
    expect(data.name).toBe("Module Gamma");
    expect(data.link_module).toEqual([]);
  });

  test("returns 404 for non-existent module", async () => {
    const res = await app.request(moduleUrl("nonexistent"), {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(404);
  });
});

describe("Module CRUD - UPDATE", () => {
  test("updates module name and status", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Module Delta" }),
    });
    const created = await createRes.json();

    const res = await app.request(moduleUrl(created.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Module Delta Updated", status: "in-progress" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Module Delta Updated");
    expect(data.status).toBe("in-progress");
  });

  test("updates module members", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Module Epsilon", member_ids: [testUser.id] }),
    });
    const created = await createRes.json();
    expect(created.member_ids).toEqual([testUser.id]);

    const res = await app.request(moduleUrl(created.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ member_ids: [otherUser.id] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.member_ids).toEqual([otherUser.id]);
  });

  test("rejects update on archived module", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Module Zeta", status: "completed" }),
    });
    const created = await createRes.json();

    // Archive it
    await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });

    const res = await app.request(moduleUrl(created.id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Should Fail" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Archived");
  });
});

describe("Module CRUD - DELETE", () => {
  test("deletes module", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Module to Delete" }),
    });
    const created = await createRes.json();

    const res = await app.request(moduleUrl(created.id), {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(204);

    // Verify gone
    const getRes = await app.request(moduleUrl(created.id), {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(getRes.status).toBe(404);
  });
});

describe("Module Links", () => {
  let testModuleId: string;

  beforeAll(async () => {
    const res = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Module with Links" }),
    });
    const data = await res.json();
    testModuleId = data.id;
  });

  test("creates a link", async () => {
    const res = await app.request(`${baseUrl()}/modules/${testModuleId}/module-links/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ title: "Docs", url: "https://example.com/docs" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.title).toBe("Docs");
    expect(data.url).toBe("https://example.com/docs");
    expect(data.created_by).toBe(testUser.id);
  });

  test("link appears in module detail", async () => {
    const res = await app.request(moduleUrl(testModuleId), {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data.link_module.length).toBeGreaterThan(0);
    expect(data.link_module[0].url).toBe("https://example.com/docs");
  });

  test("updates a link", async () => {
    const createRes = await app.request(`${baseUrl()}/modules/${testModuleId}/module-links/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ title: "Old Title", url: "https://example.com/old" }),
    });
    const created = await createRes.json();

    const res = await app.request(`${baseUrl()}/modules/${testModuleId}/module-links/${created.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ title: "New Title", url: "https://example.com/new" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("New Title");
    expect(data.url).toBe("https://example.com/new");
  });

  test("deletes a link", async () => {
    const createRes = await app.request(`${baseUrl()}/modules/${testModuleId}/module-links/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ title: "To Delete", url: "https://example.com/delete" }),
    });
    const created = await createRes.json();

    const res = await app.request(`${baseUrl()}/modules/${testModuleId}/module-links/${created.id}/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(204);
  });

  test("returns 404 for link on non-existent module", async () => {
    const res = await app.request(`${baseUrl()}/modules/nonexistent/module-links/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ title: "Test", url: "https://example.com" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("Module Favorites", () => {
  let favModuleId: string;

  beforeAll(async () => {
    const res = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Favoriteable Module" }),
    });
    const data = await res.json();
    favModuleId = data.id;
  });

  test("adds module to favorites", async () => {
    const res = await app.request(`${baseUrl()}/user-favorite-modules/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ module: favModuleId }),
    });
    expect(res.status).toBe(204);
  });

  test("module shows as favorite in list", async () => {
    const res = await app.request(modulesUrl(), {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    const favModule = data.find((m: any) => m.id === favModuleId);
    expect(favModule?.is_favorite).toBe(true);
  });

  test("module shows as favorite in detail", async () => {
    const res = await app.request(moduleUrl(favModuleId), {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data.is_favorite).toBe(true);
  });

  test("removes module from favorites", async () => {
    const res = await app.request(`${baseUrl()}/user-favorite-modules/${favModuleId}/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(204);
  });

  test("module no longer favorite after removal", async () => {
    const res = await app.request(moduleUrl(favModuleId), {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data.is_favorite).toBe(false);
  });
});

describe("Module Archive / Unarchive", () => {
  test("archives a completed module", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Completed Module", status: "completed" }),
    });
    const created = await createRes.json();

    const res = await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archived_at).toBeDefined();
  });

  test("archives a cancelled module", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Cancelled Module", status: "cancelled" }),
    });
    const created = await createRes.json();

    const res = await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
  });

  test("rejects archiving in-progress module", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "In-progress Module", status: "in-progress" }),
    });
    const created = await createRes.json();

    const res = await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("completed or cancelled");
  });

  test("rejects archiving backlog module", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Backlog Module" }),
    });
    const created = await createRes.json();

    const res = await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(400);
  });

  test("archived module appears in archived list", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Archive List Module", status: "completed" }),
    });
    const created = await createRes.json();

    await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });

    const res = await app.request(`${baseUrl()}/archived-modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const found = data.find((m: any) => m.id === created.id);
    expect(found).toBeDefined();
    expect(found.archived_at).toBeDefined();
  });

  test("archived module does not appear in non-archived list", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Hidden After Archive", status: "completed" }),
    });
    const created = await createRes.json();

    await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });

    const res = await app.request(modulesUrl(), {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    const found = data.find((m: any) => m.id === created.id);
    expect(found).toBeUndefined();
  });

  test("unarchives a module", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Unarchive Me", status: "completed" }),
    });
    const created = await createRes.json();

    await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });

    const res = await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(204);

    const listRes = await app.request(modulesUrl(), {
      headers: { "x-test-user-id": testUser.id },
    });
    const listData = await listRes.json();
    const found = listData.find((m: any) => m.id === created.id);
    expect(found).toBeDefined();
  });

  test("archiving removes favorites", async () => {
    const createRes = await app.request(modulesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ name: "Fav Then Archive", status: "completed" }),
    });
    const created = await createRes.json();

    // Add to favorites
    await app.request(`${baseUrl()}/user-favorite-modules/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ module: created.id }),
    });

    // Archive
    await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });

    // Unarchive and check favorite is gone
    await app.request(`${baseUrl()}/modules/${created.id}/archive/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });

    const res = await app.request(moduleUrl(created.id), {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data.is_favorite).toBe(false);
  });
});

import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, isNull, asc, inArray, count as countFn } from "drizzle-orm";
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

// Create tables
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
    color TEXT NOT NULL DEFAULT '#000000',
    "group" TEXT NOT NULL DEFAULT 'backlog',
    description TEXT,
    sequence REAL DEFAULT 65535,
    is_default INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE favorites (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    name TEXT,
    is_folder INTEGER DEFAULT 0,
    sequence REAL DEFAULT 65535,
    parent_id TEXT,
    sort_order REAL DEFAULT 65535,
    created_at INTEGER
  );

  CREATE TABLE recent_visits (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    visited_at INTEGER
  );
`);

// Constants
const ROLES = { ADMIN: 20, MEMBER: 15, VIEWER: 10, GUEST: 5 };

const DEFAULT_STATES = [
  { name: "Backlog", color: "#60646C", group: "backlog", sequence: 15000, default: true },
  { name: "Todo", color: "#60646C", group: "unstarted", sequence: 25000, default: false },
  { name: "In Progress", color: "#F59E0B", group: "started", sequence: 35000, default: false },
  { name: "Done", color: "#46A758", group: "completed", sequence: 45000, default: false },
  { name: "Cancelled", color: "#9AA4BC", group: "cancelled", sequence: 55000, default: false },
];

// Test data
let adminUser: { id: string; email: string };
let memberUser: { id: string; email: string };
let guestUser: { id: string; email: string };
let workspace: { id: string; slug: string };

// Helper to format project response (replicates route logic)
function formatProject(p: any, extra?: any) {
  return {
    id: p.id,
    workspace: p.workspaceId,
    workspace_id: p.workspaceId,
    name: p.name,
    description: p.description ?? "",
    description_text: p.descriptionText ?? null,
    description_html: p.descriptionHtml ?? null,
    network: p.network ?? 2,
    identifier: p.identifier,
    emoji: p.emoji ?? null,
    icon_prop: p.iconProp ?? null,
    logo_props: p.logoProps ?? {},
    cover_image: p.coverImage ?? null,
    cover_image_url: p.coverImage ?? null,
    archive_in: p.archiveIn ?? 0,
    close_in: p.closeIn ?? 0,
    default_assignee: p.defaultAssigneeId ?? null,
    default_state: p.defaultStateId ?? null,
    project_lead: p.projectLeadId ?? null,
    estimate: p.estimateId ?? null,
    cycle_view: p.cycleView ?? true,
    module_view: p.moduleView ?? true,
    issue_views_view: p.issueViewsView ?? true,
    page_view: p.pageView ?? true,
    inbox_view: p.intakeView ?? false,
    guest_view_all_features: p.guestViewAllFeatures ?? false,
    archived_at: p.archivedAt?.toISOString() ?? null,
    sort_order: extra?.sortOrder ?? p.sortOrder ?? 65535,
    is_favorite: extra?.isFavorite ?? false,
    is_member: extra?.isMember ?? false,
    member_role: extra?.memberRole ?? null,
    members: extra?.members ?? [],
    anchor: extra?.anchor ?? null,
    total_members: extra?.memberCount ?? 0,
    created_by: p.createdById ?? null,
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
  };
}

// Setup test app with replicated route logic
const app = new Hono();

// Simulate: current user is set by test via header
function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === adminUser?.id) return adminUser;
  if (userId === memberUser?.id) return memberUser;
  if (userId === guestUser?.id) return guestUser;
  return null;
}

// GET / - List projects (minimal)
app.get("/api/workspaces/:slug/projects/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const wsMembership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceSchema.workspaceMembers.workspaceId, workspace.id),
      eq(workspaceSchema.workspaceMembers.userId, user.id),
      eq(workspaceSchema.workspaceMembers.isActive, true)
    ),
  });

  const userMemberships = await db
    .select({
      projectId: projectSchema.projectMembers.projectId,
      role: projectSchema.projectMembers.role,
      sortOrder: projectSchema.projectMembers.sortOrder,
    })
    .from(projectSchema.projectMembers)
    .where(and(
      eq(projectSchema.projectMembers.memberId, user.id),
      eq(projectSchema.projectMembers.isActive, true)
    ));

  const memberProjectIds = new Set(userMemberships.map((m) => m.projectId));
  const memberRoleMap = new Map(userMemberships.map((m) => [m.projectId, m.role]));
  const memberSortOrderMap = new Map(userMemberships.map((m) => [m.projectId, m.sortOrder]));

  const allProjects = await db.query.projects.findMany({
    where: and(
      eq(projectSchema.projects.workspaceId, workspace.id),
      isNull(projectSchema.projects.deletedAt)
    ),
    orderBy: [asc(projectSchema.projects.sortOrder), asc(projectSchema.projects.name)],
  });

  let visibleProjects = allProjects;
  const wsRole = wsMembership?.role;

  if (wsRole === ROLES.GUEST) {
    visibleProjects = allProjects.filter((p) => memberProjectIds.has(p.id));
  } else if (wsRole === ROLES.MEMBER) {
    visibleProjects = allProjects.filter(
      (p) => memberProjectIds.has(p.id) || p.network === 2
    );
  }

  const results = visibleProjects.map((p) => ({
    id: p.id,
    name: p.name,
    identifier: p.identifier,
    sort_order: memberSortOrderMap.get(p.id) ?? p.sortOrder ?? 65535,
    logo_props: p.logoProps ?? {},
    member_role: memberRoleMap.get(p.id) ?? null,
    archived_at: p.archivedAt?.toISOString() ?? null,
    workspace: p.workspaceId,
    cycle_view: p.cycleView ?? true,
    module_view: p.moduleView ?? true,
    page_view: p.pageView ?? true,
    inbox_view: p.intakeView ?? false,
    network: p.network ?? 2,
  }));

  return c.json(results);
});

// GET /details/ - List projects (detailed)
app.get("/api/workspaces/:slug/projects/details/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const wsMembership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceSchema.workspaceMembers.workspaceId, workspace.id),
      eq(workspaceSchema.workspaceMembers.userId, user.id),
      eq(workspaceSchema.workspaceMembers.isActive, true)
    ),
  });

  const allProjects = await db.query.projects.findMany({
    where: and(
      eq(projectSchema.projects.workspaceId, workspace.id),
      isNull(projectSchema.projects.deletedAt)
    ),
  });

  const userMemberships = await db
    .select({ projectId: projectSchema.projectMembers.projectId, role: projectSchema.projectMembers.role })
    .from(projectSchema.projectMembers)
    .where(and(eq(projectSchema.projectMembers.memberId, user.id), eq(projectSchema.projectMembers.isActive, true)));

  const memberProjectIds = new Set(userMemberships.map((m) => m.projectId));
  const memberRoleMap = new Map(userMemberships.map((m) => [m.projectId, m.role]));

  let visibleProjects = allProjects;
  const wsRole = wsMembership?.role;

  if (wsRole === ROLES.GUEST) {
    visibleProjects = allProjects.filter((p) => memberProjectIds.has(p.id));
  } else if (wsRole === ROLES.MEMBER) {
    visibleProjects = allProjects.filter(
      (p) => memberProjectIds.has(p.id) || p.network === 2
    );
  }

  if (visibleProjects.length === 0) return c.json([]);
  const projectIds = visibleProjects.map((p) => p.id);

  const userFavorites = await db
    .select({ entityId: workspaceSchema.favorites.entityId })
    .from(workspaceSchema.favorites)
    .where(and(
      eq(workspaceSchema.favorites.userId, user.id),
      eq(workspaceSchema.favorites.workspaceId, workspace.id),
      eq(workspaceSchema.favorites.entityType, "project")
    ));

  const favoriteProjectIds = new Set(userFavorites.map((f) => f.entityId).filter(Boolean));

  const allMembers = await db
    .select({ projectId: projectSchema.projectMembers.projectId, memberId: projectSchema.projectMembers.memberId })
    .from(projectSchema.projectMembers)
    .where(and(inArray(projectSchema.projectMembers.projectId, projectIds), eq(projectSchema.projectMembers.isActive, true)));

  const membersMap = new Map<string, string[]>();
  for (const m of allMembers) {
    const list = membersMap.get(m.projectId) ?? [];
    list.push(m.memberId);
    membersMap.set(m.projectId, list);
  }

  const results = visibleProjects.map((p) =>
    formatProject(p, {
      isFavorite: favoriteProjectIds.has(p.id),
      isMember: memberProjectIds.has(p.id),
      memberRole: memberRoleMap.get(p.id) ?? null,
      members: membersMap.get(p.id) ?? [],
    })
  );

  return c.json(results);
});

// GET /:projectId/ - Get project (retrieve)
app.get("/api/workspaces/:slug/projects/:projectId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");

  const fullProject = await db.query.projects.findFirst({
    where: and(eq(projectSchema.projects.id, projectId), isNull(projectSchema.projects.archivedAt)),
  });

  if (!fullProject) return c.json({ error: "Project does not exist" }, 404);

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectSchema.projectMembers.projectId, projectId),
      eq(projectSchema.projectMembers.memberId, user.id),
      eq(projectSchema.projectMembers.isActive, true)
    ),
  });

  if (!membership) {
    if (fullProject.network === 0) {
      return c.json({ error: "You do not have permission" }, 403);
    } else {
      return c.json({ error: "You are not a member of this project" }, 409);
    }
  }

  return c.json(formatProject(fullProject, {
    isMember: true,
    memberRole: membership.role,
  }));
});

// PATCH /:projectId/ - Update project
app.patch("/api/workspaces/:slug/projects/:projectId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  // Check permissions
  const isWorkspaceAdmin = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceSchema.workspaceMembers.workspaceId, workspace.id),
      eq(workspaceSchema.workspaceMembers.userId, user.id),
      eq(workspaceSchema.workspaceMembers.isActive, true),
      eq(workspaceSchema.workspaceMembers.role, ROLES.ADMIN)
    ),
  });

  const isProjectAdmin = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectSchema.projectMembers.projectId, projectId),
      eq(projectSchema.projectMembers.memberId, user.id),
      eq(projectSchema.projectMembers.role, ROLES.ADMIN),
      eq(projectSchema.projectMembers.isActive, true)
    ),
  });

  if (!isProjectAdmin && !isWorkspaceAdmin) {
    return c.json({ error: "You don't have the required permissions." }, 403);
  }

  const fullProject = await db.query.projects.findFirst({
    where: eq(projectSchema.projects.id, projectId),
  });
  if (fullProject?.archivedAt) {
    return c.json({ error: "Archived projects cannot be updated" }, 400);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.network !== undefined) updateData.network = body.network;
  if (body.logo_props !== undefined) updateData.logoProps = body.logo_props;
  if (body.cycle_view !== undefined) updateData.cycleView = body.cycle_view;
  if (body.inbox_view !== undefined) updateData.intakeView = body.inbox_view;

  await db.update(projectSchema.projects).set(updateData).where(eq(projectSchema.projects.id, projectId));

  const updated = await db.query.projects.findFirst({
    where: eq(projectSchema.projects.id, projectId),
  });

  return c.json(formatProject(updated!));
});

// DELETE /:projectId/ - Delete project
app.delete("/api/workspaces/:slug/projects/:projectId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");

  const isWorkspaceAdmin = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceSchema.workspaceMembers.workspaceId, workspace.id),
      eq(workspaceSchema.workspaceMembers.userId, user.id),
      eq(workspaceSchema.workspaceMembers.isActive, true),
      eq(workspaceSchema.workspaceMembers.role, ROLES.ADMIN)
    ),
  });

  const isProjectAdmin = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectSchema.projectMembers.projectId, projectId),
      eq(projectSchema.projectMembers.memberId, user.id),
      eq(projectSchema.projectMembers.role, ROLES.ADMIN),
      eq(projectSchema.projectMembers.isActive, true)
    ),
  });

  if (!isProjectAdmin && !isWorkspaceAdmin) {
    return c.json({ error: "You don't have the required permissions." }, 403);
  }

  // Delete favorites
  await db.delete(workspaceSchema.favorites).where(and(
    eq(workspaceSchema.favorites.projectId, projectId),
    eq(workspaceSchema.favorites.workspaceId, workspace.id)
  ));

  // Soft delete
  await db.update(projectSchema.projects).set({
    deletedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(projectSchema.projects.id, projectId));

  return new Response(null, { status: 204 });
});

beforeAll(async () => {
  adminUser = { id: createId(), email: "admin@test.com" };
  memberUser = { id: createId(), email: "member@test.com" };
  guestUser = { id: createId(), email: "guest@test.com" };

  await db.insert(userSchema.users).values([
    { id: adminUser.id, email: adminUser.email, name: "Admin" },
    { id: memberUser.id, email: memberUser.email, name: "Member" },
    { id: guestUser.id, email: guestUser.email, name: "Guest" },
  ]);

  workspace = { id: createId(), slug: "test-workspace" };

  await db.insert(workspaceSchema.workspaces).values({
    id: workspace.id, name: "Test Workspace", slug: workspace.slug, ownerId: adminUser.id,
  });

  await db.insert(workspaceSchema.workspaceMembers).values([
    { workspaceId: workspace.id, userId: adminUser.id, role: ROLES.ADMIN, isActive: true },
    { workspaceId: workspace.id, userId: memberUser.id, role: ROLES.MEMBER, isActive: true },
    { workspaceId: workspace.id, userId: guestUser.id, role: ROLES.GUEST, isActive: true },
  ]);
});

describe("GET /api/workspaces/:slug/projects/ (list)", () => {
  let publicProject: { id: string };
  let secretProject: { id: string };

  beforeAll(async () => {
    publicProject = { id: createId() };
    secretProject = { id: createId() };

    await db.insert(projectSchema.projects).values([
      { id: publicProject.id, workspaceId: workspace.id, name: "Public Project", identifier: "PUB", network: 2 },
      { id: secretProject.id, workspaceId: workspace.id, name: "Secret Project", identifier: "SEC", network: 0 },
    ]);

    // Admin is member of both
    await db.insert(projectSchema.projectMembers).values([
      { projectId: publicProject.id, memberId: adminUser.id, role: ROLES.ADMIN, isActive: true },
      { projectId: secretProject.id, memberId: adminUser.id, role: ROLES.ADMIN, isActive: true },
    ]);

    // Member is member of secret only
    await db.insert(projectSchema.projectMembers).values({
      projectId: secretProject.id, memberId: memberUser.id, role: ROLES.MEMBER, isActive: true,
    });

    // Guest is member of secret only
    await db.insert(projectSchema.projectMembers).values({
      projectId: secretProject.id, memberId: guestUser.id, role: ROLES.GUEST, isActive: true,
    });
  });

  test("admin sees all projects", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/`,
      { headers: { "x-test-user-id": adminUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(2);
  });

  test("member sees member projects + public projects", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/`,
      { headers: { "x-test-user-id": memberUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should see public project (network=2) + secret project (is member)
    expect(data.length).toBe(2);
  });

  test("guest only sees projects they are members of", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/`,
      { headers: { "x-test-user-id": guestUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should only see secret project (is member), NOT public project
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(secretProject.id);
  });

  test("list returns minimal fields matching Django's .values()", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/`,
      { headers: { "x-test-user-id": adminUser.id } }
    );
    const data = await res.json();
    const project = data[0];
    // Should have these fields
    expect(project.id).toBeDefined();
    expect(project.name).toBeDefined();
    expect(project.identifier).toBeDefined();
    expect(project.sort_order).toBeDefined();
    expect(project.logo_props).toBeDefined();
    expect(project.member_role).toBeDefined();
    expect(project.workspace).toBeDefined();
    expect(project.cycle_view).toBeDefined();
    expect(project.module_view).toBeDefined();
    expect(project.page_view).toBeDefined();
    expect(project.inbox_view).toBeDefined();
    expect(project.network).toBeDefined();
    // Should NOT have these (detail-only fields)
    expect(project.description).toBeUndefined();
    expect(project.is_favorite).toBeUndefined();
    expect(project.members).toBeUndefined();
  });
});

describe("GET /api/workspaces/:slug/projects/details/ (list_detail)", () => {
  test("returns detailed project info with is_favorite and members", async () => {
    // Add a favorite
    await db.insert(workspaceSchema.favorites).values({
      workspaceId: workspace.id,
      userId: adminUser.id,
      entityType: "project",
      entityId: (await db.query.projects.findFirst({ where: eq(projectSchema.projects.workspaceId, workspace.id) }))!.id,
    });

    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/details/`,
      { headers: { "x-test-user-id": adminUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);

    // Should have detailed fields
    const project = data[0];
    expect(project.is_favorite).toBeDefined();
    expect(project.members).toBeDefined();
    expect(project.description).toBeDefined();
    expect(project.logo_props).toBeDefined();
    expect(project.cycle_view).toBeDefined();
    expect(project.inbox_view).toBeDefined();
    expect(project.archived_at).toBeDefined();
  });
});

describe("GET /api/workspaces/:slug/projects/:projectId/ (retrieve)", () => {
  let testProject: { id: string };
  let secretProjectNoMember: { id: string };
  let publicProjectNoMember: { id: string };
  let archivedProject: { id: string };

  beforeAll(async () => {
    testProject = { id: createId() };
    secretProjectNoMember = { id: createId() };
    publicProjectNoMember = { id: createId() };
    archivedProject = { id: createId() };

    await db.insert(projectSchema.projects).values([
      { id: testProject.id, workspaceId: workspace.id, name: "Retrieve Test", identifier: "RET", network: 2 },
      { id: secretProjectNoMember.id, workspaceId: workspace.id, name: "Secret No Member", identifier: "SNM", network: 0 },
      { id: publicProjectNoMember.id, workspaceId: workspace.id, name: "Public No Member", identifier: "PNM", network: 2 },
      { id: archivedProject.id, workspaceId: workspace.id, name: "Archived", identifier: "ARC", network: 2, archivedAt: new Date() },
    ]);

    await db.insert(projectSchema.projectMembers).values([
      { projectId: testProject.id, memberId: adminUser.id, role: ROLES.ADMIN, isActive: true },
      { projectId: archivedProject.id, memberId: adminUser.id, role: ROLES.ADMIN, isActive: true },
    ]);
  });

  test("returns project details for a member", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${testProject.id}/`,
      { headers: { "x-test-user-id": adminUser.id } }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(testProject.id);
    expect(data.is_member).toBe(true);
    expect(data.member_role).toBe(ROLES.ADMIN);
  });

  test("returns 403 for non-member on secret project", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${secretProjectNoMember.id}/`,
      { headers: { "x-test-user-id": memberUser.id } }
    );
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain("permission");
  });

  test("returns 409 for non-member on public project", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${publicProjectNoMember.id}/`,
      { headers: { "x-test-user-id": memberUser.id } }
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toContain("not a member");
  });

  test("returns 404 for archived project", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${archivedProject.id}/`,
      { headers: { "x-test-user-id": adminUser.id } }
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/workspaces/:slug/projects/:projectId/ (partial_update)", () => {
  let patchProject: { id: string };
  let archivedPatchProject: { id: string };

  beforeAll(async () => {
    patchProject = { id: createId() };
    archivedPatchProject = { id: createId() };

    await db.insert(projectSchema.projects).values([
      { id: patchProject.id, workspaceId: workspace.id, name: "Patch Test", identifier: "PAT", network: 2 },
      { id: archivedPatchProject.id, workspaceId: workspace.id, name: "Archived Patch", identifier: "APT", network: 2, archivedAt: new Date() },
    ]);

    await db.insert(projectSchema.projectMembers).values({
      projectId: patchProject.id, memberId: adminUser.id, role: ROLES.ADMIN, isActive: true,
    });
    await db.insert(projectSchema.projectMembers).values({
      projectId: archivedPatchProject.id, memberId: adminUser.id, role: ROLES.ADMIN, isActive: true,
    });
  });

  test("updates project name", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${patchProject.id}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": adminUser.id },
        body: JSON.stringify({ name: "Updated Name" }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Name");
  });

  test("maps inbox_view to intake_view", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${patchProject.id}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": adminUser.id },
        body: JSON.stringify({ inbox_view: true }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.inbox_view).toBe(true);
  });

  test("returns 400 for archived project", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${archivedPatchProject.id}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": adminUser.id },
        body: JSON.stringify({ name: "Should Fail" }),
      }
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Archived");
  });

  test("returns 403 for non-admin member", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${patchProject.id}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": guestUser.id },
        body: JSON.stringify({ name: "Should Fail" }),
      }
    );
    expect(res.status).toBe(403);
  });

  test("workspace admin can update project", async () => {
    // memberUser is workspace member (role=15), not project admin
    // adminUser is workspace admin (role=20)
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${patchProject.id}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-user-id": adminUser.id },
        body: JSON.stringify({ cycle_view: false }),
      }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cycle_view).toBe(false);
  });
});

describe("DELETE /api/workspaces/:slug/projects/:projectId/ (destroy)", () => {
  let deleteProject: { id: string };

  beforeAll(async () => {
    deleteProject = { id: createId() };

    await db.insert(projectSchema.projects).values({
      id: deleteProject.id, workspaceId: workspace.id, name: "Delete Test", identifier: "DEL", network: 2,
    });

    await db.insert(projectSchema.projectMembers).values({
      projectId: deleteProject.id, memberId: adminUser.id, role: ROLES.ADMIN, isActive: true,
    });

    // Add a favorite for this project
    await db.insert(workspaceSchema.favorites).values({
      workspaceId: workspace.id,
      userId: adminUser.id,
      entityType: "project",
      entityId: deleteProject.id,
      projectId: deleteProject.id,
    });
  });

  test("returns 403 for non-admin", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${deleteProject.id}/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": guestUser.id },
      }
    );
    expect(res.status).toBe(403);
  });

  test("deletes project and cleans up favorites", async () => {
    const res = await app.request(
      `/api/workspaces/${workspace.slug}/projects/${deleteProject.id}/`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": adminUser.id },
      }
    );
    expect(res.status).toBe(204);

    // Check project is soft-deleted
    const project = await db.query.projects.findFirst({
      where: eq(projectSchema.projects.id, deleteProject.id),
    });
    expect(project?.deletedAt).toBeDefined();
    expect(project?.deletedAt).not.toBeNull();

    // Check favorites were cleaned up
    const favs = await db.query.favorites.findMany({
      where: eq(workspaceSchema.favorites.projectId, deleteProject.id),
    });
    expect(favs.length).toBe(0);
  });
});

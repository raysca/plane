import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, desc, inArray, isNull, count } from "drizzle-orm";
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

  CREATE TABLE issues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id TEXT,
    state_id TEXT REFERENCES states(id),
    name TEXT NOT NULL,
    description_html TEXT,
    description_stripped TEXT,
    description_binary TEXT,
    priority INTEGER DEFAULT 0,
    sort_order REAL DEFAULT 65535,
    start_date INTEGER,
    target_date INTEGER,
    completed_at INTEGER,
    archived_at INTEGER,
    sequence_id INTEGER,
    estimate_point INTEGER,
    is_epic INTEGER DEFAULT 0,
    created_by_id TEXT REFERENCES users(id),
    updated_by_id TEXT REFERENCES users(id),
    created_at INTEGER,
    updated_at INTEGER,
    deleted_at INTEGER
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
`);

// Test data
let testUser: { id: string; email: string };
let workspace: { id: string; slug: string };
let project: { id: string };
let stateBacklog: { id: string };
let stateStarted: { id: string };
let stateCompleted: { id: string };
let stateCancelled: { id: string };

// Setup test app replicating the route logic
const app = new Hono();

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  return null;
}

// GET /api/workspaces/:slug/modules/
app.get("/api/workspaces/:slug/modules/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });
  if (!ws) return c.json({ detail: "Not found." }, 404);

  // Fetch all non-archived modules
  const allModules = await db
    .select()
    .from(moduleSchema.modules)
    .where(and(eq(moduleSchema.modules.workspaceId, ws.id), isNull(moduleSchema.modules.archivedAt)))
    .orderBy(desc(moduleSchema.modules.createdAt));

  if (allModules.length === 0) return c.json([]);

  const moduleIds = allModules.map((m) => m.id);

  // Members
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

  // Favorites
  const userFavorites = await db
    .select({ moduleId: moduleSchema.moduleFavorites.moduleId })
    .from(moduleSchema.moduleFavorites)
    .where(and(inArray(moduleSchema.moduleFavorites.moduleId, moduleIds), eq(moduleSchema.moduleFavorites.userId, user.id)));

  const favModuleIds = new Set(userFavorites.map((f) => f.moduleId));

  // Links
  const allLinks = await db.select().from(moduleSchema.moduleLinks).where(inArray(moduleSchema.moduleLinks.moduleId, moduleIds));

  const linksByModule = new Map<string, (typeof allLinks)[number][]>();
  for (const link of allLinks) {
    const existing = linksByModule.get(link.moduleId) || [];
    existing.push(link);
    linksByModule.set(link.moduleId, existing);
  }

  // Issue stats
  const issueStats = await db
    .select({
      moduleId: moduleSchema.moduleIssues.moduleId,
      stateGroup: projectSchema.states.group,
      issueCount: count(),
    })
    .from(moduleSchema.moduleIssues)
    .innerJoin(issueSchema.issues, eq(moduleSchema.moduleIssues.issueId, issueSchema.issues.id))
    .innerJoin(projectSchema.states, eq(issueSchema.issues.stateId, projectSchema.states.id))
    .where(
      and(
        inArray(moduleSchema.moduleIssues.moduleId, moduleIds),
        isNull(issueSchema.issues.archivedAt),
        isNull(issueSchema.issues.deletedAt)
      )
    )
    .groupBy(moduleSchema.moduleIssues.moduleId, projectSchema.states.group);

  const statsMap = new Map<string, Record<string, number>>();
  for (const row of issueStats) {
    const existing = statsMap.get(row.moduleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    const cnt = Number(row.issueCount);
    existing.total += cnt;
    if (row.stateGroup && row.stateGroup in existing) {
      existing[row.stateGroup] += cnt;
    }
    statsMap.set(row.moduleId, existing);
  }

  const result = allModules.map((m) => {
    const stats = statsMap.get(m.id) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    return {
      id: m.id,
      workspace_id: m.workspaceId,
      project_id: m.projectId,
      name: m.name,
      description: m.description ?? "",
      description_text: m.descriptionText ?? null,
      description_html: m.descriptionHtml ?? null,
      start_date: m.startDate?.toISOString().split("T")[0] ?? null,
      target_date: m.targetDate?.toISOString().split("T")[0] ?? null,
      status: m.status ?? "backlog",
      lead_id: m.leadId ?? null,
      member_ids: membersByModule.get(m.id) || [],
      view_props: m.viewProps ?? {},
      sort_order: m.sortOrder ?? 65535,
      is_favorite: favModuleIds.has(m.id),
      total_issues: stats.total,
      completed_issues: stats.completed,
      cancelled_issues: stats.cancelled,
      started_issues: stats.started,
      unstarted_issues: stats.unstarted,
      backlog_issues: stats.backlog,
      created_at: m.createdAt?.toISOString() ?? null,
      updated_at: m.updatedAt?.toISOString() ?? null,
      archived_at: m.archivedAt?.toISOString() ?? null,
      link_module: (linksByModule.get(m.id) || []).map((link) => ({
        id: link.id,
        module_id: link.moduleId,
        title: link.title ?? "",
        url: link.url,
        metadata: link.metadata ?? {},
        created_by_id: link.createdById ?? null,
        created_at: link.createdAt?.toISOString() ?? null,
      })),
    };
  });

  return c.json(result);
});

// Setup test data
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

  // Create states
  stateBacklog = { id: createId() };
  stateStarted = { id: createId() };
  stateCompleted = { id: createId() };
  stateCancelled = { id: createId() };

  await db.insert(projectSchema.states).values([
    { id: stateBacklog.id, projectId: project.id, workspaceId: workspace.id, name: "Backlog", color: "#ccc", group: "backlog" },
    { id: stateStarted.id, projectId: project.id, workspaceId: workspace.id, name: "In Progress", color: "#F59E0B", group: "started" },
    { id: stateCompleted.id, projectId: project.id, workspaceId: workspace.id, name: "Done", color: "#46A758", group: "completed" },
    { id: stateCancelled.id, projectId: project.id, workspaceId: workspace.id, name: "Cancelled", color: "#9AA4BC", group: "cancelled" },
  ]);
});

describe("GET /api/workspaces/:slug/modules/", () => {
  test("returns empty array when no modules exist", async () => {
    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("returns modules with correct fields", async () => {
    const moduleId = createId();
    await db.insert(moduleSchema.modules).values({
      id: moduleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Sprint 1",
      description: "First sprint",
      status: "planned",
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.length).toBe(1);
    const mod = data[0];
    expect(mod.id).toBe(moduleId);
    expect(mod.workspace_id).toBe(workspace.id);
    expect(mod.project_id).toBe(project.id);
    expect(mod.name).toBe("Sprint 1");
    expect(mod.description).toBe("First sprint");
    expect(mod.status).toBe("planned");
    expect(mod.member_ids).toEqual([]);
    expect(mod.is_favorite).toBe(false);
    expect(mod.total_issues).toBe(0);
    expect(mod.completed_issues).toBe(0);
    expect(mod.cancelled_issues).toBe(0);
    expect(mod.started_issues).toBe(0);
    expect(mod.unstarted_issues).toBe(0);
    expect(mod.backlog_issues).toBe(0);
    expect(mod.link_module).toEqual([]);
    expect(mod.archived_at).toBeNull();
  });

  test("excludes archived modules", async () => {
    const archivedId = createId();
    await db.insert(moduleSchema.modules).values({
      id: archivedId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Archived Module",
      archivedAt: new Date(),
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const archivedModule = data.find((m: any) => m.id === archivedId);
    expect(archivedModule).toBeUndefined();
  });

  test("includes member_ids for modules", async () => {
    const moduleId = createId();
    await db.insert(moduleSchema.modules).values({
      id: moduleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Module with Members",
    });

    await db.insert(moduleSchema.moduleMembers).values({
      moduleId,
      memberId: testUser.id,
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const mod = data.find((m: any) => m.id === moduleId);
    expect(mod).toBeDefined();
    expect(mod.member_ids).toContain(testUser.id);
  });

  test("marks favorited modules correctly", async () => {
    const moduleId = createId();
    await db.insert(moduleSchema.modules).values({
      id: moduleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Favorited Module",
    });

    await db.insert(moduleSchema.moduleFavorites).values({
      moduleId,
      userId: testUser.id,
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const mod = data.find((m: any) => m.id === moduleId);
    expect(mod).toBeDefined();
    expect(mod.is_favorite).toBe(true);
  });

  test("includes module links", async () => {
    const moduleId = createId();
    await db.insert(moduleSchema.modules).values({
      id: moduleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Module with Links",
    });

    const linkId = createId();
    await db.insert(moduleSchema.moduleLinks).values({
      id: linkId,
      moduleId,
      title: "Design Doc",
      url: "https://example.com/doc",
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const mod = data.find((m: any) => m.id === moduleId);
    expect(mod).toBeDefined();
    expect(mod.link_module.length).toBe(1);
    expect(mod.link_module[0].id).toBe(linkId);
    expect(mod.link_module[0].title).toBe("Design Doc");
    expect(mod.link_module[0].url).toBe("https://example.com/doc");
  });

  test("computes issue statistics by state group", async () => {
    const moduleId = createId();
    await db.insert(moduleSchema.modules).values({
      id: moduleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Module with Issues",
    });

    // Create issues in different state groups
    const issueIds = {
      backlog1: createId(),
      backlog2: createId(),
      started1: createId(),
      completed1: createId(),
      completed2: createId(),
      completed3: createId(),
      cancelled1: createId(),
    };

    await db.insert(issueSchema.issues).values([
      { id: issueIds.backlog1, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "Backlog 1" },
      { id: issueIds.backlog2, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "Backlog 2" },
      { id: issueIds.started1, projectId: project.id, workspaceId: workspace.id, stateId: stateStarted.id, name: "Started 1" },
      { id: issueIds.completed1, projectId: project.id, workspaceId: workspace.id, stateId: stateCompleted.id, name: "Completed 1" },
      { id: issueIds.completed2, projectId: project.id, workspaceId: workspace.id, stateId: stateCompleted.id, name: "Completed 2" },
      { id: issueIds.completed3, projectId: project.id, workspaceId: workspace.id, stateId: stateCompleted.id, name: "Completed 3" },
      { id: issueIds.cancelled1, projectId: project.id, workspaceId: workspace.id, stateId: stateCancelled.id, name: "Cancelled 1" },
    ]);

    // Link issues to module
    await db.insert(moduleSchema.moduleIssues).values(
      Object.values(issueIds).map((issueId) => ({
        moduleId,
        issueId,
      }))
    );

    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const mod = data.find((m: any) => m.id === moduleId);
    expect(mod).toBeDefined();
    expect(mod.total_issues).toBe(7);
    expect(mod.backlog_issues).toBe(2);
    expect(mod.started_issues).toBe(1);
    expect(mod.completed_issues).toBe(3);
    expect(mod.cancelled_issues).toBe(1);
    expect(mod.unstarted_issues).toBe(0);
  });

  test("excludes archived and deleted issues from statistics", async () => {
    const moduleId = createId();
    await db.insert(moduleSchema.modules).values({
      id: moduleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Module with Archived Issues",
    });

    const activeIssueId = createId();
    const archivedIssueId = createId();
    const deletedIssueId = createId();

    await db.insert(issueSchema.issues).values([
      { id: activeIssueId, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "Active" },
      { id: archivedIssueId, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "Archived", archivedAt: new Date() },
      { id: deletedIssueId, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "Deleted", deletedAt: new Date() },
    ]);

    await db.insert(moduleSchema.moduleIssues).values([
      { moduleId, issueId: activeIssueId },
      { moduleId, issueId: archivedIssueId },
      { moduleId, issueId: deletedIssueId },
    ]);

    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const mod = data.find((m: any) => m.id === moduleId);
    expect(mod).toBeDefined();
    // Only the active issue should be counted
    expect(mod.total_issues).toBe(1);
    expect(mod.backlog_issues).toBe(1);
  });

  test("returns 401 without authentication", async () => {
    const res = await app.request(`/api/workspaces/${workspace.slug}/modules/`);
    expect(res.status).toBe(401);
  });

  test("returns 404 for non-existent workspace", async () => {
    const res = await app.request("/api/workspaces/nonexistent/modules/", {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(404);
  });
});

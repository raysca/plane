import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, desc, inArray, isNull, count, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../../db/schema/user";
import * as workspaceSchema from "../../db/schema/workspace";
import * as projectSchema from "../../db/schema/project";
import * as cycleSchema from "../../db/schema/cycle";
import * as issueSchema from "../../db/schema/issue";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: {
    ...userSchema,
    ...workspaceSchema,
    ...projectSchema,
    ...cycleSchema,
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

  CREATE TABLE cycles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    start_date INTEGER,
    end_date INTEGER,
    owned_by_id TEXT REFERENCES users(id),
    sort_order REAL DEFAULT 65535,
    view_props TEXT,
    progress_snapshot TEXT,
    is_active INTEGER DEFAULT 0,
    archived_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE cycle_issues (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(cycle_id, issue_id)
  );

  CREATE TABLE cycle_favorites (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(cycle_id, user_id)
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

// Setup test app replicating route logic
const app = new Hono();

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  return null;
}

function getCycleStatus(startDate: Date | null, endDate: Date | null): string {
  if (!startDate || !endDate) return "draft";
  const now = new Date();
  if (endDate < now) return "completed";
  if (startDate <= now && endDate >= now) return "current";
  return "upcoming";
}

async function buildCycleResponse(cycleRows: any[], userId: string) {
  if (cycleRows.length === 0) return [];

  const cycleIds = cycleRows.map((c) => c.id);

  const userFavorites = await db
    .select({ cycleId: cycleSchema.cycleFavorites.cycleId })
    .from(cycleSchema.cycleFavorites)
    .where(and(inArray(cycleSchema.cycleFavorites.cycleId, cycleIds), eq(cycleSchema.cycleFavorites.userId, userId)));

  const favCycleIds = new Set(userFavorites.map((f) => f.cycleId));

  const issueStats = await db
    .select({
      cycleId: cycleSchema.cycleIssues.cycleId,
      stateGroup: projectSchema.states.group,
      issueCount: count(),
    })
    .from(cycleSchema.cycleIssues)
    .innerJoin(issueSchema.issues, eq(cycleSchema.cycleIssues.issueId, issueSchema.issues.id))
    .innerJoin(projectSchema.states, eq(issueSchema.issues.stateId, projectSchema.states.id))
    .where(
      and(
        inArray(cycleSchema.cycleIssues.cycleId, cycleIds),
        isNull(issueSchema.issues.archivedAt),
        isNull(issueSchema.issues.deletedAt)
      )
    )
    .groupBy(cycleSchema.cycleIssues.cycleId, projectSchema.states.group);

  const statsMap = new Map<string, Record<string, number>>();
  for (const row of issueStats) {
    const existing = statsMap.get(row.cycleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    const cnt = Number(row.issueCount);
    existing.total += cnt;
    if (row.stateGroup && row.stateGroup in existing) {
      existing[row.stateGroup] += cnt;
    }
    statsMap.set(row.cycleId, existing);
  }

  return cycleRows.map((cy) => {
    const stats = statsMap.get(cy.id) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    return {
      id: cy.id,
      workspace_id: cy.workspaceId,
      project_id: cy.projectId,
      name: cy.name,
      description: cy.description ?? "",
      start_date: cy.startDate?.toISOString().split("T")[0] ?? null,
      end_date: cy.endDate?.toISOString().split("T")[0] ?? null,
      owned_by_id: cy.ownedById ?? null,
      view_props: cy.viewProps ?? {},
      sort_order: cy.sortOrder ?? 65535,
      progress_snapshot: cy.progressSnapshot ?? {},
      is_favorite: favCycleIds.has(cy.id),
      status: getCycleStatus(cy.startDate, cy.endDate),
      total_issues: stats.total,
      completed_issues: stats.completed,
      cancelled_issues: stats.cancelled,
      started_issues: stats.started,
      unstarted_issues: stats.unstarted,
      backlog_issues: stats.backlog,
      created_at: cy.createdAt?.toISOString() ?? null,
      updated_at: cy.updatedAt?.toISOString() ?? null,
      archived_at: cy.archivedAt?.toISOString() ?? null,
    };
  });
}

// GET /api/workspaces/:slug/cycles/
app.get("/api/workspaces/:slug/cycles/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });
  if (!ws) return c.json({ detail: "Not found." }, 404);

  const allCycles = await db
    .select()
    .from(cycleSchema.cycles)
    .where(and(eq(cycleSchema.cycles.workspaceId, ws.id), isNull(cycleSchema.cycles.archivedAt)))
    .orderBy(desc(cycleSchema.cycles.createdAt));

  if (allCycles.length === 0) return c.json([]);

  const result = await buildCycleResponse(allCycles, user.id);
  return c.json(result);
});

// GET /api/workspaces/:slug/active-cycles/
app.get("/api/workspaces/:slug/active-cycles/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const slug = c.req.param("slug");
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });
  if (!ws) return c.json({ detail: "Not found." }, 404);

  const perPage = parseInt(c.req.query("per_page") || "10", 10);
  const now = new Date();

  const activeCycles = await db
    .select()
    .from(cycleSchema.cycles)
    .where(
      and(
        eq(cycleSchema.cycles.workspaceId, ws.id),
        isNull(cycleSchema.cycles.archivedAt),
        sql`${cycleSchema.cycles.startDate} IS NOT NULL`,
        sql`${cycleSchema.cycles.endDate} IS NOT NULL`,
        sql`${cycleSchema.cycles.startDate} <= ${Math.floor(now.getTime() / 1000)}`,
        sql`${cycleSchema.cycles.endDate} >= ${Math.floor(now.getTime() / 1000)}`
      )
    )
    .orderBy(desc(cycleSchema.cycles.createdAt));

  const results = activeCycles.length > 0 ? await buildCycleResponse(activeCycles.slice(0, perPage), user.id) : [];

  return c.json({
    count: activeCycles.length,
    extra_stats: null,
    next_cursor: `${perPage}:0`,
    next_page_results: activeCycles.length > perPage,
    prev_cursor: "0:0",
    results,
    total_pages: Math.ceil(activeCycles.length / perPage),
  });
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

describe("GET /api/workspaces/:slug/cycles/", () => {
  test("returns empty array when no cycles exist", async () => {
    const res = await app.request(`/api/workspaces/${workspace.slug}/cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("returns cycles with correct fields", async () => {
    const cycleId = createId();
    await db.insert(cycleSchema.cycles).values({
      id: cycleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Sprint 1",
      description: "First sprint",
      ownedById: testUser.id,
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.length).toBeGreaterThanOrEqual(1);
    const cy = data.find((c: any) => c.id === cycleId);
    expect(cy).toBeDefined();
    expect(cy.workspace_id).toBe(workspace.id);
    expect(cy.project_id).toBe(project.id);
    expect(cy.name).toBe("Sprint 1");
    expect(cy.description).toBe("First sprint");
    expect(cy.owned_by_id).toBe(testUser.id);
    expect(cy.status).toBe("draft"); // no dates = draft
    expect(cy.is_favorite).toBe(false);
    expect(cy.total_issues).toBe(0);
  });

  test("excludes archived cycles", async () => {
    const archivedId = createId();
    await db.insert(cycleSchema.cycles).values({
      id: archivedId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Archived Cycle",
      archivedAt: new Date(),
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const archived = data.find((c: any) => c.id === archivedId);
    expect(archived).toBeUndefined();
  });

  test("marks favorited cycles correctly", async () => {
    const cycleId = createId();
    await db.insert(cycleSchema.cycles).values({
      id: cycleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Fav Cycle",
    });

    await db.insert(cycleSchema.cycleFavorites).values({
      cycleId,
      userId: testUser.id,
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const cy = data.find((c: any) => c.id === cycleId);
    expect(cy).toBeDefined();
    expect(cy.is_favorite).toBe(true);
  });

  test("computes issue statistics by state group", async () => {
    const cycleId = createId();
    await db.insert(cycleSchema.cycles).values({
      id: cycleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Cycle with Issues",
    });

    const issueIds = {
      backlog1: createId(),
      started1: createId(),
      started2: createId(),
      completed1: createId(),
      cancelled1: createId(),
    };

    await db.insert(issueSchema.issues).values([
      { id: issueIds.backlog1, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "B1" },
      { id: issueIds.started1, projectId: project.id, workspaceId: workspace.id, stateId: stateStarted.id, name: "S1" },
      { id: issueIds.started2, projectId: project.id, workspaceId: workspace.id, stateId: stateStarted.id, name: "S2" },
      { id: issueIds.completed1, projectId: project.id, workspaceId: workspace.id, stateId: stateCompleted.id, name: "C1" },
      { id: issueIds.cancelled1, projectId: project.id, workspaceId: workspace.id, stateId: stateCancelled.id, name: "X1" },
    ]);

    await db.insert(cycleSchema.cycleIssues).values(
      Object.values(issueIds).map((issueId) => ({ cycleId, issueId }))
    );

    const res = await app.request(`/api/workspaces/${workspace.slug}/cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const cy = data.find((c: any) => c.id === cycleId);
    expect(cy).toBeDefined();
    expect(cy.total_issues).toBe(5);
    expect(cy.backlog_issues).toBe(1);
    expect(cy.started_issues).toBe(2);
    expect(cy.completed_issues).toBe(1);
    expect(cy.cancelled_issues).toBe(1);
    expect(cy.unstarted_issues).toBe(0);
  });

  test("excludes archived/deleted issues from stats", async () => {
    const cycleId = createId();
    await db.insert(cycleSchema.cycles).values({
      id: cycleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Cycle Archived Issues",
    });

    const activeId = createId();
    const archivedId = createId();
    const deletedId = createId();

    await db.insert(issueSchema.issues).values([
      { id: activeId, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "Active" },
      { id: archivedId, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "Archived", archivedAt: new Date() },
      { id: deletedId, projectId: project.id, workspaceId: workspace.id, stateId: stateBacklog.id, name: "Deleted", deletedAt: new Date() },
    ]);

    await db.insert(cycleSchema.cycleIssues).values([
      { cycleId, issueId: activeId },
      { cycleId, issueId: archivedId },
      { cycleId, issueId: deletedId },
    ]);

    const res = await app.request(`/api/workspaces/${workspace.slug}/cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const cy = data.find((c: any) => c.id === cycleId);
    expect(cy).toBeDefined();
    expect(cy.total_issues).toBe(1);
  });

  test("computes cycle status based on dates", async () => {
    const now = new Date();
    const pastStart = new Date(now.getTime() - 14 * 86400000);
    const pastEnd = new Date(now.getTime() - 1 * 86400000);
    const futureStart = new Date(now.getTime() + 7 * 86400000);
    const futureEnd = new Date(now.getTime() + 21 * 86400000);
    const currentStart = new Date(now.getTime() - 3 * 86400000);
    const currentEnd = new Date(now.getTime() + 4 * 86400000);

    const draftId = createId();
    const completedId = createId();
    const upcomingId = createId();
    const currentId = createId();

    await db.insert(cycleSchema.cycles).values([
      { id: draftId, projectId: project.id, workspaceId: workspace.id, name: "Draft" },
      { id: completedId, projectId: project.id, workspaceId: workspace.id, name: "Completed", startDate: pastStart, endDate: pastEnd },
      { id: upcomingId, projectId: project.id, workspaceId: workspace.id, name: "Upcoming", startDate: futureStart, endDate: futureEnd },
      { id: currentId, projectId: project.id, workspaceId: workspace.id, name: "Current", startDate: currentStart, endDate: currentEnd },
    ]);

    const res = await app.request(`/api/workspaces/${workspace.slug}/cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.find((c: any) => c.id === draftId)?.status).toBe("draft");
    expect(data.find((c: any) => c.id === completedId)?.status).toBe("completed");
    expect(data.find((c: any) => c.id === upcomingId)?.status).toBe("upcoming");
    expect(data.find((c: any) => c.id === currentId)?.status).toBe("current");
  });

  test("returns 401 without authentication", async () => {
    const res = await app.request(`/api/workspaces/${workspace.slug}/cycles/`);
    expect(res.status).toBe(401);
  });

  test("returns 404 for non-existent workspace", async () => {
    const res = await app.request("/api/workspaces/nonexistent/cycles/", {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/workspaces/:slug/active-cycles/", () => {
  test("returns paginated response for active cycles", async () => {
    const res = await app.request(`/api/workspaces/${workspace.slug}/active-cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.count).toBeDefined();
    expect(data.results).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.next_cursor).toBeDefined();
    expect(data.next_page_results).toBeDefined();
    expect(data.prev_cursor).toBeDefined();
    expect(data.total_pages).toBeDefined();
  });

  test("only returns current cycles (within date range)", async () => {
    const now = new Date();
    const currentStart = new Date(now.getTime() - 2 * 86400000);
    const currentEnd = new Date(now.getTime() + 5 * 86400000);

    const activeCycleId = createId();
    await db.insert(cycleSchema.cycles).values({
      id: activeCycleId,
      projectId: project.id,
      workspaceId: workspace.id,
      name: "Active Now",
      startDate: currentStart,
      endDate: currentEnd,
    });

    const res = await app.request(`/api/workspaces/${workspace.slug}/active-cycles/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const found = data.results.find((c: any) => c.id === activeCycleId);
    expect(found).toBeDefined();
    expect(found.status).toBe("current");
  });

  test("returns 401 without authentication", async () => {
    const res = await app.request(`/api/workspaces/${workspace.slug}/active-cycles/`);
    expect(res.status).toBe(401);
  });
});

import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, isNull, isNotNull, inArray, desc, asc, lte, gte, ne, lt, count as countFn, max } from "drizzle-orm";
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
    color TEXT NOT NULL,
    "group" TEXT NOT NULL,
    description TEXT,
    sequence REAL DEFAULT 65535,
    is_default INTEGER DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
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

  CREATE TABLE issue_assignees (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    assignee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(issue_id, assignee_id)
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

let testUser: { id: string; email: string };
let otherUser: { id: string; email: string };
let workspace: { id: string; slug: string };
let project: { id: string };
let backlogState: { id: string };
let startedState: { id: string };
let completedState: { id: string };

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  if (userId === otherUser?.id) return otherUser;
  return null;
}

function computeCycleStatus(startDate: Date | null, endDate: Date | null): string {
  const now = new Date();
  if (!startDate && !endDate) return "DRAFT";
  if (startDate && endDate) {
    if (startDate <= now && endDate >= now) return "CURRENT";
    if (startDate > now) return "UPCOMING";
    if (endDate < now) return "COMPLETED";
  }
  return "DRAFT";
}

function formatCycle(
  cy: any,
  stats: any,
  isFavorite: boolean,
  assigneeIds: string[],
  extra: Record<string, any> = {}
) {
  return {
    id: cy.id,
    workspace_id: cy.workspaceId,
    project_id: cy.projectId,
    name: cy.name,
    description: cy.description ?? "",
    start_date: cy.startDate?.toISOString() ?? null,
    end_date: cy.endDate?.toISOString() ?? null,
    owned_by_id: cy.ownedById ?? null,
    view_props: cy.viewProps ?? {},
    sort_order: cy.sortOrder ?? 65535,
    progress_snapshot: cy.progressSnapshot ?? null,
    is_favorite: isFavorite,
    total_issues: stats.total,
    completed_issues: stats.completed,
    cancelled_issues: stats.cancelled,
    started_issues: stats.started ?? 0,
    unstarted_issues: stats.unstarted ?? 0,
    backlog_issues: stats.backlog ?? 0,
    assignee_ids: assigneeIds,
    status: computeCycleStatus(cy.startDate, cy.endDate),
    archived_at: cy.archivedAt?.toISOString() ?? null,
    created_at: cy.createdAt?.toISOString() ?? null,
    updated_at: cy.updatedAt?.toISOString() ?? null,
    ...extra,
  };
}

const app = new Hono();
const base = "/api/workspaces/:slug/projects/:projectId";

// ---- LIST ----
app.get(`${base}/cycles/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const projectId = c.req.param("projectId");
  const cycleView = c.req.query("cycle_view") || "all";

  let allCycles = await db.select().from(cycleSchema.cycles)
    .where(and(eq(cycleSchema.cycles.projectId, projectId), isNull(cycleSchema.cycles.archivedAt)))
    .orderBy(desc(cycleSchema.cycles.createdAt));

  if (cycleView === "current") {
    const now = new Date();
    allCycles = allCycles.filter(
      (cy) => cy.startDate && cy.endDate && cy.startDate <= now && cy.endDate >= now
    );
  }

  if (allCycles.length === 0) return c.json([]);
  const cycleIds = allCycles.map((cy) => cy.id);

  // Stats
  const issueStats = await db
    .select({ cycleId: cycleSchema.cycleIssues.cycleId, stateGroup: projectSchema.states.group, cnt: countFn() })
    .from(cycleSchema.cycleIssues)
    .innerJoin(issueSchema.issues, eq(cycleSchema.cycleIssues.issueId, issueSchema.issues.id))
    .innerJoin(projectSchema.states, eq(issueSchema.issues.stateId, projectSchema.states.id))
    .where(and(inArray(cycleSchema.cycleIssues.cycleId, cycleIds), isNull(issueSchema.issues.archivedAt), isNull(issueSchema.issues.deletedAt)))
    .groupBy(cycleSchema.cycleIssues.cycleId, projectSchema.states.group);

  const statsMap = new Map<string, any>();
  for (const row of issueStats) {
    const e = statsMap.get(row.cycleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    const cnt = Number(row.cnt);
    e.total += cnt;
    if (row.stateGroup === "completed") e.completed += cnt;
    else if (row.stateGroup === "cancelled") e.cancelled += cnt;
    else if (row.stateGroup === "started") e.started += cnt;
    else if (row.stateGroup === "unstarted") e.unstarted += cnt;
    else if (row.stateGroup === "backlog") e.backlog += cnt;
    statsMap.set(row.cycleId, e);
  }

  // Assignees
  const assigneeRows = await db
    .select({ cycleId: cycleSchema.cycleIssues.cycleId, assigneeId: issueSchema.issueAssignees.assigneeId })
    .from(cycleSchema.cycleIssues)
    .innerJoin(issueSchema.issues, eq(cycleSchema.cycleIssues.issueId, issueSchema.issues.id))
    .innerJoin(issueSchema.issueAssignees, eq(issueSchema.issues.id, issueSchema.issueAssignees.issueId))
    .where(and(inArray(cycleSchema.cycleIssues.cycleId, cycleIds), isNull(issueSchema.issues.archivedAt), isNull(issueSchema.issues.deletedAt)));

  const assigneeMap = new Map<string, Set<string>>();
  for (const r of assigneeRows) {
    if (!assigneeMap.has(r.cycleId)) assigneeMap.set(r.cycleId, new Set());
    assigneeMap.get(r.cycleId)!.add(r.assigneeId);
  }

  // Favorites
  const favs = await db.select({ cycleId: cycleSchema.cycleFavorites.cycleId }).from(cycleSchema.cycleFavorites)
    .where(and(inArray(cycleSchema.cycleFavorites.cycleId, cycleIds), eq(cycleSchema.cycleFavorites.userId, user.id)));
  const favSet = new Set(favs.map((f) => f.cycleId));

  const result = allCycles.map((cy) => {
    const stats = statsMap.get(cy.id) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    const aIds = assigneeMap.has(cy.id) ? Array.from(assigneeMap.get(cy.id)!) : [];
    return formatCycle(cy, stats, favSet.has(cy.id), aIds);
  });

  result.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return 0;
  });

  return c.json(result);
});

// ---- CREATE ----
app.post(`${base}/cycles/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  const hasStart = body.start_date !== null && body.start_date !== undefined && body.start_date !== "";
  const hasEnd = body.end_date !== null && body.end_date !== undefined && body.end_date !== "";
  if (hasStart !== hasEnd) {
    return c.json({ error: "Both start date and end date are either required or are to be null" }, 400);
  }

  let startDate: Date | null = null;
  let endDate: Date | null = null;
  if (hasStart && hasEnd) {
    startDate = new Date(body.start_date);
    endDate = new Date(body.end_date);
    if (startDate > endDate) {
      return c.json({ error: "Start date cannot exceed end date" }, 400);
    }
  }

  const maxResult = await db.select({ largest: max(cycleSchema.cycles.sortOrder) }).from(cycleSchema.cycles).where(eq(cycleSchema.cycles.projectId, projectId));
  const sortOrder = body.sort_order ?? (maxResult[0]?.largest != null ? maxResult[0].largest + 10000 : 65535);

  const [created] = await db.insert(cycleSchema.cycles).values({
    projectId,
    workspaceId: workspace.id,
    name: body.name,
    description: body.description ?? null,
    startDate,
    endDate,
    ownedById: body.owned_by_id || user.id,
    sortOrder,
  }).returning();

  const emptyStats = { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
  return c.json(formatCycle(created, emptyStats, false, []), 201);
});

// ---- RETRIEVE ----
app.get(`${base}/cycles/:cycleId/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const projectId = c.req.param("projectId");
  const cycleId = c.req.param("cycleId");

  if (cycleId === "date-check") return c.notFound();

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycleSchema.cycles.id, cycleId), eq(cycleSchema.cycles.projectId, projectId), isNull(cycleSchema.cycles.archivedAt)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  // Stats
  const issueStats = await db
    .select({ stateGroup: projectSchema.states.group, cnt: countFn() })
    .from(cycleSchema.cycleIssues)
    .innerJoin(issueSchema.issues, eq(cycleSchema.cycleIssues.issueId, issueSchema.issues.id))
    .innerJoin(projectSchema.states, eq(issueSchema.issues.stateId, projectSchema.states.id))
    .where(and(eq(cycleSchema.cycleIssues.cycleId, cycleId), isNull(issueSchema.issues.archivedAt), isNull(issueSchema.issues.deletedAt)))
    .groupBy(projectSchema.states.group);

  const stats = { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
  for (const row of issueStats) {
    const cnt = Number(row.cnt);
    stats.total += cnt;
    if (row.stateGroup === "completed") stats.completed += cnt;
    else if (row.stateGroup === "cancelled") stats.cancelled += cnt;
    else if (row.stateGroup === "started") stats.started += cnt;
    else if (row.stateGroup === "unstarted") stats.unstarted += cnt;
    else if (row.stateGroup === "backlog") stats.backlog += cnt;
  }

  const favs = await db.select({ cycleId: cycleSchema.cycleFavorites.cycleId }).from(cycleSchema.cycleFavorites)
    .where(and(eq(cycleSchema.cycleFavorites.cycleId, cycleId), eq(cycleSchema.cycleFavorites.userId, user.id)));

  // Sub-issues
  const subResult = await db.select({ count: countFn() })
    .from(cycleSchema.cycleIssues)
    .innerJoin(issueSchema.issues, eq(cycleSchema.cycleIssues.issueId, issueSchema.issues.id))
    .where(and(eq(cycleSchema.cycleIssues.cycleId, cycleId), isNotNull(issueSchema.issues.parentId), isNull(issueSchema.issues.archivedAt), isNull(issueSchema.issues.deletedAt)));

  return c.json(formatCycle(cycle, stats, favs.length > 0, [], { sub_issues: Number(subResult[0]?.count ?? 0) }));
});

// ---- PATCH ----
app.patch(`${base}/cycles/:cycleId/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const cycleId = c.req.param("cycleId");

  const cycle = await db.query.cycles.findFirst({
    where: eq(cycleSchema.cycles.id, cycleId),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  if (cycle.archivedAt) return c.json({ error: "Archived cycle cannot be updated" }, 400);

  const body = await c.req.json();

  if (cycle.endDate && cycle.endDate < new Date()) {
    if (body.sort_order !== undefined) {
      await db.update(cycleSchema.cycles).set({ sortOrder: body.sort_order, updatedAt: new Date() }).where(eq(cycleSchema.cycles.id, cycleId));
    } else {
      return c.json({ error: "The Cycle has already been completed so it cannot be edited" }, 400);
    }
  } else {
    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.owned_by_id !== undefined) updateData.ownedById = body.owned_by_id;
    if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

    if (body.start_date !== undefined || body.end_date !== undefined) {
      const newStartStr = body.start_date !== undefined ? body.start_date : (cycle.startDate?.toISOString() ?? null);
      const newEndStr = body.end_date !== undefined ? body.end_date : (cycle.endDate?.toISOString() ?? null);
      const hasStart = newStartStr !== null && newStartStr !== "";
      const hasEnd = newEndStr !== null && newEndStr !== "";
      if (hasStart !== hasEnd) return c.json({ error: "Both start date and end date are either required or are to be null" }, 400);
      if (hasStart && hasEnd) {
        const sd = new Date(newStartStr!);
        const ed = new Date(newEndStr!);
        if (sd > ed) return c.json({ error: "Start date cannot exceed end date" }, 400);
        updateData.startDate = sd;
        updateData.endDate = ed;
      } else {
        updateData.startDate = null;
        updateData.endDate = null;
      }
    }

    await db.update(cycleSchema.cycles).set(updateData).where(eq(cycleSchema.cycles.id, cycleId));
  }

  const updated = await db.query.cycles.findFirst({ where: eq(cycleSchema.cycles.id, cycleId) });
  const emptyStats = { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
  return c.json(formatCycle(updated!, emptyStats, false, []));
});

// ---- DELETE ----
app.delete(`${base}/cycles/:cycleId/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const cycleId = c.req.param("cycleId");

  const cycle = await db.query.cycles.findFirst({ where: eq(cycleSchema.cycles.id, cycleId) });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  await db.delete(cycleSchema.cycles).where(eq(cycleSchema.cycles.id, cycleId));
  return c.body(null, 204);
});

// ---- DATE CHECK ----
app.post(`${base}/cycles/date-check/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  const startDate = new Date(body.start_date);
  const endDate = new Date(body.end_date);

  let conditions = [
    eq(cycleSchema.cycles.projectId, projectId),
    lte(cycleSchema.cycles.startDate, endDate),
    gte(cycleSchema.cycles.endDate, startDate),
  ];

  let overlapping;
  if (body.cycle_id) {
    overlapping = await db.select({ id: cycleSchema.cycles.id }).from(cycleSchema.cycles)
      .where(and(...conditions, ne(cycleSchema.cycles.id, body.cycle_id))).limit(1);
  } else {
    overlapping = await db.select({ id: cycleSchema.cycles.id }).from(cycleSchema.cycles)
      .where(and(...conditions)).limit(1);
  }

  if (overlapping.length > 0) {
    return c.json({
      error: "You have a cycle already on the given dates, if you want to create a draft cycle you can do that by removing dates",
      status: false,
    });
  }
  return c.json({ status: true });
});

// ---- FAVORITES ----
app.post(`${base}/user-favorite-cycles/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const body = await c.req.json();
  await db.insert(cycleSchema.cycleFavorites).values({ cycleId: body.cycle, userId: user.id });
  return c.body(null, 204);
});

app.delete(`${base}/user-favorite-cycles/:cycleId/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const cycleId = c.req.param("cycleId");
  await db.delete(cycleSchema.cycleFavorites).where(and(eq(cycleSchema.cycleFavorites.cycleId, cycleId), eq(cycleSchema.cycleFavorites.userId, user.id)));
  return c.body(null, 204);
});

// ---- ARCHIVED CYCLES ----
app.get(`${base}/archived-cycles/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const projectId = c.req.param("projectId");
  const allCycles = await db.select().from(cycleSchema.cycles)
    .where(and(eq(cycleSchema.cycles.projectId, projectId), isNotNull(cycleSchema.cycles.archivedAt)))
    .orderBy(desc(cycleSchema.cycles.createdAt));

  return c.json(allCycles.map((cy) => formatCycle(cy, { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 }, false, [])));
});

app.post(`${base}/cycles/:cycleId/archive/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const cycleId = c.req.param("cycleId");
  const cycle = await db.query.cycles.findFirst({ where: eq(cycleSchema.cycles.id, cycleId) });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);
  if (!cycle.endDate || cycle.endDate >= new Date()) {
    return c.json({ error: "Only completed cycles can be archived" }, 400);
  }
  const now = new Date();
  await db.update(cycleSchema.cycles).set({ archivedAt: now }).where(eq(cycleSchema.cycles.id, cycleId));
  await db.delete(cycleSchema.cycleFavorites).where(eq(cycleSchema.cycleFavorites.cycleId, cycleId));
  return c.json({ archived_at: now.toISOString() });
});

app.delete(`${base}/cycles/:cycleId/archive/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const cycleId = c.req.param("cycleId");
  await db.update(cycleSchema.cycles).set({ archivedAt: null }).where(eq(cycleSchema.cycles.id, cycleId));
  return c.body(null, 204);
});

// ---- TRANSFER ISSUES ----
app.post(`${base}/cycles/:cycleId/transfer-issues/`, async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const projectId = c.req.param("projectId");
  const cycleId = c.req.param("cycleId");
  const body = await c.req.json();

  const sourceCycle = await db.query.cycles.findFirst({
    where: and(eq(cycleSchema.cycles.id, cycleId), eq(cycleSchema.cycles.projectId, projectId)),
  });
  if (!sourceCycle) return c.json({ error: "Cycle not found" }, 404);
  if (!sourceCycle.endDate || sourceCycle.endDate >= new Date()) {
    return c.json({ error: "Only completed cycles can transfer issues" }, 400);
  }

  const destCycle = await db.query.cycles.findFirst({
    where: and(eq(cycleSchema.cycles.id, body.new_cycle_id), eq(cycleSchema.cycles.projectId, projectId)),
  });
  if (!destCycle) return c.json({ error: "New cycle not found" }, 404);
  if (destCycle.endDate && destCycle.endDate < new Date()) {
    return c.json({ error: "Cannot transfer issues to a completed cycle" }, 400);
  }

  const sourceIssueRows = await db
    .select({ cycleIssueId: cycleSchema.cycleIssues.id, issueId: cycleSchema.cycleIssues.issueId, stateGroup: projectSchema.states.group })
    .from(cycleSchema.cycleIssues)
    .innerJoin(issueSchema.issues, eq(cycleSchema.cycleIssues.issueId, issueSchema.issues.id))
    .innerJoin(projectSchema.states, eq(issueSchema.issues.stateId, projectSchema.states.id))
    .where(and(eq(cycleSchema.cycleIssues.cycleId, cycleId), isNull(issueSchema.issues.archivedAt), isNull(issueSchema.issues.deletedAt)));

  const snapshot: Record<string, number> = {
    total_issues: sourceIssueRows.length, completed_issues: 0, cancelled_issues: 0,
    started_issues: 0, unstarted_issues: 0, backlog_issues: 0,
  };
  for (const row of sourceIssueRows) {
    if (row.stateGroup === "completed") snapshot.completed_issues++;
    else if (row.stateGroup === "cancelled") snapshot.cancelled_issues++;
    else if (row.stateGroup === "started") snapshot.started_issues++;
    else if (row.stateGroup === "unstarted") snapshot.unstarted_issues++;
    else if (row.stateGroup === "backlog") snapshot.backlog_issues++;
  }

  await db.update(cycleSchema.cycles).set({ progressSnapshot: snapshot }).where(eq(cycleSchema.cycles.id, cycleId));

  const incompleteIssues = sourceIssueRows.filter(
    (r) => r.stateGroup === "backlog" || r.stateGroup === "unstarted" || r.stateGroup === "started"
  );

  if (incompleteIssues.length > 0) {
    const incompleteIds = incompleteIssues.map((r) => r.issueId);
    const incompleteCycleIssueIds = incompleteIssues.map((r) => r.cycleIssueId);

    await db.delete(cycleSchema.cycleIssues).where(inArray(cycleSchema.cycleIssues.id, incompleteCycleIssueIds));

    const existing = await db.select({ issueId: cycleSchema.cycleIssues.issueId }).from(cycleSchema.cycleIssues)
      .where(and(eq(cycleSchema.cycleIssues.cycleId, body.new_cycle_id), inArray(cycleSchema.cycleIssues.issueId, incompleteIds)));
    const existingSet = new Set(existing.map((r) => r.issueId));
    const toInsert = incompleteIds.filter((id) => !existingSet.has(id)).map((issueId) => ({ cycleId: body.new_cycle_id, issueId }));
    if (toInsert.length > 0) await db.insert(cycleSchema.cycleIssues).values(toInsert);
  }

  return c.json({ message: "Success" });
});

// ---- Setup ----
beforeAll(async () => {
  testUser = { id: createId(), email: "test@example.com" };
  otherUser = { id: createId(), email: "other@example.com" };

  await db.insert(userSchema.users).values([
    { id: testUser.id, email: testUser.email, name: "Test User" },
    { id: otherUser.id, email: otherUser.email, name: "Other User" },
  ]);

  workspace = { id: createId(), slug: "test-workspace" };
  await db.insert(workspaceSchema.workspaces).values({
    id: workspace.id, name: "Test Workspace", slug: workspace.slug, ownerId: testUser.id,
  });

  project = { id: createId() };
  await db.insert(projectSchema.projects).values({
    id: project.id, workspaceId: workspace.id, name: "Test Project", identifier: "TEST",
  });

  backlogState = { id: createId() };
  startedState = { id: createId() };
  completedState = { id: createId() };

  await db.insert(projectSchema.states).values([
    { id: backlogState.id, projectId: project.id, workspaceId: workspace.id, name: "Backlog", color: "#ccc", group: "backlog" },
    { id: startedState.id, projectId: project.id, workspaceId: workspace.id, name: "In Progress", color: "#0f0", group: "started" },
    { id: completedState.id, projectId: project.id, workspaceId: workspace.id, name: "Done", color: "#00f", group: "completed" },
  ]);
});

const url = (path: string) => `/api/workspaces/${workspace.slug}/projects/${project.id}${path}`;
const headers = (userId?: string) => ({
  "Content-Type": "application/json",
  "x-test-user-id": userId || testUser.id,
});

// =====================================================
// TESTS
// =====================================================

describe("Cycles - LIST", () => {
  test("returns empty list when no cycles", async () => {
    const res = await app.request(url("/cycles/"), { headers: headers() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request(url("/cycles/"));
    expect(res.status).toBe(401);
  });
});

describe("Cycles - CREATE", () => {
  test("creates a draft cycle (no dates)", async () => {
    const res = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Sprint Draft" }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Sprint Draft");
    expect(data.status).toBe("DRAFT");
    expect(data.start_date).toBeNull();
    expect(data.end_date).toBeNull();
    expect(data.owned_by_id).toBe(testUser.id);
    expect(data.project_id).toBe(project.id);
  });

  test("creates a cycle with dates", async () => {
    const start = new Date(Date.now() + 86400000).toISOString(); // tomorrow
    const end = new Date(Date.now() + 86400000 * 14).toISOString(); // 2 weeks
    const res = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Sprint Future", start_date: start, end_date: end }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("Sprint Future");
    expect(data.status).toBe("UPCOMING");
  });

  test("rejects if only start_date provided", async () => {
    const res = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Bad", start_date: new Date().toISOString() }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects if start_date > end_date", async () => {
    const res = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Bad", start_date: "2025-12-31T00:00:00Z", end_date: "2025-01-01T00:00:00Z" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Cycles - RETRIEVE", () => {
  test("retrieves a cycle by ID", async () => {
    // Create
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Sprint Retrieve" }),
    });
    const created = await createRes.json();

    // Retrieve
    const res = await app.request(url(`/cycles/${created.id}/`), { headers: headers() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(created.id);
    expect(data.name).toBe("Sprint Retrieve");
    expect(data.sub_issues).toBe(0);
  });

  test("returns 404 for non-existent cycle", async () => {
    const res = await app.request(url("/cycles/nonexistent/"), { headers: headers() });
    expect(res.status).toBe(404);
  });
});

describe("Cycles - PATCH", () => {
  test("updates cycle name and description", async () => {
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Sprint Patch" }),
    });
    const created = await createRes.json();

    const res = await app.request(url(`/cycles/${created.id}/`), {
      method: "PATCH", headers: headers(),
      body: JSON.stringify({ name: "Updated Sprint", description: "Some desc" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated Sprint");
    expect(data.description).toBe("Some desc");
  });

  test("rejects editing completed cycle (except sort_order)", async () => {
    const past = new Date(Date.now() - 86400000 * 30).toISOString();
    const pastEnd = new Date(Date.now() - 86400000 * 2).toISOString();
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Completed Sprint", start_date: past, end_date: pastEnd }),
    });
    const created = await createRes.json();

    // Try to update name - should fail
    const res = await app.request(url(`/cycles/${created.id}/`), {
      method: "PATCH", headers: headers(),
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toContain("completed");

    // Update sort_order - should succeed
    const res2 = await app.request(url(`/cycles/${created.id}/`), {
      method: "PATCH", headers: headers(),
      body: JSON.stringify({ sort_order: 12345 }),
    });
    expect(res2.status).toBe(200);
    const data = await res2.json();
    expect(data.sort_order).toBe(12345);
  });

  test("rejects editing archived cycle", async () => {
    const past = new Date(Date.now() - 86400000 * 30).toISOString();
    const pastEnd = new Date(Date.now() - 86400000 * 2).toISOString();
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "To Archive", start_date: past, end_date: pastEnd }),
    });
    const created = await createRes.json();

    // Archive it
    await app.request(url(`/cycles/${created.id}/archive/`), {
      method: "POST", headers: headers(),
    });

    // Try to update
    const res = await app.request(url(`/cycles/${created.id}/`), {
      method: "PATCH", headers: headers(),
      body: JSON.stringify({ name: "Fail" }),
    });
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(err.error).toContain("Archived");
  });
});

describe("Cycles - DELETE", () => {
  test("deletes a cycle", async () => {
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "To Delete" }),
    });
    const created = await createRes.json();

    const res = await app.request(url(`/cycles/${created.id}/`), {
      method: "DELETE", headers: headers(),
    });
    expect(res.status).toBe(204);

    // Verify it's gone
    const getRes = await app.request(url(`/cycles/${created.id}/`), { headers: headers() });
    expect(getRes.status).toBe(404);
  });
});

describe("Cycles - Date Check", () => {
  test("returns status true when no overlap", async () => {
    const res = await app.request(url("/cycles/date-check/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ start_date: "2099-01-01T00:00:00Z", end_date: "2099-01-15T00:00:00Z" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe(true);
  });

  test("returns error when dates overlap", async () => {
    // Create a cycle with known dates
    const start = "2098-06-01T00:00:00Z";
    const end = "2098-06-15T00:00:00Z";
    await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Overlap Cycle", start_date: start, end_date: end }),
    });

    // Check overlapping dates
    const res = await app.request(url("/cycles/date-check/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ start_date: "2098-06-10T00:00:00Z", end_date: "2098-06-20T00:00:00Z" }),
    });
    const data = await res.json();
    expect(data.status).toBe(false);
  });

  test("excludes self when cycle_id provided", async () => {
    // Create a cycle
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Self Check", start_date: "2097-03-01T00:00:00Z", end_date: "2097-03-15T00:00:00Z" }),
    });
    const created = await createRes.json();

    // Check its own dates - should be ok
    const res = await app.request(url("/cycles/date-check/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ start_date: "2097-03-01T00:00:00Z", end_date: "2097-03-15T00:00:00Z", cycle_id: created.id }),
    });
    const data = await res.json();
    expect(data.status).toBe(true);
  });
});

describe("Cycles - Favorites", () => {
  test("add and remove favorite", async () => {
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Fav Cycle" }),
    });
    const created = await createRes.json();

    // Add favorite
    const addRes = await app.request(url("/user-favorite-cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ cycle: created.id }),
    });
    expect(addRes.status).toBe(204);

    // Verify cycle shows as favorite in list
    const listRes = await app.request(url("/cycles/"), { headers: headers() });
    const cycles = await listRes.json();
    const favCycle = cycles.find((cy: any) => cy.id === created.id);
    expect(favCycle.is_favorite).toBe(true);

    // Remove favorite
    const removeRes = await app.request(url(`/user-favorite-cycles/${created.id}/`), {
      method: "DELETE", headers: headers(),
    });
    expect(removeRes.status).toBe(204);

    // Verify no longer favorite
    const listRes2 = await app.request(url("/cycles/"), { headers: headers() });
    const cycles2 = await listRes2.json();
    const unfavCycle = cycles2.find((cy: any) => cy.id === created.id);
    expect(unfavCycle.is_favorite).toBe(false);
  });
});

describe("Cycles - Archive/Unarchive", () => {
  test("archives a completed cycle", async () => {
    const past = new Date(Date.now() - 86400000 * 30).toISOString();
    const pastEnd = new Date(Date.now() - 86400000 * 2).toISOString();
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Archive Me", start_date: past, end_date: pastEnd }),
    });
    const created = await createRes.json();

    const archiveRes = await app.request(url(`/cycles/${created.id}/archive/`), {
      method: "POST", headers: headers(),
    });
    expect(archiveRes.status).toBe(200);
    const archiveData = await archiveRes.json();
    expect(archiveData.archived_at).toBeDefined();

    // Should not show in regular list
    const listRes = await app.request(url("/cycles/"), { headers: headers() });
    const allCycles = await listRes.json();
    expect(allCycles.find((cy: any) => cy.id === created.id)).toBeUndefined();

    // Should show in archived list
    const archivedRes = await app.request(url("/archived-cycles/"), { headers: headers() });
    const archivedCycles = await archivedRes.json();
    expect(archivedCycles.find((cy: any) => cy.id === created.id)).toBeDefined();
  });

  test("rejects archiving non-completed cycle", async () => {
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Draft No Archive" }),
    });
    const created = await createRes.json();

    const res = await app.request(url(`/cycles/${created.id}/archive/`), {
      method: "POST", headers: headers(),
    });
    expect(res.status).toBe(400);
  });

  test("unarchives a cycle", async () => {
    const past = new Date(Date.now() - 86400000 * 30).toISOString();
    const pastEnd = new Date(Date.now() - 86400000 * 2).toISOString();
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Unarchive Me", start_date: past, end_date: pastEnd }),
    });
    const created = await createRes.json();

    // Archive
    await app.request(url(`/cycles/${created.id}/archive/`), { method: "POST", headers: headers() });

    // Unarchive
    const unarchiveRes = await app.request(url(`/cycles/${created.id}/archive/`), {
      method: "DELETE", headers: headers(),
    });
    expect(unarchiveRes.status).toBe(204);

    // Should be back in regular list
    const listRes = await app.request(url("/cycles/"), { headers: headers() });
    const allCycles = await listRes.json();
    expect(allCycles.find((cy: any) => cy.id === created.id)).toBeDefined();
  });
});

describe("Cycles - LIST with issue stats", () => {
  test("shows correct issue counts by state group", async () => {
    // Create a cycle
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Stats Cycle" }),
    });
    const cycle = await createRes.json();

    // Create issues with different states
    const issueIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = createId();
      issueIds.push(id);
      await db.insert(issueSchema.issues).values({
        id,
        projectId: project.id,
        workspaceId: workspace.id,
        name: `Issue ${i}`,
        stateId: i === 0 ? backlogState.id : i === 1 ? startedState.id : completedState.id,
      });
    }

    // Add issues to cycle
    for (const issueId of issueIds) {
      await db.insert(cycleSchema.cycleIssues).values({ cycleId: cycle.id, issueId });
    }

    // List and verify
    const listRes = await app.request(url("/cycles/"), { headers: headers() });
    const allCycles = await listRes.json();
    const statsCycle = allCycles.find((cy: any) => cy.id === cycle.id);
    expect(statsCycle.total_issues).toBe(3);
    expect(statsCycle.backlog_issues).toBe(1);
    expect(statsCycle.started_issues).toBe(1);
    expect(statsCycle.completed_issues).toBe(1);
  });
});

describe("Cycles - Transfer Issues", () => {
  test("transfers incomplete issues from completed to new cycle", async () => {
    const past = new Date(Date.now() - 86400000 * 30).toISOString();
    const pastEnd = new Date(Date.now() - 86400000 * 2).toISOString();

    // Source cycle (completed)
    const sourceRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Source Cycle", start_date: past, end_date: pastEnd }),
    });
    const source = await sourceRes.json();

    // Destination cycle (draft)
    const destRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Dest Cycle" }),
    });
    const dest = await destRes.json();

    // Create issues: 1 backlog, 1 started, 1 completed
    const backlogIssue = createId();
    const startedIssue = createId();
    const completedIssue = createId();

    await db.insert(issueSchema.issues).values([
      { id: backlogIssue, projectId: project.id, workspaceId: workspace.id, name: "Backlog Issue", stateId: backlogState.id },
      { id: startedIssue, projectId: project.id, workspaceId: workspace.id, name: "Started Issue", stateId: startedState.id },
      { id: completedIssue, projectId: project.id, workspaceId: workspace.id, name: "Completed Issue", stateId: completedState.id },
    ]);

    // Add to source cycle
    await db.insert(cycleSchema.cycleIssues).values([
      { cycleId: source.id, issueId: backlogIssue },
      { cycleId: source.id, issueId: startedIssue },
      { cycleId: source.id, issueId: completedIssue },
    ]);

    // Transfer
    const transferRes = await app.request(url(`/cycles/${source.id}/transfer-issues/`), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ new_cycle_id: dest.id }),
    });
    expect(transferRes.status).toBe(200);
    const transferData = await transferRes.json();
    expect(transferData.message).toBe("Success");

    // Verify source cycle has progress snapshot
    const sourceCycleDb = await db.query.cycles.findFirst({ where: eq(cycleSchema.cycles.id, source.id) });
    const snapshot = sourceCycleDb!.progressSnapshot as any;
    expect(snapshot.total_issues).toBe(3);
    expect(snapshot.completed_issues).toBe(1);
    expect(snapshot.backlog_issues).toBe(1);
    expect(snapshot.started_issues).toBe(1);

    // Verify destination cycle has incomplete issues
    const destIssues = await db.select().from(cycleSchema.cycleIssues)
      .where(eq(cycleSchema.cycleIssues.cycleId, dest.id));
    expect(destIssues.length).toBe(2);
    const destIssueIds = destIssues.map((ci) => ci.issueId);
    expect(destIssueIds).toContain(backlogIssue);
    expect(destIssueIds).toContain(startedIssue);
    expect(destIssueIds).not.toContain(completedIssue);

    // Verify source cycle still has completed issue
    const sourceIssues = await db.select().from(cycleSchema.cycleIssues)
      .where(eq(cycleSchema.cycleIssues.cycleId, source.id));
    expect(sourceIssues.length).toBe(1);
    expect(sourceIssues[0].issueId).toBe(completedIssue);
  });

  test("rejects transfer from non-completed cycle", async () => {
    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Draft Source" }),
    });
    const source = await createRes.json();

    const destRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Draft Dest" }),
    });
    const dest = await destRes.json();

    const res = await app.request(url(`/cycles/${source.id}/transfer-issues/`), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ new_cycle_id: dest.id }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Cycles - LIST cycle_view filter", () => {
  test("filters for current cycles only", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 86400000 * 3).toISOString(); // 3 days ago
    const end = new Date(now.getTime() + 86400000 * 3).toISOString(); // 3 days from now

    const createRes = await app.request(url("/cycles/"), {
      method: "POST", headers: headers(),
      body: JSON.stringify({ name: "Current Cycle", start_date: start, end_date: end }),
    });
    const created = await createRes.json();
    expect(created.status).toBe("CURRENT");

    // List with cycle_view=current
    const res = await app.request(url("/cycles/?cycle_view=current"), { headers: headers() });
    expect(res.status).toBe(200);
    const data = await res.json();
    const found = data.find((cy: any) => cy.id === created.id);
    expect(found).toBeDefined();
    expect(found.status).toBe("CURRENT");

    // All draft/upcoming/completed should not appear in cycle_view=current
    for (const cy of data) {
      expect(cy.status).toBe("CURRENT");
    }
  });
});

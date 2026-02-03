import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and, asc, desc, count, not, inArray, isNull, lt, gte } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as schema from "../../db/schema";
import { users } from "../../db/schema/user";
import {
  workspaces,
  workspaceMembers,
  workspaceHomePreferences,
  workspaceUserPreferences,
} from "../../db/schema/workspace";
import { issues, issueAssignees, issueActivities } from "../../db/schema/issue";
import { projects, states } from "../../db/schema/project";
import { recentVisits } from "../../db/schema/workspace";

const sqlite = new BunSQLite(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
const db = drizzle(sqlite, { schema });

const testUser = { id: createId(), email: "test@test.com", name: "Test User", displayName: "Test User", isActive: true };
const otherUser = { id: createId(), email: "other@test.com", name: "Other User", displayName: "Other", isActive: true };
const testWorkspace = { id: createId(), name: "Test Workspace", slug: "test-ws", ownerId: testUser.id };
const testProject = { id: createId(), name: "Test Project", workspaceId: testWorkspace.id, identifier: "TST", network: 2 };

// States
const backlogState = { id: createId(), projectId: testProject.id, workspaceId: testWorkspace.id, name: "Backlog", color: "#ccc", group: "backlog", sequence: 1 };
const completedState = { id: createId(), projectId: testProject.id, workspaceId: testWorkspace.id, name: "Done", color: "#0f0", group: "completed", sequence: 5 };
const cancelledState = { id: createId(), projectId: testProject.id, workspaceId: testWorkspace.id, name: "Cancelled", color: "#f00", group: "cancelled", sequence: 6 };

// Helper constants
const SIDEBAR_PREF_KEYS = ["views", "active_cycles", "analytics", "drafts", "your_work", "archives", "stickies"];
const DEFAULT_PINNED_KEYS = ["drafts", "your_work", "stickies"];

const DASHBOARD_WIDGET_KEYS = [
  "overview_stats", "assigned_issues", "created_issues",
  "issues_by_state_groups", "issues_by_priority",
  "recent_activity", "recent_projects", "recent_collaborators",
];

function buildApp() {
  const app = new Hono<{ Variables: any }>();

  // Middleware to extract user and workspace from URL
  app.use("/api/workspaces/:slug/*", async (c, next) => {
    const userId = c.req.header("x-test-user-id") || testUser.id;
    const u = userId === otherUser.id ? otherUser : testUser;
    c.set("user", u);

    const slug = c.req.param("slug");
    if (slug) {
      const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
      if (ws) {
        c.set("workspace", ws);
        const membership = await db.query.workspaceMembers.findFirst({
          where: and(eq(workspaceMembers.workspaceId, ws.id), eq(workspaceMembers.userId, u.id)),
        });
        c.set("workspaceMembership", membership ?? null);
      }
    }
    await next();
  });

  // === Sidebar Preferences ===
  app.get("/api/workspaces/:slug/sidebar-preferences/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

    const existingPrefs = await db.query.workspaceUserPreferences.findMany({
      where: and(eq(workspaceUserPreferences.workspaceId, workspace.id), eq(workspaceUserPreferences.userId, user.id)),
    });

    const existingKeys = existingPrefs.map((p) => p.key);
    const missingKeys = SIDEBAR_PREF_KEYS.filter((key) => !existingKeys.includes(key));

    if (missingKeys.length > 0) {
      const toCreate = missingKeys.map((key, i) => ({
        workspaceId: workspace.id,
        userId: user.id,
        key,
        isPinned: DEFAULT_PINNED_KEYS.includes(key),
        sortOrder: 65535 + (i * 10000),
      }));
      await db.insert(workspaceUserPreferences).values(toCreate);
    }

    const allPrefs = await db.query.workspaceUserPreferences.findMany({
      where: and(eq(workspaceUserPreferences.workspaceId, workspace.id), eq(workspaceUserPreferences.userId, user.id)),
      orderBy: [asc(workspaceUserPreferences.sortOrder)],
    });

    const result: Record<string, { is_pinned: boolean; sort_order: number }> = {};
    for (const pref of allPrefs) {
      result[pref.key] = { is_pinned: pref.isPinned ?? false, sort_order: pref.sortOrder ?? 65535 };
    }
    return c.json(result);
  });

  app.patch("/api/workspaces/:slug/sidebar-preferences/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

    const body = await c.req.json() as Array<{ key: string; is_pinned?: boolean; sort_order?: number }>;
    if (!Array.isArray(body)) return c.json({ detail: "Expected array" }, 400);

    for (const data of body) {
      if (!data.key) continue;
      const pref = await db.query.workspaceUserPreferences.findFirst({
        where: and(
          eq(workspaceUserPreferences.key, data.key),
          eq(workspaceUserPreferences.workspaceId, workspace.id),
          eq(workspaceUserPreferences.userId, user.id)
        ),
      });
      if (!pref) continue;
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.is_pinned !== undefined) updateData.isPinned = data.is_pinned;
      if (data.sort_order !== undefined) updateData.sortOrder = data.sort_order;
      await db.update(workspaceUserPreferences).set(updateData).where(eq(workspaceUserPreferences.id, pref.id));
    }
    return c.json({ message: "Successfully updated" });
  });

  app.patch("/api/workspaces/:slug/sidebar-preferences/:key/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    const key = c.req.param("key");
    if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

    const body = await c.req.json() as { is_pinned?: boolean; sort_order?: number };
    const pref = await db.query.workspaceUserPreferences.findFirst({
      where: and(
        eq(workspaceUserPreferences.key, key),
        eq(workspaceUserPreferences.workspaceId, workspace.id),
        eq(workspaceUserPreferences.userId, user.id)
      ),
    });
    if (!pref) return c.json({ detail: "Preference not found" }, 404);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.is_pinned !== undefined) updateData.isPinned = body.is_pinned;
    if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

    await db.update(workspaceUserPreferences).set(updateData).where(eq(workspaceUserPreferences.id, pref.id));

    const updated = await db.query.workspaceUserPreferences.findFirst({ where: eq(workspaceUserPreferences.id, pref.id) });
    return c.json({ key: updated!.key, is_pinned: updated!.isPinned ?? false, sort_order: updated!.sortOrder ?? 65535 });
  });

  // === Dashboard ===
  const DEFAULT_WIDGET_FILTERS: Record<string, Record<string, unknown>> = {
    assigned_issues: { duration: "this_week", tab: "pending" },
    created_issues: { duration: "this_week", tab: "pending" },
    issues_by_state_groups: {},
    issues_by_priority: {},
    overview_stats: {},
    recent_activity: {},
    recent_projects: {},
    recent_collaborators: {},
  };

  app.get("/api/workspaces/:slug/dashboard/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

    const dashboardId = `dashboard-${workspace.id}-${user.id}`;
    const dashboard = {
      id: dashboardId,
      name: "Home",
      description_html: "<p></p>",
      identifier: null,
      is_default: true,
      type: c.req.query("dashboard_type") || "home",
      owned_by: user.id,
      created_by: user.id,
      updated_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const widgets = DASHBOARD_WIDGET_KEYS.map((key, i) => ({
      id: `widget-${dashboardId}-${key}`,
      key,
      is_visible: true,
      sort_order: 65535 + i * 1000,
      widget_filters: DEFAULT_WIDGET_FILTERS[key] ?? {},
      filters: DEFAULT_WIDGET_FILTERS[key] ?? {},
    }));

    return c.json({ dashboard, widgets });
  });

  app.get("/api/workspaces/:slug/dashboard/:dashboardId/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

    const widgetKey = c.req.query("widget_key");
    if (!widgetKey) return c.json({ detail: "widget_key is required" }, 400);

    const now = new Date();

    switch (widgetKey) {
      case "overview_stats": {
        const assignedIssueIds = await db
          .select({ issueId: issueAssignees.issueId })
          .from(issueAssignees)
          .innerJoin(issues, eq(issues.id, issueAssignees.issueId))
          .where(and(eq(issueAssignees.assigneeId, user.id), eq(issues.workspaceId, workspace.id), isNull(issues.archivedAt)));
        const assignedIds = assignedIssueIds.map((r) => r.issueId);
        if (assignedIds.length === 0) {
          return c.json({ assigned_issues_count: 0, completed_issues_count: 0, created_issues_count: 0, pending_issues_count: 0 });
        }
        const completedCount = await db.select({ count: count() }).from(issues)
          .innerJoin(states, eq(states.id, issues.stateId))
          .where(and(inArray(issues.id, assignedIds), eq(states.group, "completed")));
        const pendingCount = await db.select({ count: count() }).from(issues)
          .innerJoin(states, eq(states.id, issues.stateId))
          .where(and(inArray(issues.id, assignedIds), not(inArray(states.group, ["completed", "cancelled"]))));
        const createdCount = await db.select({ count: count() }).from(issues)
          .where(and(eq(issues.workspaceId, workspace.id), eq(issues.createdById, user.id), isNull(issues.archivedAt)));
        return c.json({
          assigned_issues_count: assignedIds.length,
          completed_issues_count: completedCount[0]?.count ?? 0,
          created_issues_count: createdCount[0]?.count ?? 0,
          pending_issues_count: pendingCount[0]?.count ?? 0,
        });
      }
      case "issues_by_state_groups": {
        const stateGroups = await db.select({ group: states.group, count: count() }).from(issues)
          .innerJoin(issueAssignees, eq(issueAssignees.issueId, issues.id))
          .innerJoin(states, eq(states.id, issues.stateId))
          .where(and(eq(issueAssignees.assigneeId, user.id), eq(issues.workspaceId, workspace.id), isNull(issues.archivedAt)))
          .groupBy(states.group);
        return c.json(stateGroups.map((sg) => ({ state: sg.group, count: sg.count })));
      }
      case "issues_by_priority": {
        const priorityGroups = await db.select({ priority: issues.priority, count: count() }).from(issues)
          .innerJoin(issueAssignees, eq(issueAssignees.issueId, issues.id))
          .where(and(eq(issueAssignees.assigneeId, user.id), eq(issues.workspaceId, workspace.id), isNull(issues.archivedAt)))
          .groupBy(issues.priority);
        const priorityMap: Record<number, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" };
        return c.json(priorityGroups.map((pg) => ({ priority: priorityMap[pg.priority ?? 0] ?? "none", count: pg.count })));
      }
      case "recent_activity": {
        const activities = await db.query.issueActivities.findMany({
          where: and(eq(issueActivities.actorId, user.id), eq(issueActivities.workspaceId, workspace.id)),
          orderBy: [desc(issueActivities.createdAt)],
          limit: 20,
        });
        return c.json(activities.map((a) => ({
          id: a.id, issue_id: a.issueId, project_id: a.projectId, workspace_id: a.workspaceId,
          actor_id: a.actorId, field: a.field, old_value: a.oldValue, new_value: a.newValue, verb: a.verb,
        })));
      }
      case "recent_projects": {
        const visits = await db.query.recentVisits.findMany({
          where: and(eq(recentVisits.userId, user.id), eq(recentVisits.workspaceId, workspace.id), eq(recentVisits.entityType, "project")),
          orderBy: [desc(recentVisits.visitedAt)],
          limit: 5,
        });
        return c.json(visits.map((v) => v.entityId));
      }
      default:
        return c.json({ detail: `Unknown widget_key: ${widgetKey}` }, 400);
    }
  });

  return app;
}

beforeAll(async () => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER DEFAULT 0,
      name TEXT,
      image TEXT,
      username TEXT UNIQUE,
      display_name TEXT,
      avatar TEXT,
      cover_image TEXT,
      first_name TEXT,
      last_name TEXT,
      is_active INTEGER DEFAULT 1,
      is_password_autoset INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      last_login_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS workspaces (
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
    CREATE TABLE IF NOT EXISTS workspace_members (
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
    CREATE TABLE IF NOT EXISTS workspace_user_preferences (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      is_pinned INTEGER DEFAULT 0,
      sort_order REAL DEFAULT 65535,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(workspace_id, user_id, key)
    );
    CREATE TABLE IF NOT EXISTS workspace_home_preferences (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      config TEXT DEFAULT '{}',
      sort_order REAL DEFAULT 65535,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(workspace_id, user_id, key)
    );
    CREATE TABLE IF NOT EXISTS projects (
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
      sort_order REAL DEFAULT 65535,
      is_member_added INTEGER DEFAULT 0,
      created_by_id TEXT REFERENCES users(id),
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER,
      UNIQUE(workspace_id, identifier)
    );
    CREATE TABLE IF NOT EXISTS states (
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
    CREATE TABLE IF NOT EXISTS issues (
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
    CREATE TABLE IF NOT EXISTS issue_assignees (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      assignee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER,
      UNIQUE(issue_id, assignee_id)
    );
    CREATE TABLE IF NOT EXISTS issue_activities (
      id TEXT PRIMARY KEY,
      issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      actor_id TEXT REFERENCES users(id),
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      verb TEXT NOT NULL,
      old_identifier TEXT,
      new_identifier TEXT,
      epoch_timestamp INTEGER,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS recent_visits (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      visited_at INTEGER
    );
  `);

  await db.insert(users).values(testUser);
  await db.insert(users).values(otherUser);
  await db.insert(workspaces).values(testWorkspace);
  await db.insert(workspaceMembers).values({ workspaceId: testWorkspace.id, userId: testUser.id, role: 20 });
  await db.insert(projects).values(testProject);
  await db.insert(states).values(backlogState);
  await db.insert(states).values(completedState);
  await db.insert(states).values(cancelledState);

  // Create some issues
  const issue1 = { id: createId(), projectId: testProject.id, workspaceId: testWorkspace.id, name: "Issue 1", stateId: backlogState.id, priority: 2, createdById: testUser.id };
  const issue2 = { id: createId(), projectId: testProject.id, workspaceId: testWorkspace.id, name: "Issue 2", stateId: completedState.id, priority: 1, createdById: testUser.id };
  const issue3 = { id: createId(), projectId: testProject.id, workspaceId: testWorkspace.id, name: "Issue 3", stateId: cancelledState.id, priority: 3, createdById: otherUser.id };

  await db.insert(issues).values(issue1);
  await db.insert(issues).values(issue2);
  await db.insert(issues).values(issue3);

  // Assign issues to testUser
  await db.insert(issueAssignees).values({ issueId: issue1.id, assigneeId: testUser.id });
  await db.insert(issueAssignees).values({ issueId: issue2.id, assigneeId: testUser.id });
  await db.insert(issueAssignees).values({ issueId: issue3.id, assigneeId: testUser.id });

  // Create activity
  await db.insert(issueActivities).values({
    issueId: issue1.id,
    projectId: testProject.id,
    workspaceId: testWorkspace.id,
    actorId: testUser.id,
    field: "state",
    verb: "updated",
    oldValue: "Backlog",
    newValue: "In Progress",
  });

  // Create recent project visit
  await db.insert(recentVisits).values({
    workspaceId: testWorkspace.id,
    userId: testUser.id,
    entityType: "project",
    entityId: testProject.id,
  });
});

// =====================================================
// Sidebar Preferences Tests
// =====================================================

describe("GET /api/workspaces/:slug/sidebar-preferences/", () => {
  test("returns all sidebar preferences with auto-creation", async () => {
    const app = buildApp();
    const res = await app.request("/api/workspaces/test-ws/sidebar-preferences/");
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, { is_pinned: boolean; sort_order: number }>;

    // All keys should be present
    for (const key of SIDEBAR_PREF_KEYS) {
      expect(body[key]).toBeDefined();
      expect(typeof body[key].is_pinned).toBe("boolean");
      expect(typeof body[key].sort_order).toBe("number");
    }

    // Default pinned keys
    expect(body.drafts.is_pinned).toBe(true);
    expect(body.your_work.is_pinned).toBe(true);
    expect(body.stickies.is_pinned).toBe(true);

    // Non-default pinned keys
    expect(body.views.is_pinned).toBe(false);
    expect(body.active_cycles.is_pinned).toBe(false);
    expect(body.analytics.is_pinned).toBe(false);
    expect(body.archives.is_pinned).toBe(false);
  });

  test("idempotent - calling twice returns same data", async () => {
    const app = buildApp();
    const res1 = await app.request("/api/workspaces/test-ws/sidebar-preferences/");
    const res2 = await app.request("/api/workspaces/test-ws/sidebar-preferences/");

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1).toEqual(body2);
  });
});

describe("PATCH /api/workspaces/:slug/sidebar-preferences/", () => {
  test("bulk update is_pinned and sort_order", async () => {
    const app = buildApp();

    const res = await app.request("/api/workspaces/test-ws/sidebar-preferences/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { key: "views", is_pinned: true, sort_order: 100 },
        { key: "analytics", is_pinned: true },
      ]),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { message: string };
    expect(body.message).toBe("Successfully updated");

    // Verify changes
    const getRes = await app.request("/api/workspaces/test-ws/sidebar-preferences/");
    const prefs = await getRes.json() as Record<string, { is_pinned: boolean; sort_order: number }>;
    expect(prefs.views.is_pinned).toBe(true);
    expect(prefs.views.sort_order).toBe(100);
    expect(prefs.analytics.is_pinned).toBe(true);
  });
});

describe("PATCH /api/workspaces/:slug/sidebar-preferences/:key/", () => {
  test("update single preference", async () => {
    const app = buildApp();

    const res = await app.request("/api/workspaces/test-ws/sidebar-preferences/archives/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_pinned: true, sort_order: 50 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { key: string; is_pinned: boolean; sort_order: number };
    expect(body.key).toBe("archives");
    expect(body.is_pinned).toBe(true);
    expect(body.sort_order).toBe(50);
  });

  test("returns 404 for unknown key", async () => {
    const app = buildApp();

    const res = await app.request("/api/workspaces/test-ws/sidebar-preferences/nonexistent/", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_pinned: true }),
    });

    expect(res.status).toBe(404);
  });
});

// =====================================================
// Dashboard Tests
// =====================================================

describe("GET /api/workspaces/:slug/dashboard/", () => {
  test("returns dashboard with all widget keys", async () => {
    const app = buildApp();
    const res = await app.request("/api/workspaces/test-ws/dashboard/?dashboard_type=home");
    expect(res.status).toBe(200);

    const body = await res.json() as { dashboard: any; widgets: any[] };

    // Dashboard structure
    expect(body.dashboard).toBeDefined();
    expect(body.dashboard.id).toContain("dashboard-");
    expect(body.dashboard.name).toBe("Home");
    expect(body.dashboard.type).toBe("home");
    expect(body.dashboard.is_default).toBe(true);
    expect(body.dashboard.owned_by).toBe(testUser.id);

    // Widgets
    expect(body.widgets).toHaveLength(DASHBOARD_WIDGET_KEYS.length);
    for (const widget of body.widgets) {
      expect(widget.id).toBeDefined();
      expect(widget.key).toBeDefined();
      expect(widget.is_visible).toBe(true);
      expect(typeof widget.sort_order).toBe("number");
      expect(widget.widget_filters).toBeDefined();
      expect(widget.filters).toBeDefined();
    }

    // All widget keys present
    const widgetKeys = body.widgets.map((w: any) => w.key);
    for (const key of DASHBOARD_WIDGET_KEYS) {
      expect(widgetKeys).toContain(key);
    }
  });

  test("deterministic dashboard ID for same user and workspace", async () => {
    const app = buildApp();
    const res1 = await app.request("/api/workspaces/test-ws/dashboard/?dashboard_type=home");
    const res2 = await app.request("/api/workspaces/test-ws/dashboard/?dashboard_type=home");

    const body1 = await res1.json() as { dashboard: any };
    const body2 = await res2.json() as { dashboard: any };

    expect(body1.dashboard.id).toBe(body2.dashboard.id);
  });
});

describe("GET /api/workspaces/:slug/dashboard/:dashboardId/ (widget stats)", () => {
  test("overview_stats returns correct counts", async () => {
    const app = buildApp();
    const dashboardId = `dashboard-${testWorkspace.id}-${testUser.id}`;
    const res = await app.request(`/api/workspaces/test-ws/dashboard/${dashboardId}/?widget_key=overview_stats`);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      assigned_issues_count: number;
      completed_issues_count: number;
      created_issues_count: number;
      pending_issues_count: number;
    };

    expect(body.assigned_issues_count).toBe(3); // all 3 issues assigned
    expect(body.completed_issues_count).toBe(1); // issue2 is completed
    expect(body.pending_issues_count).toBe(1); // issue1 is backlog (not completed or cancelled)
    expect(body.created_issues_count).toBe(2); // issue1 & issue2 created by testUser
  });

  test("issues_by_state_groups returns state distribution", async () => {
    const app = buildApp();
    const dashboardId = `dashboard-${testWorkspace.id}-${testUser.id}`;
    const res = await app.request(`/api/workspaces/test-ws/dashboard/${dashboardId}/?widget_key=issues_by_state_groups`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ state: string; count: number }>;
    expect(Array.isArray(body)).toBe(true);

    const stateMap: Record<string, number> = {};
    for (const entry of body) {
      stateMap[entry.state] = entry.count;
    }

    expect(stateMap["backlog"]).toBe(1);
    expect(stateMap["completed"]).toBe(1);
    expect(stateMap["cancelled"]).toBe(1);
  });

  test("issues_by_priority returns priority distribution", async () => {
    const app = buildApp();
    const dashboardId = `dashboard-${testWorkspace.id}-${testUser.id}`;
    const res = await app.request(`/api/workspaces/test-ws/dashboard/${dashboardId}/?widget_key=issues_by_priority`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<{ priority: string; count: number }>;
    expect(Array.isArray(body)).toBe(true);

    const priorityMap: Record<string, number> = {};
    for (const entry of body) {
      priorityMap[entry.priority] = entry.count;
    }

    // issue1 priority=2 (high), issue2 priority=1 (urgent), issue3 priority=3 (medium)
    expect(priorityMap["high"]).toBe(1);
    expect(priorityMap["urgent"]).toBe(1);
    expect(priorityMap["medium"]).toBe(1);
  });

  test("recent_activity returns user activities", async () => {
    const app = buildApp();
    const dashboardId = `dashboard-${testWorkspace.id}-${testUser.id}`;
    const res = await app.request(`/api/workspaces/test-ws/dashboard/${dashboardId}/?widget_key=recent_activity`);
    expect(res.status).toBe(200);

    const body = await res.json() as any[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].actor_id).toBe(testUser.id);
    expect(body[0].field).toBe("state");
    expect(body[0].verb).toBe("updated");
  });

  test("recent_projects returns project IDs", async () => {
    const app = buildApp();
    const dashboardId = `dashboard-${testWorkspace.id}-${testUser.id}`;
    const res = await app.request(`/api/workspaces/test-ws/dashboard/${dashboardId}/?widget_key=recent_projects`);
    expect(res.status).toBe(200);

    const body = await res.json() as string[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toContain(testProject.id);
  });

  test("requires widget_key parameter", async () => {
    const app = buildApp();
    const dashboardId = `dashboard-${testWorkspace.id}-${testUser.id}`;
    const res = await app.request(`/api/workspaces/test-ws/dashboard/${dashboardId}/`);
    expect(res.status).toBe(400);
  });

  test("returns error for unknown widget_key", async () => {
    const app = buildApp();
    const dashboardId = `dashboard-${testWorkspace.id}-${testUser.id}`;
    const res = await app.request(`/api/workspaces/test-ws/dashboard/${dashboardId}/?widget_key=nonexistent`);
    expect(res.status).toBe(400);
  });

  test("overview_stats returns zeros when no assigned issues", async () => {
    const app = buildApp();
    const dashboardId = `dashboard-${testWorkspace.id}-${otherUser.id}`;
    const res = await app.request(`/api/workspaces/test-ws/dashboard/${dashboardId}/?widget_key=overview_stats`, {
      headers: { "x-test-user-id": otherUser.id },
    });
    expect(res.status).toBe(200);

    const body = await res.json() as any;
    expect(body.assigned_issues_count).toBe(0);
    expect(body.completed_issues_count).toBe(0);
    expect(body.pending_issues_count).toBe(0);
  });
});

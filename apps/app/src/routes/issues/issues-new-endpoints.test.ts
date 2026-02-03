import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, isNull, isNotNull, inArray, desc, sql, count as countFn, max } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../../db/schema/user";
import * as workspaceSchema from "../../db/schema/workspace";
import * as projectSchema from "../../db/schema/project";
import * as issueSchema from "../../db/schema/issue";
import * as cycleSchema from "../../db/schema/cycle";
import * as moduleSchema from "../../db/schema/module";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: {
    ...userSchema,
    ...workspaceSchema,
    ...projectSchema,
    ...issueSchema,
    ...cycleSchema,
    ...moduleSchema,
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

  CREATE TABLE issue_labels (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    label_id TEXT NOT NULL,
    created_at INTEGER,
    UNIQUE(issue_id, label_id)
  );

  CREATE TABLE issue_activities (
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

  CREATE TABLE issue_subscribers (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    subscriber_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(issue_id, subscriber_id)
  );

  CREATE TABLE cycle_issues (
    id TEXT PRIMARY KEY,
    cycle_id TEXT NOT NULL,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(cycle_id, issue_id)
  );

  CREATE TABLE module_issues (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    created_at INTEGER,
    UNIQUE(module_id, issue_id)
  );
`);

let testUser: { id: string; email: string };
let otherUser: { id: string; email: string };
let workspace: { id: string; slug: string };
let project: { id: string };
let completedState: { id: string };
let backlogState: { id: string };

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  if (userId === otherUser?.id) return otherUser;
  return null;
}

const app = new Hono();

// Helper to create issue directly in db
async function createIssue(overrides: Partial<typeof issueSchema.issues.$inferInsert> = {}) {
  const maxSeqResult = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${issueSchema.issues.sequenceId}), 0)` })
    .from(issueSchema.issues)
    .where(eq(issueSchema.issues.projectId, project.id));
  const nextSeq = (maxSeqResult[0]?.maxSeq ?? 0) + 1;

  const [issue] = await db.insert(issueSchema.issues).values({
    projectId: project.id,
    workspaceId: workspace.id,
    name: `Issue ${nextSeq}`,
    sequenceId: nextSeq,
    ...overrides,
  }).returning();
  return issue;
}

// --- Sub-issues ---

app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/sub-issues/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const projectId = c.req.param("projectId");

  const subIssues = await db
    .select()
    .from(issueSchema.issues)
    .where(and(
      eq(issueSchema.issues.parentId, issueId),
      eq(issueSchema.issues.projectId, projectId),
      isNull(issueSchema.issues.archivedAt),
      isNull(issueSchema.issues.deletedAt)
    ))
    .orderBy(desc(issueSchema.issues.createdAt));

  const stateDistribution: Record<string, number> = {};
  for (const issue of subIssues) {
    const stateId = issue.stateId ?? "none";
    stateDistribution[stateId] = (stateDistribution[stateId] || 0) + 1;
  }

  return c.json({
    sub_issues: subIssues.map((i) => ({
      id: i.id,
      name: i.name,
      parent_id: i.parentId,
      state_id: i.stateId,
      priority: i.priority,
    })),
    state_distribution: stateDistribution,
  });
});

app.post("/api/workspaces/:slug/projects/:projectId/issues/:issueId/sub-issues/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  if (!body.sub_issue_ids || body.sub_issue_ids.length === 0) {
    return c.json({ error: "sub_issue_ids is required" }, 400);
  }

  await db
    .update(issueSchema.issues)
    .set({ parentId: issueId, updatedAt: new Date() })
    .where(and(eq(issueSchema.issues.projectId, projectId), inArray(issueSchema.issues.id, body.sub_issue_ids)));

  return c.json({ message: "Sub-issues added." });
});

// --- Subscribers ---

app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/subscribe/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");

  const sub = await db.query.issueSubscribers.findFirst({
    where: and(
      eq(issueSchema.issueSubscribers.issueId, issueId),
      eq(issueSchema.issueSubscribers.subscriberId, user.id)
    ),
  });

  return c.json({ subscribed: !!sub });
});

app.post("/api/workspaces/:slug/projects/:projectId/issues/:issueId/subscribe/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const projectId = c.req.param("projectId");

  const existing = await db.query.issueSubscribers.findFirst({
    where: and(
      eq(issueSchema.issueSubscribers.issueId, issueId),
      eq(issueSchema.issueSubscribers.subscriberId, user.id)
    ),
  });

  if (existing) return c.json({ error: "Already subscribed." }, 400);

  const [created] = await db.insert(issueSchema.issueSubscribers).values({
    issueId,
    subscriberId: user.id,
    projectId,
    workspaceId: workspace.id,
  }).returning();

  return c.json({
    id: created.id,
    issue_id: created.issueId,
    subscriber_id: created.subscriberId,
    created_at: created.createdAt?.toISOString() ?? null,
  }, 201);
});

app.delete("/api/workspaces/:slug/projects/:projectId/issues/:issueId/subscribe/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");

  await db.delete(issueSchema.issueSubscribers).where(
    and(
      eq(issueSchema.issueSubscribers.issueId, issueId),
      eq(issueSchema.issueSubscribers.subscriberId, user.id)
    )
  );

  return c.body(null, 204);
});

app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/issue-subscribers/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");

  const subs = await db
    .select()
    .from(issueSchema.issueSubscribers)
    .where(eq(issueSchema.issueSubscribers.issueId, issueId))
    .orderBy(desc(issueSchema.issueSubscribers.createdAt));

  return c.json(subs.map((s) => ({
    id: s.id,
    issue_id: s.issueId,
    subscriber_id: s.subscriberId,
  })));
});

app.post("/api/workspaces/:slug/projects/:projectId/issues/:issueId/issue-subscribers/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  const existing = await db.query.issueSubscribers.findFirst({
    where: and(
      eq(issueSchema.issueSubscribers.issueId, issueId),
      eq(issueSchema.issueSubscribers.subscriberId, body.subscriber_id)
    ),
  });

  if (existing) return c.json({ error: "Already subscribed." }, 400);

  const [created] = await db.insert(issueSchema.issueSubscribers).values({
    issueId,
    subscriberId: body.subscriber_id,
    projectId,
    workspaceId: workspace.id,
  }).returning();

  return c.json({
    id: created.id,
    issue_id: created.issueId,
    subscriber_id: created.subscriberId,
  }, 201);
});

app.delete("/api/workspaces/:slug/projects/:projectId/issues/:issueId/issue-subscribers/:subscriberId/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const subscriberId = c.req.param("subscriberId");

  await db.delete(issueSchema.issueSubscribers).where(
    and(
      eq(issueSchema.issueSubscribers.issueId, issueId),
      eq(issueSchema.issueSubscribers.subscriberId, subscriberId)
    )
  );

  return c.body(null, 204);
});

// --- Bulk operations ---

app.post("/api/workspaces/:slug/projects/:projectId/issues/bulk-delete-issues/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  if (!body.issue_ids || body.issue_ids.length === 0) {
    return c.json({ error: "issue_ids required" }, 400);
  }

  // Delete related cycle issues
  await db.delete(cycleSchema.cycleIssues).where(inArray(cycleSchema.cycleIssues.issueId, body.issue_ids));
  // Delete related module issues
  await db.delete(moduleSchema.moduleIssues).where(inArray(moduleSchema.moduleIssues.issueId, body.issue_ids));
  // Delete issues
  await db.delete(issueSchema.issues).where(
    and(eq(issueSchema.issues.projectId, projectId), inArray(issueSchema.issues.id, body.issue_ids))
  );

  return c.json({ message: `${body.issue_ids.length} issues were deleted` });
});

app.post("/api/workspaces/:slug/projects/:projectId/issues/bulk-archive-issues/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  // Fetch issues with their state groups
  const toArchive = await db
    .select({ issueId: issueSchema.issues.id, stateGroup: projectSchema.states.group })
    .from(issueSchema.issues)
    .innerJoin(projectSchema.states, eq(issueSchema.issues.stateId, projectSchema.states.id))
    .where(and(eq(issueSchema.issues.projectId, projectId), inArray(issueSchema.issues.id, body.issue_ids)));

  for (const issue of toArchive) {
    if (issue.stateGroup !== "completed" && issue.stateGroup !== "cancelled") {
      return c.json({
        error: "Only completed or cancelled issues can be archived",
        error_code: "INVALID_ARCHIVE_STATE_GROUP",
      }, 400);
    }
  }

  const now = new Date();
  await db
    .update(issueSchema.issues)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(issueSchema.issues.projectId, projectId), inArray(issueSchema.issues.id, body.issue_ids)));

  return c.json({ archived_at: now.toISOString().split("T")[0] });
});

app.post("/api/workspaces/:slug/projects/:projectId/issues/issue-dates/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const projectId = c.req.param("projectId");
  const body = await c.req.json();

  for (const update of body.updates) {
    const startDate = update.start_date ? new Date(update.start_date) : null;
    const targetDate = update.target_date ? new Date(update.target_date) : null;

    if (startDate && targetDate && startDate > targetDate) {
      return c.json({ error: "Start date cannot exceed target date" }, 400);
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (update.start_date !== undefined) updateData.startDate = startDate;
    if (update.target_date !== undefined) updateData.targetDate = targetDate;

    await db.update(issueSchema.issues).set(updateData).where(
      and(eq(issueSchema.issues.id, update.id), eq(issueSchema.issues.projectId, projectId))
    );
  }

  return c.json({ message: "Issues updated successfully" });
});

// --- Issue Meta ---

app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/meta/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const projectId = c.req.param("projectId");

  const issue = await db.query.issues.findFirst({
    where: and(eq(issueSchema.issues.id, issueId), eq(issueSchema.issues.projectId, projectId)),
  });
  if (!issue) return c.json({ detail: "Issue not found." }, 404);

  const proj = await db.query.projects.findFirst({
    where: eq(projectSchema.projects.id, projectId),
  });

  return c.json({
    sequence_id: issue.sequenceId ?? null,
    project_identifier: proj?.identifier ?? null,
  });
});

// --- Setup ---

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

  completedState = { id: createId() };
  await db.insert(projectSchema.states).values({
    id: completedState.id,
    projectId: project.id,
    workspaceId: workspace.id,
    name: "Done",
    color: "#16a34a",
    group: "completed",
  });

  backlogState = { id: createId() };
  await db.insert(projectSchema.states).values({
    id: backlogState.id,
    projectId: project.id,
    workspaceId: workspace.id,
    name: "Backlog",
    color: "#858e96",
    group: "backlog",
  });
});

const baseUrl = () => `/api/workspaces/${workspace.slug}/projects/${project.id}/issues`;

// =====================================================
// Tests
// =====================================================

describe("Sub-Issues", () => {
  test("lists sub-issues of a parent", async () => {
    const parent = await createIssue({ name: "Parent Issue" });
    const child1 = await createIssue({ name: "Child 1", parentId: parent.id, stateId: backlogState.id });
    const child2 = await createIssue({ name: "Child 2", parentId: parent.id, stateId: completedState.id });

    const res = await app.request(`${baseUrl()}/${parent.id}/sub-issues/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sub_issues.length).toBe(2);
    expect(data.state_distribution[backlogState.id]).toBe(1);
    expect(data.state_distribution[completedState.id]).toBe(1);
  });

  test("returns empty sub-issues for issue with no children", async () => {
    const parent = await createIssue({ name: "Lonely Issue" });

    const res = await app.request(`${baseUrl()}/${parent.id}/sub-issues/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sub_issues).toEqual([]);
    expect(data.state_distribution).toEqual({});
  });

  test("assigns sub-issues to parent", async () => {
    const parent = await createIssue({ name: "New Parent" });
    const child = await createIssue({ name: "Orphan" });

    const res = await app.request(`${baseUrl()}/${parent.id}/sub-issues/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ sub_issue_ids: [child.id] }),
    });
    expect(res.status).toBe(200);

    // Verify the child now has parent
    const listRes = await app.request(`${baseUrl()}/${parent.id}/sub-issues/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    const listData = await listRes.json();
    expect(listData.sub_issues.length).toBe(1);
    expect(listData.sub_issues[0].id).toBe(child.id);
  });

  test("rejects empty sub_issue_ids", async () => {
    const parent = await createIssue({ name: "Parent No Kids" });

    const res = await app.request(`${baseUrl()}/${parent.id}/sub-issues/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ sub_issue_ids: [] }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Issue Subscribers - Subscribe/Unsubscribe", () => {
  let testIssue: any;

  beforeAll(async () => {
    testIssue = await createIssue({ name: "Subscribable Issue" });
  });

  test("subscription status is false initially", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/subscribe/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.subscribed).toBe(false);
  });

  test("subscribes to issue", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/subscribe/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.subscriber_id).toBe(testUser.id);
    expect(data.issue_id).toBe(testIssue.id);
  });

  test("subscription status is true after subscribing", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/subscribe/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data.subscribed).toBe(true);
  });

  test("rejects duplicate subscription", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/subscribe/`, {
      method: "POST",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(400);
  });

  test("unsubscribes from issue", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/subscribe/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(204);
  });

  test("subscription status is false after unsubscribing", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/subscribe/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data.subscribed).toBe(false);
  });
});

describe("Issue Subscribers - Management", () => {
  let testIssue: any;

  beforeAll(async () => {
    testIssue = await createIssue({ name: "Managed Subs Issue" });
  });

  test("lists subscribers (empty)", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/issue-subscribers/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  test("adds a subscriber", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/issue-subscribers/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ subscriber_id: otherUser.id }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.subscriber_id).toBe(otherUser.id);
  });

  test("lists subscribers after add", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/issue-subscribers/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].subscriber_id).toBe(otherUser.id);
  });

  test("rejects duplicate subscriber add", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/issue-subscribers/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ subscriber_id: otherUser.id }),
    });
    expect(res.status).toBe(400);
  });

  test("removes a subscriber", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/issue-subscribers/${otherUser.id}/`, {
      method: "DELETE",
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(204);
  });

  test("subscriber is gone after removal", async () => {
    const res = await app.request(`${baseUrl()}/${testIssue.id}/issue-subscribers/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    const data = await res.json();
    expect(data).toEqual([]);
  });
});

describe("Bulk Delete Issues", () => {
  test("bulk deletes issues", async () => {
    const issue1 = await createIssue({ name: "Delete Me 1" });
    const issue2 = await createIssue({ name: "Delete Me 2" });

    const res = await app.request(`${baseUrl()}/bulk-delete-issues/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ issue_ids: [issue1.id, issue2.id] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toContain("2");

    // Verify deleted
    const check = await db.query.issues.findFirst({ where: eq(issueSchema.issues.id, issue1.id) });
    expect(check).toBeUndefined();
  });

  test("cleans up cycle/module relations on bulk delete", async () => {
    const issue = await createIssue({ name: "Issue with relations" });

    // Add to a cycle
    await db.insert(cycleSchema.cycleIssues).values({
      cycleId: createId(),
      issueId: issue.id,
    });

    // Add to a module
    await db.insert(moduleSchema.moduleIssues).values({
      moduleId: createId(),
      issueId: issue.id,
    });

    const res = await app.request(`${baseUrl()}/bulk-delete-issues/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ issue_ids: [issue.id] }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Bulk Archive Issues", () => {
  test("archives completed issues", async () => {
    const issue1 = await createIssue({ name: "Archive 1", stateId: completedState.id });
    const issue2 = await createIssue({ name: "Archive 2", stateId: completedState.id });

    const res = await app.request(`${baseUrl()}/bulk-archive-issues/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ issue_ids: [issue1.id, issue2.id] }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.archived_at).toBeDefined();

    // Verify archived
    const check = await db.query.issues.findFirst({ where: eq(issueSchema.issues.id, issue1.id) });
    expect(check?.archivedAt).toBeDefined();
  });

  test("rejects archiving non-completed issues", async () => {
    const issue = await createIssue({ name: "Not Done", stateId: backlogState.id });

    const res = await app.request(`${baseUrl()}/bulk-archive-issues/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({ issue_ids: [issue.id] }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error_code).toBe("INVALID_ARCHIVE_STATE_GROUP");
  });
});

describe("Bulk Date Update", () => {
  test("updates dates for multiple issues", async () => {
    const issue1 = await createIssue({ name: "Date Issue 1" });
    const issue2 = await createIssue({ name: "Date Issue 2" });

    const res = await app.request(`${baseUrl()}/issue-dates/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({
        updates: [
          { id: issue1.id, start_date: "2025-01-01", target_date: "2025-02-01" },
          { id: issue2.id, start_date: "2025-03-01", target_date: "2025-04-01" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Issues updated successfully");

    // Verify dates
    const check = await db.query.issues.findFirst({ where: eq(issueSchema.issues.id, issue1.id) });
    expect(check?.startDate).toBeDefined();
  });

  test("rejects invalid date range", async () => {
    const issue = await createIssue({ name: "Bad Dates" });

    const res = await app.request(`${baseUrl()}/issue-dates/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user-id": testUser.id },
      body: JSON.stringify({
        updates: [
          { id: issue.id, start_date: "2025-12-01", target_date: "2025-01-01" },
        ],
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Start date");
  });
});

describe("Issue Meta", () => {
  test("returns issue metadata", async () => {
    const issue = await createIssue({ name: "Meta Issue" });

    const res = await app.request(`${baseUrl()}/${issue.id}/meta/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sequence_id).toBeDefined();
    expect(data.project_identifier).toBe("TEST");
  });

  test("returns 404 for non-existent issue", async () => {
    const res = await app.request(`${baseUrl()}/nonexistent/meta/`, {
      headers: { "x-test-user-id": testUser.id },
    });
    expect(res.status).toBe(404);
  });
});

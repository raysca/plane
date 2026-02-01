import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and, or, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../../db/schema/user";
import * as workspaceSchema from "../../db/schema/workspace";
import * as projectSchema from "../../db/schema/project";
import * as issueSchema from "../../db/schema/issue";

const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: {
    ...userSchema,
    ...workspaceSchema,
    ...projectSchema,
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

  CREATE TABLE project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role INTEGER DEFAULT 15,
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

  CREATE TABLE issue_relations (
    id TEXT PRIMARY KEY,
    issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    related_issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL,
    created_at INTEGER,
    UNIQUE(issue_id, related_issue_id, relation_type)
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
`);

// Test data
let testUser: { id: string; email: string; name: string };
let workspace: { id: string; slug: string; name: string };
let project: { id: string; name: string; identifier: string };
let stateId: string;
let issueA: typeof issueSchema.issues.$inferSelect;
let issueB: typeof issueSchema.issues.$inferSelect;
let issueC: typeof issueSchema.issues.$inferSelect;
let issueD: typeof issueSchema.issues.$inferSelect;

function getCurrentUser(c: any) {
  const userId = c.req.header("x-test-user-id");
  if (userId === testUser?.id) return testUser;
  return null;
}

// --- Relation mapping utilities ---
function getActualRelation(relationType: string): string {
  const mapping: Record<string, string> = {
    start_after: "start_before",
    finish_after: "finish_before",
    blocking: "blocked_by",
    blocked_by: "blocked_by",
    start_before: "start_before",
    finish_before: "finish_before",
    implemented_by: "implemented_by",
    implements: "implemented_by",
  };
  return mapping[relationType] ?? relationType;
}

function isReversedRelation(relationType: string): boolean {
  return ["blocking", "start_after", "finish_after", "implements"].includes(relationType);
}

function formatRelatedIssue(
  issue: typeof issueSchema.issues.$inferSelect,
  relationType: string,
  assigneeIds: string[],
  labelIds: string[],
) {
  return {
    id: issue.id,
    name: issue.name,
    state_id: issue.stateId,
    sort_order: issue.sortOrder ?? 65535,
    priority: issue.priority ?? "none",
    sequence_id: issue.sequenceId ?? 0,
    project_id: issue.projectId,
    label_ids: labelIds,
    assignee_ids: assigneeIds,
    created_at: issue.createdAt?.toISOString() ?? null,
    updated_at: issue.updatedAt?.toISOString() ?? null,
    created_by: issue.createdById ?? null,
    updated_by: issue.createdById ?? null,
    relation_type: relationType,
  };
}

const app = new Hono();

// --- LIST relations (grouped by type) ---
app.get("/api/workspaces/:slug/projects/:projectId/issues/:issueId/issue-relation/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");

  const allRelations = await db.query.issueRelations.findMany({
    where: or(
      eq(issueSchema.issueRelations.issueId, issueId),
      eq(issueSchema.issueRelations.relatedIssueId, issueId)
    ),
  });

  const categorized: Record<string, Set<string>> = {
    blocking: new Set(),
    blocked_by: new Set(),
    duplicate: new Set(),
    relates_to: new Set(),
    start_after: new Set(),
    start_before: new Set(),
    finish_after: new Set(),
    finish_before: new Set(),
    implements: new Set(),
    implemented_by: new Set(),
  };

  for (const rel of allRelations) {
    if (rel.relationType === "blocked_by") {
      if (rel.issueId === issueId) categorized.blocked_by.add(rel.relatedIssueId);
      else categorized.blocking.add(rel.issueId);
    } else if (rel.relationType === "duplicate") {
      if (rel.issueId === issueId) categorized.duplicate.add(rel.relatedIssueId);
      else categorized.duplicate.add(rel.issueId);
    } else if (rel.relationType === "relates_to") {
      if (rel.issueId === issueId) categorized.relates_to.add(rel.relatedIssueId);
      else categorized.relates_to.add(rel.issueId);
    } else if (rel.relationType === "start_before") {
      if (rel.issueId === issueId) categorized.start_before.add(rel.relatedIssueId);
      else categorized.start_after.add(rel.issueId);
    } else if (rel.relationType === "finish_before") {
      if (rel.issueId === issueId) categorized.finish_before.add(rel.relatedIssueId);
      else categorized.finish_after.add(rel.issueId);
    } else if (rel.relationType === "implemented_by") {
      if (rel.issueId === issueId) categorized.implemented_by.add(rel.relatedIssueId);
      else categorized.implements.add(rel.issueId);
    }
  }

  const allIssueIds = new Set<string>();
  for (const ids of Object.values(categorized)) {
    for (const id of ids) allIssueIds.add(id);
  }

  if (allIssueIds.size === 0) {
    return c.json({
      blocking: [], blocked_by: [], duplicate: [], relates_to: [],
      start_after: [], start_before: [], finish_after: [], finish_before: [],
      implements: [], implemented_by: [],
    });
  }

  const idsArray = Array.from(allIssueIds);
  const relatedIssues = await db
    .select()
    .from(issueSchema.issues)
    .where(sql`${issueSchema.issues.id} IN (${sql.join(idsArray.map((id) => sql`${id}`), sql`, `)})`);

  const issueMap = new Map(relatedIssues.map((i) => [i.id, i]));

  const assignees = await db
    .select({ issueId: issueSchema.issueAssignees.issueId, assigneeId: issueSchema.issueAssignees.assigneeId })
    .from(issueSchema.issueAssignees)
    .where(sql`${issueSchema.issueAssignees.issueId} IN (${sql.join(idsArray.map((id) => sql`${id}`), sql`, `)})`);

  const assigneeMap = new Map<string, string[]>();
  for (const a of assignees) {
    if (!assigneeMap.has(a.issueId)) assigneeMap.set(a.issueId, []);
    assigneeMap.get(a.issueId)!.push(a.assigneeId);
  }

  const labelRows = await db
    .select({ issueId: issueSchema.issueLabels.issueId, labelId: issueSchema.issueLabels.labelId })
    .from(issueSchema.issueLabels)
    .where(sql`${issueSchema.issueLabels.issueId} IN (${sql.join(idsArray.map((id) => sql`${id}`), sql`, `)})`);

  const labelMap = new Map<string, string[]>();
  for (const l of labelRows) {
    if (!labelMap.has(l.issueId)) labelMap.set(l.issueId, []);
    labelMap.get(l.issueId)!.push(l.labelId);
  }

  const response: Record<string, unknown[]> = {};
  for (const [relType, issueIdSet] of Object.entries(categorized)) {
    response[relType] = Array.from(issueIdSet)
      .map((id) => {
        const issue = issueMap.get(id);
        if (!issue) return null;
        return formatRelatedIssue(issue, relType, assigneeMap.get(id) ?? [], labelMap.get(id) ?? []);
      })
      .filter(Boolean);
  }

  return c.json(response);
});

// --- CREATE relations (bulk) ---
app.post("/api/workspaces/:slug/projects/:projectId/issues/:issueId/issue-relation/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const body = await c.req.json();
  const { relation_type, issues: relatedIssueIds } = body;

  if (!relation_type || !relatedIssueIds?.length) {
    return c.json({ message: "relation_type and issues are required" }, 400);
  }

  const actualRelationType = getActualRelation(relation_type);
  const reversed = isReversedRelation(relation_type);

  const created: (typeof issueSchema.issueRelations.$inferSelect)[] = [];

  for (const relatedId of relatedIssueIds) {
    const srcIssueId = reversed ? relatedId : issueId;
    const dstIssueId = reversed ? issueId : relatedId;

    const existing = await db.query.issueRelations.findFirst({
      where: and(
        eq(issueSchema.issueRelations.issueId, srcIssueId),
        eq(issueSchema.issueRelations.relatedIssueId, dstIssueId),
      ),
    });

    if (!existing) {
      const [result] = await db
        .insert(issueSchema.issueRelations)
        .values({
          id: createId(),
          issueId: srcIssueId,
          relatedIssueId: dstIssueId,
          relationType: actualRelationType,
        })
        .returning();
      created.push(result);
    }
  }

  // Record activity
  await db.insert(issueSchema.issueActivities).values({
    id: createId(),
    issueId,
    projectId: c.req.param("projectId"),
    workspaceId: workspace.id,
    actorId: user.id,
    field: "relation",
    oldValue: null,
    newValue: relation_type,
    verb: "created",
  });

  return c.json(created.map((r) => ({
    id: r.id,
    issue_id: r.issueId,
    related_issue_id: r.relatedIssueId,
    relation_type: r.relationType,
    created_at: r.createdAt?.toISOString() ?? null,
  })), 201);
});

// --- REMOVE relation ---
app.post("/api/workspaces/:slug/projects/:projectId/issues/:issueId/remove-relation/", async (c) => {
  const user = getCurrentUser(c);
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const issueId = c.req.param("issueId");
  const body = await c.req.json();
  const { related_issue, relation_type } = body;

  if (!related_issue) {
    return c.json({ message: "related_issue is required" }, 400);
  }

  const relation = await db.query.issueRelations.findFirst({
    where: or(
      and(
        eq(issueSchema.issueRelations.issueId, related_issue),
        eq(issueSchema.issueRelations.relatedIssueId, issueId),
      ),
      and(
        eq(issueSchema.issueRelations.issueId, issueId),
        eq(issueSchema.issueRelations.relatedIssueId, related_issue),
      ),
    ),
  });

  if (!relation) {
    return c.json({ detail: "Relation not found." }, 404);
  }

  await db.delete(issueSchema.issueRelations).where(eq(issueSchema.issueRelations.id, relation.id));

  await db.insert(issueSchema.issueActivities).values({
    id: createId(),
    issueId,
    projectId: c.req.param("projectId"),
    workspaceId: workspace.id,
    actorId: user.id,
    field: "relation",
    oldValue: relation_type,
    newValue: null,
    verb: "deleted",
  });

  return new Response(null, { status: 204 });
});

// --- Request helper ---
async function makeRequest(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-test-user-id": testUser?.id ?? "",
  };
  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

function issueRelationUrl(issueId: string) {
  return `/api/workspaces/${workspace.slug}/projects/${project.id}/issues/${issueId}/issue-relation/`;
}

function removeRelationUrl(issueId: string) {
  return `/api/workspaces/${workspace.slug}/projects/${project.id}/issues/${issueId}/remove-relation/`;
}

// --- Setup ---
beforeAll(async () => {
  const userId = createId();
  testUser = { id: userId, email: `test-${userId}@test.com`, name: "Test User" };

  await db.insert(userSchema.users).values({
    id: testUser.id,
    email: testUser.email,
    name: testUser.name,
    emailVerified: true,
  });

  const wsId = createId();
  workspace = { id: wsId, slug: `ws-${wsId.slice(0, 8)}`, name: "Test Workspace" };
  await db.insert(workspaceSchema.workspaces).values({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    ownerId: testUser.id,
  });

  const projId = createId();
  project = { id: projId, name: "Test Project", identifier: `TST${projId.slice(0, 3).toUpperCase()}` };
  await db.insert(projectSchema.projects).values({
    id: project.id,
    workspaceId: workspace.id,
    name: project.name,
    identifier: project.identifier,
    createdById: testUser.id,
  });

  stateId = createId();
  await db.insert(projectSchema.states).values({
    id: stateId,
    projectId: project.id,
    workspaceId: workspace.id,
    name: "Open",
    color: "#000",
    group: "started",
  });

  // Create 4 test issues
  const now = new Date();
  const issueValues = [
    { id: createId(), name: "Issue A", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
    { id: createId(), name: "Issue B", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
    { id: createId(), name: "Issue C", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
    { id: createId(), name: "Issue D", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
  ];

  await db.insert(issueSchema.issues).values(issueValues);

  const allIssues = await db.select().from(issueSchema.issues);
  issueA = allIssues.find((i) => i.name === "Issue A")!;
  issueB = allIssues.find((i) => i.name === "Issue B")!;
  issueC = allIssues.find((i) => i.name === "Issue C")!;
  issueD = allIssues.find((i) => i.name === "Issue D")!;

  // Add an assignee to issueB for enrichment testing
  await db.insert(issueSchema.issueAssignees).values({
    id: createId(),
    issueId: issueB.id,
    assigneeId: testUser.id,
  });
});

// --- Tests ---
describe("Issue Relations", () => {
  describe("GET /issue-relation/ - List relations", () => {
    test("returns empty grouped response when no relations exist", async () => {
      const res = await makeRequest("GET", issueRelationUrl(issueA.id));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.blocking).toEqual([]);
      expect(data.blocked_by).toEqual([]);
      expect(data.duplicate).toEqual([]);
      expect(data.relates_to).toEqual([]);
      expect(data.start_after).toEqual([]);
      expect(data.start_before).toEqual([]);
      expect(data.finish_after).toEqual([]);
      expect(data.finish_before).toEqual([]);
    });
  });

  describe("POST /issue-relation/ - Create relations", () => {
    test("can create a blocked_by relation", async () => {
      const res = await makeRequest("POST", issueRelationUrl(issueA.id), {
        relation_type: "blocked_by",
        issues: [issueB.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.length).toBe(1);
      // blocked_by: issueA is blocked_by issueB
      // stored as: issue_id=issueA, related_issue_id=issueB, type=blocked_by
      expect(data[0].issue_id).toBe(issueA.id);
      expect(data[0].related_issue_id).toBe(issueB.id);
      expect(data[0].relation_type).toBe("blocked_by");
    });

    test("can create a blocking relation (reversed storage)", async () => {
      const res = await makeRequest("POST", issueRelationUrl(issueA.id), {
        relation_type: "blocking",
        issues: [issueC.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.length).toBe(1);
      // blocking: issueA blocks issueC
      // stored as: issue_id=issueC, related_issue_id=issueA, type=blocked_by
      expect(data[0].issue_id).toBe(issueC.id);
      expect(data[0].related_issue_id).toBe(issueA.id);
      expect(data[0].relation_type).toBe("blocked_by");
    });

    test("can create a relates_to relation", async () => {
      const res = await makeRequest("POST", issueRelationUrl(issueA.id), {
        relation_type: "relates_to",
        issues: [issueD.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.length).toBe(1);
      expect(data[0].issue_id).toBe(issueA.id);
      expect(data[0].related_issue_id).toBe(issueD.id);
      expect(data[0].relation_type).toBe("relates_to");
    });

    test("can create a duplicate relation", async () => {
      const res = await makeRequest("POST", issueRelationUrl(issueB.id), {
        relation_type: "duplicate",
        issues: [issueC.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.length).toBe(1);
      expect(data[0].relation_type).toBe("duplicate");
    });

    test("can bulk create relations", async () => {
      const res = await makeRequest("POST", issueRelationUrl(issueD.id), {
        relation_type: "blocked_by",
        issues: [issueB.id, issueC.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.length).toBe(2);
    });

    test("skips duplicate relations silently", async () => {
      // issueA is already blocked_by issueB
      const res = await makeRequest("POST", issueRelationUrl(issueA.id), {
        relation_type: "blocked_by",
        issues: [issueB.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.length).toBe(0); // No new relations created
    });

    test("records activity on creation", async () => {
      const activities = await db.query.issueActivities.findMany({
        where: and(
          eq(issueSchema.issueActivities.issueId, issueA.id),
          eq(issueSchema.issueActivities.field, "relation"),
          eq(issueSchema.issueActivities.verb, "created"),
        ),
      });
      expect(activities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /issue-relation/ - List with data", () => {
    test("returns grouped relations for issueA", async () => {
      const res = await makeRequest("GET", issueRelationUrl(issueA.id));
      expect(res.status).toBe(200);
      const data = await res.json();

      // issueA is blocked_by issueB
      expect(data.blocked_by.length).toBe(1);
      expect(data.blocked_by[0].id).toBe(issueB.id);
      expect(data.blocked_by[0].relation_type).toBe("blocked_by");

      // issueA blocks issueC (stored as issueC blocked_by issueA)
      expect(data.blocking.length).toBe(1);
      expect(data.blocking[0].id).toBe(issueC.id);
      expect(data.blocking[0].relation_type).toBe("blocking");

      // issueA relates_to issueD
      expect(data.relates_to.length).toBe(1);
      expect(data.relates_to[0].id).toBe(issueD.id);
    });

    test("returns enriched issue data with assignee_ids", async () => {
      const res = await makeRequest("GET", issueRelationUrl(issueA.id));
      const data = await res.json();

      // issueB has an assignee
      const blockedBy = data.blocked_by.find((i: any) => i.id === issueB.id);
      expect(blockedBy).toBeTruthy();
      expect(blockedBy.assignee_ids).toContain(testUser.id);
      expect(blockedBy.name).toBe("Issue B");
      expect(blockedBy.state_id).toBe(stateId);
      expect(blockedBy.project_id).toBe(project.id);
    });

    test("symmetric relations appear from both sides", async () => {
      // issueD relates_to issueA (from issueA's create)
      const res = await makeRequest("GET", issueRelationUrl(issueD.id));
      const data = await res.json();

      // From issueD's perspective, issueA is in relates_to
      expect(data.relates_to.some((i: any) => i.id === issueA.id)).toBe(true);
    });

    test("blocking/blocked_by are correctly mirrored", async () => {
      // issueC should see issueA in blocked_by (since issueA blocks issueC)
      const res = await makeRequest("GET", issueRelationUrl(issueC.id));
      const data = await res.json();

      expect(data.blocked_by.some((i: any) => i.id === issueA.id)).toBe(true);
    });

    test("duplicate relations appear from both sides", async () => {
      // issueB has duplicate issueC
      const resB = await makeRequest("GET", issueRelationUrl(issueB.id));
      const dataB = await resB.json();
      expect(dataB.duplicate.some((i: any) => i.id === issueC.id)).toBe(true);

      // issueC also sees issueB as duplicate
      const resC = await makeRequest("GET", issueRelationUrl(issueC.id));
      const dataC = await resC.json();
      expect(dataC.duplicate.some((i: any) => i.id === issueB.id)).toBe(true);
    });
  });

  describe("POST /remove-relation/ - Remove relations", () => {
    test("can remove a relation", async () => {
      // Remove the relates_to between issueA and issueD
      const res = await makeRequest("POST", removeRelationUrl(issueA.id), {
        relation_type: "relates_to",
        related_issue: issueD.id,
      });
      expect(res.status).toBe(204);

      // Verify it's gone
      const listRes = await makeRequest("GET", issueRelationUrl(issueA.id));
      const data = await listRes.json();
      expect(data.relates_to.length).toBe(0);
    });

    test("records activity on deletion", async () => {
      const activities = await db.query.issueActivities.findMany({
        where: and(
          eq(issueSchema.issueActivities.issueId, issueA.id),
          eq(issueSchema.issueActivities.field, "relation"),
          eq(issueSchema.issueActivities.verb, "deleted"),
        ),
      });
      expect(activities.length).toBeGreaterThanOrEqual(1);
    });

    test("returns 404 for non-existent relation", async () => {
      const res = await makeRequest("POST", removeRelationUrl(issueA.id), {
        relation_type: "relates_to",
        related_issue: createId(),
      });
      expect(res.status).toBe(404);
    });

    test("can remove blocking relation from either direction", async () => {
      // issueA blocks issueC (stored as issueC blocked_by issueA)
      // Remove from issueA's perspective
      const res = await makeRequest("POST", removeRelationUrl(issueA.id), {
        relation_type: "blocking",
        related_issue: issueC.id,
      });
      expect(res.status).toBe(204);

      // Verify gone from both sides
      const resA = await makeRequest("GET", issueRelationUrl(issueA.id));
      const dataA = await resA.json();
      expect(dataA.blocking.length).toBe(0);

      const resC = await makeRequest("GET", issueRelationUrl(issueC.id));
      const dataC = await resC.json();
      expect(dataC.blocked_by.filter((i: any) => i.id === issueA.id).length).toBe(0);
    });
  });

  describe("Start/Finish before/after relations", () => {
    let sfIssue1: typeof issueSchema.issues.$inferSelect;
    let sfIssue2: typeof issueSchema.issues.$inferSelect;
    let sfIssue3: typeof issueSchema.issues.$inferSelect;
    let sfIssue4: typeof issueSchema.issues.$inferSelect;

    test("setup fresh issues for start/finish tests", async () => {
      const now = new Date();
      const vals = [
        { id: createId(), name: "SF Issue 1", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
        { id: createId(), name: "SF Issue 2", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
        { id: createId(), name: "SF Issue 3", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
        { id: createId(), name: "SF Issue 4", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
      ];
      await db.insert(issueSchema.issues).values(vals);
      const all = await db.select().from(issueSchema.issues).where(sql`${issueSchema.issues.name} LIKE 'SF Issue%'`);
      sfIssue1 = all.find((i) => i.name === "SF Issue 1")!;
      sfIssue2 = all.find((i) => i.name === "SF Issue 2")!;
      sfIssue3 = all.find((i) => i.name === "SF Issue 3")!;
      sfIssue4 = all.find((i) => i.name === "SF Issue 4")!;
    });

    test("can create start_before relation", async () => {
      const res = await makeRequest("POST", issueRelationUrl(sfIssue1.id), {
        relation_type: "start_before",
        issues: [sfIssue2.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data[0].relation_type).toBe("start_before");
      expect(data[0].issue_id).toBe(sfIssue1.id);
      expect(data[0].related_issue_id).toBe(sfIssue2.id);
    });

    test("start_before appears as start_after from the other side", async () => {
      const res = await makeRequest("GET", issueRelationUrl(sfIssue2.id));
      const data = await res.json();
      expect(data.start_after.some((i: any) => i.id === sfIssue1.id)).toBe(true);
    });

    test("can create start_after relation (reversed storage)", async () => {
      const res = await makeRequest("POST", issueRelationUrl(sfIssue3.id), {
        relation_type: "start_after",
        issues: [sfIssue4.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      // start_after is reversed: stored as issue_id=sfIssue4, related_issue_id=sfIssue3, type=start_before
      expect(data[0].relation_type).toBe("start_before");
      expect(data[0].issue_id).toBe(sfIssue4.id);
      expect(data[0].related_issue_id).toBe(sfIssue3.id);
    });

    test("can create finish_before relation", async () => {
      const res = await makeRequest("POST", issueRelationUrl(sfIssue1.id), {
        relation_type: "finish_before",
        issues: [sfIssue3.id],
      });
      expect(res.status).toBe(201);
    });

    test("finish_before appears as finish_after from the other side", async () => {
      const res = await makeRequest("GET", issueRelationUrl(sfIssue3.id));
      const data = await res.json();
      expect(data.finish_after.some((i: any) => i.id === sfIssue1.id)).toBe(true);
    });
  });

  describe("Implemented by/implements relations", () => {
    let implIssue1: typeof issueSchema.issues.$inferSelect;
    let implIssue2: typeof issueSchema.issues.$inferSelect;
    let implIssue3: typeof issueSchema.issues.$inferSelect;
    let implIssue4: typeof issueSchema.issues.$inferSelect;

    test("setup fresh issues for implements tests", async () => {
      const now = new Date();
      const vals = [
        { id: createId(), name: "Impl Issue 1", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
        { id: createId(), name: "Impl Issue 2", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
        { id: createId(), name: "Impl Issue 3", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
        { id: createId(), name: "Impl Issue 4", projectId: project.id, workspaceId: workspace.id, stateId, createdById: testUser.id, createdAt: now, updatedAt: now },
      ];
      await db.insert(issueSchema.issues).values(vals);
      const all = await db.select().from(issueSchema.issues).where(sql`${issueSchema.issues.name} LIKE 'Impl Issue%'`);
      implIssue1 = all.find((i) => i.name === "Impl Issue 1")!;
      implIssue2 = all.find((i) => i.name === "Impl Issue 2")!;
      implIssue3 = all.find((i) => i.name === "Impl Issue 3")!;
      implIssue4 = all.find((i) => i.name === "Impl Issue 4")!;
    });

    test("can create implemented_by relation", async () => {
      const res = await makeRequest("POST", issueRelationUrl(implIssue1.id), {
        relation_type: "implemented_by",
        issues: [implIssue2.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data[0].relation_type).toBe("implemented_by");
    });

    test("implemented_by appears as implements from the other side", async () => {
      const res = await makeRequest("GET", issueRelationUrl(implIssue2.id));
      const data = await res.json();
      expect(data.implements.some((i: any) => i.id === implIssue1.id)).toBe(true);
    });

    test("can create implements relation (reversed storage)", async () => {
      const res = await makeRequest("POST", issueRelationUrl(implIssue3.id), {
        relation_type: "implements",
        issues: [implIssue4.id],
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      // implements is reversed: stored as issue_id=implIssue4, related_issue_id=implIssue3, type=implemented_by
      expect(data[0].relation_type).toBe("implemented_by");
      expect(data[0].issue_id).toBe(implIssue4.id);
    });
  });

  describe("Edge cases", () => {
    test("requires authentication", async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const res = await app.request(issueRelationUrl(issueA.id), { method: "GET", headers });
      expect(res.status).toBe(401);
    });

    test("returns 400 for missing fields on create", async () => {
      const res = await makeRequest("POST", issueRelationUrl(issueA.id), {
        relation_type: "blocked_by",
        // missing issues
      });
      expect(res.status).toBe(400);
    });
  });
});

import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, or, gte, isNull, desc } from "drizzle-orm";
import { db } from "../../db";
import { users, userProfiles } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers, states } from "../../db/schema/project";
import { issues, issueAssignees, issueLabels, issueActivities } from "../../db/schema/issue";
import { intakes, intakeIssues } from "../../db/schema/intake";
import { createId } from "@paralleldrive/cuid2";

// Test IDs
let workspaceId: string;
let projectId: string;
let adminUserId: string;
let memberUserId: string;
let guestUserId: string;
let triageStateId: string;
let defaultStateId: string;
let intakeId: string;

// Build inline app with fake auth middleware (matches project test conventions)
const app = new Hono();

app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  const role = parseInt(c.req.header("x-test-role") || "20");
  if (!uid) return c.json({ detail: "Unauthorized" }, 401);
  c.set("user" as any, { id: uid, email: "test@test.com", name: "Test" });
  c.set("session" as any, { id: "s1", userId: uid, expiresAt: new Date() });
  c.set("workspace" as any, { id: workspaceId, name: "Test WS", slug: "test-ws", ownerId: adminUserId });
  c.set("workspaceMembership" as any, { id: "wm", workspaceId, userId: uid, role });
  c.set("project" as any, { id: projectId, name: "Test Project", workspaceId, identifier: "TP", network: 2 });
  c.set("projectMembership" as any, { id: "pm", projectId, memberId: uid, role });
  await next();
});

// ---- Inline route handlers (mirroring the real intake routes) ----

const priorityMap: Record<string, number> = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 };

async function getOrCreateIntake(pId: string, wsId: string) {
  let intake = await db.query.intakes.findFirst({
    where: and(eq(intakes.projectId, pId), isNull(intakes.deletedAt)),
  });
  if (!intake) {
    const [n] = await db.insert(intakes).values({ projectId: pId, workspaceId: wsId, name: "Intake", isDefault: true }).returning();
    intake = n;
  }
  return intake;
}

async function getOrCreateTriageState(pId: string, wsId: string) {
  let state = await db.query.states.findFirst({
    where: and(eq(states.projectId, pId), eq(states.group, "triage")),
  });
  if (!state) {
    const [n] = await db.insert(states).values({ projectId: pId, workspaceId: wsId, name: "Triage", group: "triage", color: "#4E5355", sequence: 65000, isDefault: false }).returning();
    state = n;
  }
  return state;
}

async function enrichIntakeIssue(ii: typeof intakeIssues.$inferSelect) {
  const issueData = await db.query.issues.findFirst({ where: eq(issues.id, ii.issueId) });
  const aRows = await db.select({ assigneeId: issueAssignees.assigneeId }).from(issueAssignees).where(eq(issueAssignees.issueId, ii.issueId));
  const lRows = await db.select({ labelId: issueLabels.labelId }).from(issueLabels).where(eq(issueLabels.issueId, ii.issueId));
  let stateGroup = "backlog";
  if (issueData?.stateId) {
    const s = await db.query.states.findFirst({ where: eq(states.id, issueData.stateId) });
    if (s) stateGroup = s.group;
  }
  let dup = null;
  if (ii.duplicateToId) {
    const d = await db.query.issues.findFirst({ where: eq(issues.id, ii.duplicateToId) });
    if (d) dup = { id: d.id, sequence_id: d.sequenceId, name: d.name };
  }
  return {
    id: ii.id, status: ii.status ?? -2, snoozed_till: ii.snoozedTill?.toISOString() ?? null,
    duplicate_to: ii.duplicateToId ?? null, source: ii.source ?? "IN_APP",
    created_by: ii.createdById ?? null, created_at: ii.createdAt?.toISOString() ?? null,
    updated_at: ii.updatedAt?.toISOString() ?? null, project: ii.projectId, workspace: ii.workspaceId,
    intake: ii.intakeId, inbox: ii.intakeId, issue: ii.issueId,
    issue_detail: issueData ? {
      id: issueData.id, name: issueData.name, description_html: issueData.descriptionHtml ?? "",
      priority: issueData.priority ?? 0, state_id: issueData.stateId ?? null, state__group: stateGroup,
      project_id: issueData.projectId, workspace_id: issueData.workspaceId,
      assignee_ids: aRows.map(r => r.assigneeId), label_ids: lRows.map(r => r.labelId),
      created_by: issueData.createdById ?? null, created_at: issueData.createdAt?.toISOString() ?? null,
      updated_at: issueData.updatedAt?.toISOString() ?? null,
    } : null,
    duplicate_issue_detail: dup,
  };
}

// GET /
app.get("/intake-issues/", async (c) => {
  const project = c.get("project" as any) as any;
  const workspace = c.get("workspace" as any) as any;
  const fullProject = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
  if (!fullProject?.intakeView) return c.json({ results: [], total_results: 0 });
  const intake = await db.query.intakes.findFirst({ where: and(eq(intakes.projectId, project.id), isNull(intakes.deletedAt)) });
  if (!intake) return c.json({ results: [], total_results: 0 });
  const now = new Date();
  const rows = await db.select().from(intakeIssues).where(
    and(eq(intakeIssues.intakeId, intake.id), eq(intakeIssues.projectId, project.id),
      or(gte(intakeIssues.snoozedTill, now), isNull(intakeIssues.snoozedTill)))
  ).orderBy(desc(intakeIssues.createdAt));
  const results = await Promise.all(rows.map(enrichIntakeIssue));
  return c.json({ results, total_results: results.length });
});

// POST /
const createSchema = z.object({
  source: z.string().optional().default("IN_APP"),
  issue: z.object({ name: z.string().min(1), description_html: z.string().optional().nullable(), priority: z.enum(["none","low","medium","high","urgent"]).optional().default("none") }),
}).passthrough();

app.post("/intake-issues/", zValidator("json", createSchema), async (c) => {
  const project = c.get("project" as any) as any;
  const workspace = c.get("workspace" as any) as any;
  const user = c.get("user" as any) as any;
  const body = c.req.valid("json");
  const fullProject = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
  if (!fullProject?.intakeView) return c.json({ error: "Intake is not enabled" }, 400);
  if (!body.issue?.name) return c.json({ error: "Name is required" }, 400);
  const intake = await getOrCreateIntake(project.id, workspace.id);
  const triageState = await getOrCreateTriageState(project.id, workspace.id);
  const [newIssue] = await db.insert(issues).values({
    projectId: project.id, workspaceId: workspace.id, stateId: triageState.id,
    name: body.issue.name, descriptionHtml: body.issue.description_html ?? "<p></p>",
    priority: priorityMap[body.issue.priority || "none"] ?? 0, createdById: user.id,
  }).returning();
  const [ii] = await db.insert(intakeIssues).values({
    intakeId: intake.id, issueId: newIssue.id, projectId: project.id, workspaceId: workspace.id,
    source: body.source || "IN_APP", createdById: user.id,
  }).returning();
  await db.insert(issueActivities).values({ issueId: newIssue.id, projectId: project.id, workspaceId: workspace.id, actorId: user.id, verb: "created", field: "issue" });
  const result = await enrichIntakeIssue(ii);
  return c.json(result, 201);
});

// GET /:issueId/
app.get("/intake-issues/:issueId/", async (c) => {
  const project = c.get("project" as any) as any;
  const issueId = c.req.param("issueId");
  const fullProject = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
  if (!fullProject?.intakeView) return c.json({ detail: "Not found." }, 404);
  const intake = await db.query.intakes.findFirst({ where: and(eq(intakes.projectId, project.id), isNull(intakes.deletedAt)) });
  if (!intake) return c.json({ detail: "Not found." }, 404);
  const ii = await db.query.intakeIssues.findFirst({
    where: and(eq(intakeIssues.issueId, issueId), eq(intakeIssues.intakeId, intake.id), eq(intakeIssues.projectId, project.id)),
  });
  if (!ii) return c.json({ detail: "Not found." }, 404);
  const result = await enrichIntakeIssue(ii);
  return c.json(result);
});

// PATCH /:issueId/
const updateSchema = z.object({
  status: z.number().int().min(-2).max(2).optional(),
  snoozed_till: z.string().optional().nullable(),
  duplicate_to: z.string().optional().nullable(),
  issue: z.object({ name: z.string().optional(), description_html: z.string().optional().nullable(), priority: z.union([z.string(), z.number()]).optional(), state_id: z.string().optional().nullable() }).optional(),
}).passthrough();

app.patch("/intake-issues/:issueId/", zValidator("json", updateSchema), async (c) => {
  const project = c.get("project" as any) as any;
  const workspace = c.get("workspace" as any) as any;
  const user = c.get("user" as any) as any;
  const membership = c.get("projectMembership" as any) as any;
  const issueId = c.req.param("issueId");
  const body = c.req.valid("json");
  const fullProject = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
  if (!fullProject?.intakeView) return c.json({ error: "Intake is not enabled" }, 400);
  const intake = await db.query.intakes.findFirst({ where: and(eq(intakes.projectId, project.id), isNull(intakes.deletedAt)) });
  if (!intake) return c.json({ detail: "Not found." }, 404);
  const ii = await db.query.intakeIssues.findFirst({
    where: and(eq(intakeIssues.issueId, issueId), eq(intakeIssues.intakeId, intake.id), eq(intakeIssues.projectId, project.id)),
  });
  if (!ii) return c.json({ detail: "Not found." }, 404);

  // Guest can only edit if creator
  if (membership.role <= 5 && ii.createdById !== user.id) return c.json({ error: "You cannot edit intake work items" }, 400);

  // Update issue data
  if (body.issue) {
    const upd: Record<string, any> = {};
    if (body.issue.name !== undefined) upd.name = body.issue.name;
    if (body.issue.description_html !== undefined) upd.descriptionHtml = body.issue.description_html;
    if (body.issue.priority !== undefined && membership.role > 5) {
      upd.priority = typeof body.issue.priority === "string" ? (priorityMap[body.issue.priority] ?? 0) : body.issue.priority;
    }
    if (body.issue.state_id !== undefined && membership.role > 5) upd.stateId = body.issue.state_id;
    if (Object.keys(upd).length > 0) {
      upd.updatedAt = new Date();
      await db.update(issues).set(upd).where(eq(issues.id, issueId));
    }
  }

  // Update intake issue (admins/members only)
  if (membership.role > 15) {
    const intakeUpd: Record<string, any> = {};
    if (body.status !== undefined) {
      if (body.status === 1) {
        const issue = await db.query.issues.findFirst({ where: eq(issues.id, issueId) });
        if (issue?.stateId) {
          const curState = await db.query.states.findFirst({ where: eq(states.id, issue.stateId) });
          if (curState?.group === "triage") {
            const defState = await db.query.states.findFirst({ where: and(eq(states.projectId, project.id), eq(states.isDefault, true)) });
            if (!defState) return c.json({ error: "No default state found" }, 400);
            await db.update(issues).set({ stateId: defState.id, updatedAt: new Date() }).where(eq(issues.id, issueId));
          }
        }
      }
      intakeUpd.status = body.status;
    }
    if (body.snoozed_till !== undefined) intakeUpd.snoozedTill = body.snoozed_till ? new Date(body.snoozed_till) : null;
    if (body.duplicate_to !== undefined) intakeUpd.duplicateToId = body.duplicate_to;
    if (Object.keys(intakeUpd).length > 0) {
      intakeUpd.updatedAt = new Date();
      await db.update(intakeIssues).set(intakeUpd).where(eq(intakeIssues.id, ii.id));
    }
  }

  const updated = await db.query.intakeIssues.findFirst({ where: eq(intakeIssues.id, ii.id) });
  if (!updated) return c.json({ detail: "Not found." }, 404);
  return c.json(await enrichIntakeIssue(updated));
});

// DELETE /:issueId/
app.delete("/intake-issues/:issueId/", async (c) => {
  const project = c.get("project" as any) as any;
  const user = c.get("user" as any) as any;
  const issueId = c.req.param("issueId");
  const fullProject = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
  if (!fullProject?.intakeView) return c.json({ error: "Intake is not enabled" }, 400);
  const intake = await db.query.intakes.findFirst({ where: and(eq(intakes.projectId, project.id), isNull(intakes.deletedAt)) });
  if (!intake) return c.json({ detail: "Not found." }, 404);
  const ii = await db.query.intakeIssues.findFirst({
    where: and(eq(intakeIssues.issueId, issueId), eq(intakeIssues.intakeId, intake.id), eq(intakeIssues.projectId, project.id)),
  });
  if (!ii) return c.json({ detail: "Not found." }, 404);

  // If not accepted, delete the underlying issue too
  if (ii.status !== 1) {
    const issue = await db.query.issues.findFirst({ where: eq(issues.id, issueId) });
    if (issue && issue.createdById !== user.id) {
      const isAdmin = await db.query.projectMembers.findFirst({
        where: and(eq(projectMembers.projectId, project.id), eq(projectMembers.memberId, user.id), eq(projectMembers.role, 20), eq(projectMembers.isActive, true)),
      });
      if (!isAdmin) return c.json({ error: "Only admin or creator can delete" }, 403);
    }
    if (issue) await db.delete(issues).where(eq(issues.id, issueId));
  }
  await db.delete(intakeIssues).where(eq(intakeIssues.id, ii.id));
  return c.body(null, 204);
});

// ---- Test Setup ----

beforeAll(async () => {
  // Create users
  adminUserId = createId();
  memberUserId = createId();
  guestUserId = createId();

  await db.insert(users).values([
    { id: adminUserId, email: `intake-admin-${adminUserId}@test.com`, name: "Admin", emailVerified: true },
    { id: memberUserId, email: `intake-member-${memberUserId}@test.com`, name: "Member", emailVerified: true },
    { id: guestUserId, email: `intake-guest-${guestUserId}@test.com`, name: "Guest", emailVerified: true },
  ]);

  // Create workspace
  workspaceId = createId();
  await db.insert(workspaces).values({ id: workspaceId, name: "Intake Test WS", slug: `intake-test-${workspaceId}`, ownerId: adminUserId });
  await db.insert(workspaceMembers).values([
    { workspaceId, userId: adminUserId, role: 20 },
    { workspaceId, userId: memberUserId, role: 15 },
    { workspaceId, userId: guestUserId, role: 15 },
  ]);

  // Create project with intake_view enabled
  projectId = createId();
  await db.insert(projects).values({
    id: projectId, workspaceId, name: "Intake Test", identifier: `IT${projectId.slice(0,3)}`.toUpperCase(),
    intakeView: true, createdById: adminUserId,
  });
  await db.insert(projectMembers).values([
    { projectId, memberId: adminUserId, role: 20 },
    { projectId, memberId: memberUserId, role: 15 },
    { projectId, memberId: guestUserId, role: 5 },
  ]);

  // Create triage state
  triageStateId = createId();
  await db.insert(states).values({
    id: triageStateId, projectId, workspaceId, name: "Triage", group: "triage",
    color: "#4E5355", sequence: 65000, isDefault: false,
  });

  // Create default state
  defaultStateId = createId();
  await db.insert(states).values({
    id: defaultStateId, projectId, workspaceId, name: "Backlog", group: "backlog",
    color: "#A3A3A3", sequence: 1000, isDefault: true,
  });

  // Create intake
  intakeId = createId();
  await db.insert(intakes).values({
    id: intakeId, projectId, workspaceId, name: "Intake", isDefault: true,
  });
});

function makeRequest(method: string, path: string, options: { userId?: string; role?: number; body?: any } = {}) {
  const headers: Record<string, string> = {
    "x-test-user": options.userId || adminUserId,
    "x-test-role": String(options.role ?? 20),
  };
  if (options.body) headers["Content-Type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

// ---- Tests ----

describe("Intake Issues", () => {
  let createdIssueId: string;
  let createdIntakeIssueId: string;

  describe("POST /intake-issues/ - Create", () => {
    test("creates an intake issue", async () => {
      const res = await makeRequest("POST", "/intake-issues/", {
        body: { source: "IN_APP", issue: { name: "Bug: login broken", priority: "high" } },
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
      expect(data.status).toBe(-2); // Pending
      expect(data.source).toBe("IN_APP");
      expect(data.issue_detail).toBeDefined();
      expect(data.issue_detail.name).toBe("Bug: login broken");
      expect(data.issue_detail.priority).toBe(2); // high
      expect(data.issue_detail.state__group).toBe("triage");
      createdIssueId = data.issue;
      createdIntakeIssueId = data.id;
    });

    test("creates issue with default priority", async () => {
      const res = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { name: "Feature request" } },
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.issue_detail.priority).toBe(0); // none
    });

    test("returns 400 when name is missing", async () => {
      const res = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { priority: "low" } },
      });
      expect(res.status).toBe(400);
    });

    test("member can create intake issue", async () => {
      const res = await makeRequest("POST", "/intake-issues/", {
        userId: memberUserId,
        role: 15,
        body: { issue: { name: "Member created issue" } },
      });
      expect(res.status).toBe(201);
    });

    test("guest can create intake issue", async () => {
      const res = await makeRequest("POST", "/intake-issues/", {
        userId: guestUserId,
        role: 5,
        body: { issue: { name: "Guest created issue" } },
      });
      expect(res.status).toBe(201);
    });
  });

  describe("GET /intake-issues/ - List", () => {
    test("lists intake issues", async () => {
      const res = await makeRequest("GET", "/intake-issues/");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toBeArray();
      expect(data.results.length).toBeGreaterThanOrEqual(1);
      expect(data.total_results).toBeGreaterThanOrEqual(1);
    });

    test("each result has issue_detail", async () => {
      const res = await makeRequest("GET", "/intake-issues/");
      const data = await res.json();
      for (const item of data.results) {
        expect(item.issue_detail).toBeDefined();
        expect(item.issue_detail.name).toBeDefined();
        expect(item.status).toBeDefined();
      }
    });
  });

  describe("GET /intake-issues/:issueId/ - Retrieve", () => {
    test("retrieves a specific intake issue", async () => {
      const res = await makeRequest("GET", `/intake-issues/${createdIssueId}/`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(createdIntakeIssueId);
      expect(data.issue_detail.name).toBe("Bug: login broken");
    });

    test("returns 404 for non-existent issue", async () => {
      const res = await makeRequest("GET", `/intake-issues/${createId()}/`);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /intake-issues/:issueId/ - Update", () => {
    test("admin can update issue data", async () => {
      const res = await makeRequest("PATCH", `/intake-issues/${createdIssueId}/`, {
        body: { issue: { name: "Bug: login broken (updated)", priority: "urgent" } },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.issue_detail.name).toBe("Bug: login broken (updated)");
      expect(data.issue_detail.priority).toBe(1); // urgent
    });

    test("admin can accept intake issue (status=1)", async () => {
      // Create a fresh issue to accept
      const createRes = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { name: "Issue to accept" } },
      });
      const created = await createRes.json();

      const res = await makeRequest("PATCH", `/intake-issues/${created.issue}/`, {
        body: { status: 1 },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe(1);
      // Issue should now be in default state (backlog)
      expect(data.issue_detail.state_id).toBe(defaultStateId);
      expect(data.issue_detail.state__group).toBe("backlog");
    });

    test("admin can reject intake issue (status=-1)", async () => {
      const createRes = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { name: "Issue to reject" } },
      });
      const created = await createRes.json();

      const res = await makeRequest("PATCH", `/intake-issues/${created.issue}/`, {
        body: { status: -1 },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).status).toBe(-1);
    });

    test("admin can mark as duplicate (status=2)", async () => {
      const createRes = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { name: "Duplicate issue" } },
      });
      const created = await createRes.json();

      const res = await makeRequest("PATCH", `/intake-issues/${created.issue}/`, {
        body: { status: 2, duplicate_to: createdIssueId },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe(2);
      expect(data.duplicate_to).toBe(createdIssueId);
    });

    test("admin can snooze intake issue", async () => {
      const createRes = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { name: "Issue to snooze" } },
      });
      const created = await createRes.json();
      const futureDateStr = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const res = await makeRequest("PATCH", `/intake-issues/${created.issue}/`, {
        body: { status: 0, snoozed_till: futureDateStr },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe(0);
      expect(data.snoozed_till).not.toBeNull();
    });

    test("guest cannot edit other user's intake issue", async () => {
      const res = await makeRequest("PATCH", `/intake-issues/${createdIssueId}/`, {
        userId: guestUserId,
        role: 5,
        body: { issue: { name: "Hacked name" } },
      });
      expect(res.status).toBe(400);
    });

    test("guest can edit own intake issue name/description", async () => {
      // Guest creates their own issue
      const createRes = await makeRequest("POST", "/intake-issues/", {
        userId: guestUserId,
        role: 5,
        body: { issue: { name: "Guest's issue" } },
      });
      const created = await createRes.json();

      const res = await makeRequest("PATCH", `/intake-issues/${created.issue}/`, {
        userId: guestUserId,
        role: 5,
        body: { issue: { name: "Guest updated name" } },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).issue_detail.name).toBe("Guest updated name");
    });

    test("member cannot change intake issue status", async () => {
      const createRes = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { name: "Status test" } },
      });
      const created = await createRes.json();

      // Member (role 15) cannot change status (requires > 15)
      const res = await makeRequest("PATCH", `/intake-issues/${created.issue}/`, {
        userId: memberUserId,
        role: 15,
        body: { status: 1 },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      // Status should remain unchanged (-2 pending)
      expect(data.status).toBe(-2);
    });
  });

  describe("DELETE /intake-issues/:issueId/ - Delete", () => {
    test("admin can delete pending intake issue (also deletes issue)", async () => {
      const createRes = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { name: "To be deleted" } },
      });
      const created = await createRes.json();

      const res = await makeRequest("DELETE", `/intake-issues/${created.issue}/`);
      expect(res.status).toBe(204);

      // Verify the issue is gone
      const issue = await db.query.issues.findFirst({ where: eq(issues.id, created.issue) });
      expect(issue).toBeUndefined();
    });

    test("creator can delete their own intake issue", async () => {
      const createRes = await makeRequest("POST", "/intake-issues/", {
        userId: memberUserId,
        role: 15,
        body: { issue: { name: "Member's issue to delete" } },
      });
      const created = await createRes.json();

      const res = await makeRequest("DELETE", `/intake-issues/${created.issue}/`, {
        userId: memberUserId,
        role: 15,
      });
      expect(res.status).toBe(204);
    });

    test("non-admin non-creator cannot delete", async () => {
      // Admin creates it
      const createRes = await makeRequest("POST", "/intake-issues/", {
        body: { issue: { name: "Admin's issue" } },
      });
      const created = await createRes.json();

      // Member (non-admin, non-creator) tries to delete
      const res = await makeRequest("DELETE", `/intake-issues/${created.issue}/`, {
        userId: memberUserId,
        role: 15,
      });
      expect(res.status).toBe(403);
    });

    test("returns 404 for non-existent issue", async () => {
      const res = await makeRequest("DELETE", `/intake-issues/${createId()}/`);
      expect(res.status).toBe(404);
    });
  });

  describe("Intake disabled", () => {
    let disabledProjectId: string;

    beforeAll(async () => {
      disabledProjectId = createId();
      await db.insert(projects).values({
        id: disabledProjectId, workspaceId, name: "No Intake", identifier: `NI${disabledProjectId.slice(0,3)}`.toUpperCase(),
        intakeView: false, createdById: adminUserId,
      });
      await db.insert(projectMembers).values({ projectId: disabledProjectId, memberId: adminUserId, role: 20 });
    });

    test("list returns empty when intake is disabled", async () => {
      // Override project in middleware for this test
      const testApp = new Hono();
      testApp.use("*", async (c, next) => {
        c.set("user" as any, { id: adminUserId });
        c.set("project" as any, { id: disabledProjectId, name: "No Intake", workspaceId, identifier: "NI", network: 2 });
        c.set("projectMembership" as any, { id: "pm", projectId: disabledProjectId, memberId: adminUserId, role: 20 });
        c.set("workspace" as any, { id: workspaceId, name: "Test WS", slug: "test-ws", ownerId: adminUserId });
        await next();
      });
      testApp.get("/", async (c) => {
        const project = c.get("project" as any) as any;
        const fullProject = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
        if (!fullProject?.intakeView) return c.json({ results: [], total_results: 0 });
        return c.json({ results: [] });
      });

      const res = await testApp.request("/");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toEqual([]);
      expect(data.total_results).toBe(0);
    });

    test("create returns 400 when intake is disabled", async () => {
      const testApp = new Hono();
      testApp.use("*", async (c, next) => {
        c.set("user" as any, { id: adminUserId });
        c.set("project" as any, { id: disabledProjectId, name: "No Intake", workspaceId, identifier: "NI", network: 2 });
        c.set("projectMembership" as any, { id: "pm", projectId: disabledProjectId, memberId: adminUserId, role: 20 });
        c.set("workspace" as any, { id: workspaceId, name: "Test WS", slug: "test-ws", ownerId: adminUserId });
        await next();
      });
      testApp.post("/", zValidator("json", createSchema), async (c) => {
        const project = c.get("project" as any) as any;
        const fullProject = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
        if (!fullProject?.intakeView) return c.json({ error: "Intake is not enabled" }, 400);
        return c.json({}, 201);
      });

      const res = await testApp.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue: { name: "Test" } }),
      });
      expect(res.status).toBe(400);
    });
  });
});

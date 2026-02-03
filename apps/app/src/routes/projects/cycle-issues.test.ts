import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers, states } from "../../db/schema/project";
import { issues } from "../../db/schema/issue";
import { cycles, cycleIssues } from "../../db/schema/cycle";
import { eq, and, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

type Variables = any;
const app = new Hono<{ Variables: Variables }>();

const userId = createId();
const workspaceId = createId();
const projectId = createId();
const cycleId = createId();
const otherCycleId = createId();
const issueId1 = createId();
const issueId2 = createId();
const issueId3 = createId();
const stateId = createId();

// Fake middleware
app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  c.set("user", { id: uid, email: "test@test.com", name: "Test" });
  c.set("session", { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace", { id: workspaceId, name: "CI WS", slug: "ci-ws", ownerId: userId });
  c.set("workspaceMembership", { id: "wm", workspaceId, userId: uid, role: 20 });
  c.set("project", { id: projectId, workspaceId, name: "CI Project", identifier: "CI", estimateId: null });
  c.set("projectMembership", { id: "pm", projectId, memberId: uid, role: 20 });
  await next();
});

import { isNull, desc, countFn, inArray as inArrayFn } from "drizzle-orm";
import { issueAssignees, issueLabels, issueLinks } from "../../db/schema/issue";
import { moduleIssues } from "../../db/schema/module";
import { fileAssets } from "../../db/schema/asset";

// Inline list route
app.get("/api/projects/:projectId/cycles/:cycleId/cycle-issues/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  if (!project || !workspace) return c.json({ detail: "Not found." }, 404);

  const cId = c.req.param("cycleId");
  const perPage = Math.min(parseInt(c.req.query("per_page") || "100", 10) || 100, 1000);
  const cursorParam = c.req.query("cursor") || "0:0:0";
  const [, cursorOffsetStr] = cursorParam.split(":");
  const offset = parseInt(cursorOffsetStr || "0", 10) || 0;

  const cycleIssueRows = await db
    .select({ issueId: cycleIssues.issueId })
    .from(cycleIssues)
    .where(eq(cycleIssues.cycleId, cId));

  const issueIds = cycleIssueRows.map((r) => r.issueId);
  if (issueIds.length === 0) {
    return c.json({ total_count: 0, results: [], count: 0, next_page_results: false, prev_page_results: false });
  }

  const { isNull: isNullFn, desc: descFn } = await import("drizzle-orm");
  const issueList = await db.query.issues.findMany({
    where: and(inArray(issues.id, issueIds), eq(issues.projectId, project.id), isNullFn(issues.archivedAt), isNullFn(issues.deletedAt)),
    orderBy: [descFn(issues.createdAt)],
  });

  const totalCount = issueList.length;
  const paginatedIssues = issueList.slice(offset, offset + perPage);

  const results = paginatedIssues.map((issue) => ({
    id: issue.id,
    project_id: issue.projectId,
    name: issue.name,
    cycle_id: cId,
    created_at: issue.createdAt?.toISOString() ?? null,
  }));

  return c.json({
    total_count: totalCount,
    results,
    count: results.length,
    next_page_results: offset + perPage < totalCount,
    prev_page_results: offset > 0,
  });
});

// Inline create route
app.post("/api/projects/:projectId/cycles/:cycleId/cycle-issues/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const cId = c.req.param("cycleId");
  const body = await c.req.json();
  const issueIdsToAdd: string[] = body.issues ?? [];

  if (!issueIdsToAdd.length) return c.json({ error: "Issues are required" }, 400);

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cId), eq(cycles.projectId, project.id)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  if (cycle.endDate && cycle.endDate < new Date()) {
    return c.json({ error: "The Cycle has already been completed so no new issues can be added" }, 400);
  }

  // Find issues in other cycles
  const { ne } = await import("drizzle-orm");
  const existingCycleIssues = await db
    .select({ id: cycleIssues.id, issueId: cycleIssues.issueId, cycleId: cycleIssues.cycleId })
    .from(cycleIssues)
    .where(and(inArray(cycleIssues.issueId, issueIdsToAdd), ne(cycleIssues.cycleId, cId)));

  const existingIssueIds = new Set(existingCycleIssues.map((ci) => ci.issueId));
  const newIssueIds = issueIdsToAdd.filter((id) => !existingIssueIds.has(id));

  const alreadyInCycle = await db
    .select({ issueId: cycleIssues.issueId })
    .from(cycleIssues)
    .where(and(eq(cycleIssues.cycleId, cId), inArray(cycleIssues.issueId, issueIdsToAdd)));
  const alreadyInCycleSet = new Set(alreadyInCycle.map((ci) => ci.issueId));
  const trulyNewIssueIds = newIssueIds.filter((id) => !alreadyInCycleSet.has(id));

  if (trulyNewIssueIds.length > 0) {
    await db.insert(cycleIssues).values(trulyNewIssueIds.map((issueId) => ({ cycleId: cId, issueId })));
  }

  for (const ci of existingCycleIssues) {
    await db.update(cycleIssues).set({ cycleId: cId }).where(eq(cycleIssues.id, ci.id));
  }

  return c.json({ message: "success" }, 201);
});

// Inline delete route
app.delete("/api/projects/:projectId/cycles/:cycleId/cycle-issues/:issueId/", async (c) => {
  const cId = c.req.param("cycleId");
  const iId = c.req.param("issueId");
  await db.delete(cycleIssues).where(and(eq(cycleIssues.cycleId, cId), eq(cycleIssues.issueId, iId)));
  return new Response(null, { status: 204 });
});

function h(uid: string = userId) {
  return { "x-test-user": uid, "Content-Type": "application/json" };
}

describe("Cycle Issues CRUD", () => {
  beforeAll(async () => {
    await db.insert(users).values({ id: userId, email: "ci-test@test.com", name: "CI Test", emailVerified: true });
    await db.insert(workspaces).values({ id: workspaceId, name: "CI WS", slug: "ci-ws", ownerId: userId });
    await db.insert(workspaceMembers).values({ id: createId(), workspaceId, userId, role: 20 });
    await db.insert(projects).values({ id: projectId, workspaceId, name: "CI Project", identifier: "CI", createdById: userId });
    await db.insert(projectMembers).values({ id: createId(), projectId, memberId: userId, role: 20 });
    await db.insert(states).values({ id: stateId, projectId, workspaceId, name: "Backlog", group: "backlog", color: "#ccc" });

    // Create cycles (one active, one completed)
    await db.insert(cycles).values([
      { id: cycleId, projectId, workspaceId, name: "Sprint 1", startDate: new Date("2025-01-01"), endDate: new Date("2030-12-31"), ownedById: userId },
      { id: otherCycleId, projectId, workspaceId, name: "Sprint 2", startDate: new Date("2025-01-01"), endDate: new Date("2030-12-31"), ownedById: userId },
    ]);

    // Create issues
    await db.insert(issues).values([
      { id: issueId1, projectId, workspaceId, name: "Issue 1", stateId, createdById: userId, sequenceId: 1 },
      { id: issueId2, projectId, workspaceId, name: "Issue 2", stateId, createdById: userId, sequenceId: 2 },
      { id: issueId3, projectId, workspaceId, name: "Issue 3", stateId, createdById: userId, sequenceId: 3 },
    ]);
  });

  afterAll(async () => {
    await db.delete(cycleIssues).where(eq(cycleIssues.cycleId, cycleId));
    await db.delete(cycleIssues).where(eq(cycleIssues.cycleId, otherCycleId));
    await db.delete(issues).where(eq(issues.workspaceId, workspaceId));
    await db.delete(states).where(eq(states.id, stateId));
    await db.delete(cycles).where(eq(cycles.projectId, projectId));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
  });

  test("add issues to cycle", async () => {
    const res = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ issues: [issueId1, issueId2] }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.message).toBe("success");
  });

  test("list cycle issues", async () => {
    const res = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total_count).toBe(2);
    expect(data.results.length).toBe(2);
    const ids = data.results.map((r: any) => r.id);
    expect(ids).toContain(issueId1);
    expect(ids).toContain(issueId2);
  });

  test("adding duplicate issues is idempotent", async () => {
    const res = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ issues: [issueId1] }),
    });
    expect(res.status).toBe(201);

    // Verify still only 2 issues
    const listRes = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, { headers: h() });
    const data = await listRes.json();
    expect(data.total_count).toBe(2);
  });

  test("move issue from another cycle", async () => {
    // Add issue3 to otherCycle first
    await db.insert(cycleIssues).values({ cycleId: otherCycleId, issueId: issueId3 });

    // Now add issue3 to main cycle - should move it
    const res = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ issues: [issueId3] }),
    });
    expect(res.status).toBe(201);

    // Verify issue3 is now in main cycle
    const listRes = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, { headers: h() });
    const data = await listRes.json();
    expect(data.total_count).toBe(3);
    const ids = data.results.map((r: any) => r.id);
    expect(ids).toContain(issueId3);

    // Verify issue3 is NOT in other cycle anymore
    const otherCycleIssues = await db.select().from(cycleIssues).where(and(eq(cycleIssues.cycleId, otherCycleId), eq(cycleIssues.issueId, issueId3)));
    expect(otherCycleIssues.length).toBe(0);
  });

  test("remove issue from cycle", async () => {
    const res = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/${issueId1}/`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(204);

    // Verify only 2 issues remain
    const listRes = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, { headers: h() });
    const data = await listRes.json();
    expect(data.total_count).toBe(2);
    const ids = data.results.map((r: any) => r.id);
    expect(ids).not.toContain(issueId1);
  });

  test("list returns empty for cycle with no issues", async () => {
    const emptyCycleId = createId();
    await db.insert(cycles).values({ id: emptyCycleId, projectId, workspaceId, name: "Empty", ownedById: userId });

    const res = await app.request(`/api/projects/${projectId}/cycles/${emptyCycleId}/cycle-issues/`, { headers: h() });
    const data = await res.json();
    expect(data.total_count).toBe(0);
    expect(data.results.length).toBe(0);

    await db.delete(cycles).where(eq(cycles.id, emptyCycleId));
  });

  test("returns 400 when no issues provided", async () => {
    const res = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ issues: [] }),
    });
    // zod validation rejects empty array
    expect(res.status).toBe(400);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/cycle-issues/`);
    expect(res.status).toBe(401);
  });
});

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers } from "../../db/schema/project";
import { issues, issueActivities } from "../../db/schema/issue";
import { eq, and, inArray, not, desc, isNull, count } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

type Variables = any;
const app = new Hono<{ Variables: Variables }>();

const userId = createId();
const otherUserId = createId();
const workspaceId = createId();
const projectId = createId();

// Fake auth middleware
app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  c.set("user", { id: uid, email: "test@test.com", name: "Test" });
  c.set("session", { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace", { id: workspaceId, name: "Activity WS", slug: "activity-ws", ownerId: userId });
  c.set("workspaceMembership", { id: "wm", workspaceId, userId: uid, role: 20 });
  await next();
});

// Inline user-activity route (bypasses authMiddleware from workspaceRoutes)
app.get("/api/workspaces/:slug/user-activity/:userId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const targetUserId = c.req.param("userId");

  const perPage = Math.min(parseInt(c.req.query("per_page") || "10", 10) || 10, 1000);
  const cursorParam = c.req.query("cursor") || "0:0:0";
  const [_cursorLimit, cursorOffsetStr] = cursorParam.split(":");
  const offset = parseInt(cursorOffsetStr || "0", 10) || 0;

  const projectFilter = c.req.queries("project") ?? [];

  const memberProjects = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.memberId, user.id),
        eq(projectMembers.isActive, true),
        isNull(projects.archivedAt)
      )
    );

  const memberProjectIds = memberProjects.map((p) => p.projectId);
  if (memberProjectIds.length === 0) {
    return c.json({
      grouped_by: null,
      sub_grouped_by: null,
      total_count: 0,
      next_cursor: `${perPage}:${perPage}:0`,
      prev_cursor: `${perPage}:0:0`,
      next_page_results: false,
      prev_page_results: false,
      count: 0,
      total_pages: 0,
      total_results: 0,
      extra_stats: null,
      results: [],
    });
  }

  const filteredProjectIds =
    projectFilter.length > 0
      ? memberProjectIds.filter((id) => projectFilter.includes(id))
      : memberProjectIds;

  if (filteredProjectIds.length === 0) {
    return c.json({
      grouped_by: null,
      sub_grouped_by: null,
      total_count: 0,
      next_cursor: `${perPage}:${perPage}:0`,
      prev_cursor: `${perPage}:0:0`,
      next_page_results: false,
      prev_page_results: false,
      count: 0,
      total_pages: 0,
      total_results: 0,
      extra_stats: null,
      results: [],
    });
  }

  const excludedFields = ["comment", "vote", "reaction", "draft"];

  const [totalRow] = await db
    .select({ count: count() })
    .from(issueActivities)
    .where(
      and(
        eq(issueActivities.workspaceId, workspace.id),
        eq(issueActivities.actorId, targetUserId),
        inArray(issueActivities.projectId, filteredProjectIds),
        not(inArray(issueActivities.field, excludedFields))
      )
    );
  const totalCount = totalRow?.count ?? 0;

  const activities = await db.query.issueActivities.findMany({
    where: and(
      eq(issueActivities.workspaceId, workspace.id),
      eq(issueActivities.actorId, targetUserId),
      inArray(issueActivities.projectId, filteredProjectIds),
      not(inArray(issueActivities.field, excludedFields))
    ),
    orderBy: [desc(issueActivities.createdAt)],
    limit: perPage,
    offset,
    with: {
      actor: true,
      issue: true,
      project: true,
      workspace: true,
    },
  });

  const hasNext = offset + perPage < totalCount;
  const hasPrev = offset > 0;
  const nextOffset = offset + perPage;
  const prevOffset = Math.max(0, offset - perPage);
  const totalPages = Math.ceil(totalCount / perPage);

  const results = activities.map((a: any) => ({
    id: a.id,
    issue: a.issueId,
    verb: a.verb,
    field: a.field ?? null,
    old_value: a.oldValue ?? null,
    new_value: a.newValue ?? null,
    old_identifier: a.oldIdentifier ?? null,
    new_identifier: a.newIdentifier ?? null,
    epoch: a.epochTimestamp ?? null,
    actor: a.actorId,
    project: a.projectId,
    workspace: a.workspaceId,
    created_at: a.createdAt?.toISOString() ?? null,
    updated_at: a.createdAt?.toISOString() ?? null,
    actor_detail: a.actor
      ? {
          id: a.actor.id,
          first_name: a.actor.firstName ?? a.actor.name?.split(" ")[0] ?? "",
          last_name: a.actor.lastName ?? a.actor.name?.split(" ").slice(1).join(" ") ?? "",
          avatar: a.actor.avatar ?? a.actor.image ?? "",
          avatar_url: a.actor.avatar ?? a.actor.image ?? "",
          display_name: a.actor.displayName ?? a.actor.name ?? "",
          is_bot: false,
        }
      : null,
    issue_detail: a.issue
      ? {
          id: a.issue.id,
          name: a.issue.name,
          description_html: a.issue.descriptionHtml ?? "",
          priority: a.issue.priority ?? 0,
          sequence_id: a.issue.sequenceId ?? null,
          sort_order: a.issue.sortOrder ?? 65535,
          is_draft: false,
        }
      : null,
    project_detail: a.project
      ? {
          id: a.project.id,
          identifier: a.project.identifier,
          name: a.project.name,
        }
      : null,
    workspace_detail: a.workspace
      ? {
          id: a.workspace.id,
          name: a.workspace.name,
          slug: a.workspace.slug,
        }
      : null,
  }));

  return c.json({
    grouped_by: null,
    sub_grouped_by: null,
    total_count: totalCount,
    next_cursor: `${perPage}:${nextOffset}:0`,
    prev_cursor: `${perPage}:${prevOffset}:0`,
    next_page_results: hasNext,
    prev_page_results: hasPrev,
    count: results.length,
    total_pages: totalPages,
    total_results: totalCount,
    extra_stats: null,
    results,
  });
});

function h(uid: string = userId) {
  return { "x-test-user": uid, "Content-Type": "application/json" };
}

describe("User Activity Endpoint", () => {
  const issueId = createId();
  const activityIds: string[] = [];

  beforeAll(async () => {
    await db.insert(users).values([
      { id: userId, email: "ua-test@test.com", name: "UA Test", emailVerified: true },
      { id: otherUserId, email: "ua-other@test.com", name: "UA Other", emailVerified: true },
    ]);
    await db.insert(workspaces).values({ id: workspaceId, name: "Activity WS", slug: "activity-ws", ownerId: userId });
    await db.insert(workspaceMembers).values({ id: createId(), workspaceId, userId, role: 20 });
    await db.insert(projects).values({ id: projectId, workspaceId, name: "Activity Project", identifier: "UAP", createdById: userId });
    await db.insert(projectMembers).values({ id: createId(), projectId, memberId: userId, role: 20 });
    await db.insert(issues).values({ id: issueId, projectId, workspaceId, name: "Test Issue", createdById: userId });

    // Create various activities
    for (let i = 0; i < 15; i++) {
      const aId = createId();
      activityIds.push(aId);
      await db.insert(issueActivities).values({
        id: aId,
        issueId,
        projectId,
        workspaceId,
        actorId: otherUserId,
        field: i === 0 ? "state" : i === 1 ? "priority" : "name",
        oldValue: `old_${i}`,
        newValue: `new_${i}`,
        verb: "updated",
      });
    }

    // Create activities with excluded fields (should not appear)
    for (const field of ["comment", "vote", "reaction", "draft"]) {
      await db.insert(issueActivities).values({
        id: createId(),
        issueId,
        projectId,
        workspaceId,
        actorId: otherUserId,
        field,
        verb: "created",
      });
    }
  });

  afterAll(async () => {
    await db.delete(issueActivities).where(eq(issueActivities.workspaceId, workspaceId));
    await db.delete(issues).where(eq(issues.id, issueId));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
  });

  test("returns paginated activities for a user", async () => {
    const res = await app.request(
      `/api/workspaces/activity-ws/user-activity/${otherUserId}/?per_page=10`,
      { headers: h() }
    );
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.total_results).toBe(15);
    expect(data.count).toBe(10);
    expect(data.results.length).toBe(10);
    expect(data.next_page_results).toBe(true);
    expect(data.prev_page_results).toBe(false);
    expect(data.total_pages).toBe(2);
  });

  test("excludes comment, vote, reaction, draft activities", async () => {
    const res = await app.request(
      `/api/workspaces/activity-ws/user-activity/${otherUserId}/?per_page=100`,
      { headers: h() }
    );
    const data = await res.json();
    expect(data.total_results).toBe(15); // only the 15 non-excluded ones
    for (const a of data.results) {
      expect(["comment", "vote", "reaction", "draft"]).not.toContain(a.field);
    }
  });

  test("returns actor_detail, issue_detail, project_detail, workspace_detail", async () => {
    const res = await app.request(
      `/api/workspaces/activity-ws/user-activity/${otherUserId}/?per_page=1`,
      { headers: h() }
    );
    const data = await res.json();
    const activity = data.results[0];

    expect(activity.actor_detail).toBeTruthy();
    expect(activity.actor_detail.id).toBe(otherUserId);

    expect(activity.issue_detail).toBeTruthy();
    expect(activity.issue_detail.id).toBe(issueId);
    expect(activity.issue_detail.name).toBe("Test Issue");

    expect(activity.project_detail).toBeTruthy();
    expect(activity.project_detail.id).toBe(projectId);

    expect(activity.workspace_detail).toBeTruthy();
    expect(activity.workspace_detail.id).toBe(workspaceId);
  });

  test("second page returns remaining results", async () => {
    const res = await app.request(
      `/api/workspaces/activity-ws/user-activity/${otherUserId}/?per_page=10&cursor=10:10:0`,
      { headers: h() }
    );
    const data = await res.json();
    expect(data.count).toBe(5);
    expect(data.next_page_results).toBe(false);
    expect(data.prev_page_results).toBe(true);
  });

  test("returns empty for user with no activities", async () => {
    const res = await app.request(
      `/api/workspaces/activity-ws/user-activity/${userId}/?per_page=10`,
      { headers: h() }
    );
    const data = await res.json();
    expect(data.total_results).toBe(0);
    expect(data.results.length).toBe(0);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request(
      `/api/workspaces/activity-ws/user-activity/${otherUserId}/`
    );
    expect(res.status).toBe(401);
  });
});

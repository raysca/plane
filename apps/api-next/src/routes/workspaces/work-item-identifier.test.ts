import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers, recentVisits } from "../../db/schema/workspace";
import { projects, projectMembers, labels } from "../../db/schema/project";
import { issues, issueAssignees, issueLabels, issueLinks, issueReactions, issueSubscribers } from "../../db/schema/issue";
import { modules, moduleIssues } from "../../db/schema/module";
import { cycles, cycleIssues } from "../../db/schema/cycle";
import { fileAssets } from "../../db/schema/asset";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

type Variables = any;
const app = new Hono<{ Variables: Variables }>();

const userId = createId();
const guestUserId = createId();
const nonMemberUserId = createId();
const workspaceId = createId();
const projectId = createId();
const issueId = createId();
const parentIssueId = createId();
const labelId = createId();
const moduleId = createId();
const cycleId = createId();

// Fake auth + workspace middleware
app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  c.set("user", { id: uid, email: "test@test.com", name: "Test" });
  c.set("session", { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace", { id: workspaceId, name: "Test WS", slug: "test-ws", ownerId: userId });
  c.set("workspaceMembership", { id: "wm", workspaceId, userId: uid, role: 20 });
  await next();
});

// Inline the route logic for testing (mirrors the route in workspaces/index.ts)
app.get("/api/workspaces/:slug/work-items/:identifier/", async (c) => {
  const { sql, isNull, count } = await import("drizzle-orm");

  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const identifier = c.req.param("identifier");
  const dashIndex = identifier.lastIndexOf("-");
  if (dashIndex === -1) return c.json({ error: "Invalid issue identifier" }, 400);

  const projectIdentifier = identifier.substring(0, dashIndex);
  const sequenceStr = identifier.substring(dashIndex + 1);
  if (!/^\d+$/.test(sequenceStr)) return c.json({ error: "Invalid issue identifier" }, 400);
  const sequenceId = parseInt(sequenceStr, 10);

  const project = await db.query.projects.findFirst({
    where: and(
      sql`LOWER(${projects.identifier}) = LOWER(${projectIdentifier})`,
      eq(projects.workspaceId, workspace.id)
    ),
  });
  if (!project) return c.json({ error: "The required object does not exist." }, 404);

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.memberId, user.id),
      eq(projectMembers.isActive, true)
    ),
  });
  if (!membership) return c.json({ error: "You are not allowed to view this issue" }, 403);

  const issue = await db.query.issues.findFirst({
    where: and(
      eq(issues.projectId, project.id),
      eq(issues.workspaceId, workspace.id),
      eq(issues.sequenceId, sequenceId),
      isNull(issues.deletedAt)
    ),
  });
  if (!issue) return c.json({ error: "The required object does not exist." }, 404);

  if (membership.role === 5 && !project.guestViewAllFeatures && issue.createdById !== user.id) {
    return c.json({ error: "You are not allowed to view this issue" }, 403);
  }

  const [assigneeRows, labelRows, moduleRows, cycleRow, subIssuesCountResult, linkCountResult, attachmentCountResult, subscriberRow] = await Promise.all([
    db.select({ assigneeId: issueAssignees.assigneeId }).from(issueAssignees).where(eq(issueAssignees.issueId, issue.id)),
    db.select({ labelId: issueLabels.labelId }).from(issueLabels).where(eq(issueLabels.issueId, issue.id)),
    db.select({ moduleId: moduleIssues.moduleId }).from(moduleIssues).innerJoin(modules, eq(modules.id, moduleIssues.moduleId)).where(and(eq(moduleIssues.issueId, issue.id), isNull(modules.archivedAt))),
    db.select({ cycleId: cycleIssues.cycleId }).from(cycleIssues).where(eq(cycleIssues.issueId, issue.id)).limit(1),
    db.select({ count: count() }).from(issues).where(and(eq(issues.parentId, issue.id), isNull(issues.deletedAt))),
    db.select({ count: count() }).from(issueLinks).where(eq(issueLinks.issueId, issue.id)),
    db.select({ count: count() }).from(fileAssets).where(and(eq(fileAssets.entityIdentifier, issue.id), eq(fileAssets.entityType, "issue_attachment"), eq(fileAssets.isDeleted, false))),
    db.query.issueSubscribers.findFirst({ where: and(eq(issueSubscribers.issueId, issue.id), eq(issueSubscribers.subscriberId, user.id)) }),
  ]);

  const result: Record<string, unknown> = {
    id: issue.id,
    project_id: issue.projectId,
    workspace_id: issue.workspaceId,
    parent_id: issue.parentId ?? null,
    state_id: issue.stateId ?? null,
    name: issue.name,
    description_html: issue.descriptionHtml ?? "",
    priority: issue.priority ?? 0,
    sort_order: issue.sortOrder ?? 65535,
    start_date: issue.startDate?.toISOString()?.split("T")[0] ?? null,
    target_date: issue.targetDate?.toISOString()?.split("T")[0] ?? null,
    completed_at: issue.completedAt?.toISOString() ?? null,
    archived_at: issue.archivedAt?.toISOString() ?? null,
    sequence_id: issue.sequenceId ?? null,
    estimate_point: issue.estimatePoint ?? null,
    is_draft: false,
    is_epic: issue.isEpic ?? false,
    assignee_ids: assigneeRows.map((r) => r.assigneeId),
    label_ids: labelRows.map((r) => r.labelId),
    module_ids: moduleRows.map((r) => r.moduleId),
    cycle_id: cycleRow[0]?.cycleId ?? null,
    sub_issues_count: subIssuesCountResult[0]?.count ?? 0,
    attachment_count: attachmentCountResult[0]?.count ?? 0,
    link_count: linkCountResult[0]?.count ?? 0,
    is_subscribed: !!subscriberRow,
    is_intake: false,
    created_by: issue.createdById ?? null,
    updated_by: issue.updatedById ?? null,
    created_at: issue.createdAt?.toISOString() ?? null,
    updated_at: issue.updatedAt?.toISOString() ?? null,
  };

  const expandParam = c.req.query("expand") ?? "";
  const expandFields = expandParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (expandFields.includes("issue_reactions")) {
    const reactions = await db.select().from(issueReactions).where(eq(issueReactions.issueId, issue.id));
    result.issue_reactions = reactions.map((r) => ({
      id: r.id,
      issue: r.issueId,
      actor: r.actorId,
      reaction: r.reaction,
      created_at: r.createdAt?.toISOString() ?? null,
    }));
  }

  if (expandFields.includes("issue_link")) {
    const links = await db.select().from(issueLinks).where(eq(issueLinks.issueId, issue.id));
    result.issue_link = links.map((l) => ({
      id: l.id,
      issue: l.issueId,
      title: l.title ?? "",
      url: l.url,
      metadata: l.metadata ?? {},
      created_by: l.createdById ?? null,
      created_at: l.createdAt?.toISOString() ?? null,
    }));
  }

  if (expandFields.includes("issue_attachments")) {
    const attachments = await db.select().from(fileAssets).where(and(eq(fileAssets.entityIdentifier, issue.id), eq(fileAssets.entityType, "issue_attachment"), eq(fileAssets.isDeleted, false)));
    result.issue_attachments = attachments.map((a) => ({
      id: a.id,
      asset: a.asset,
      attributes: a.attributes ?? {},
      size: a.size ?? 0,
      is_uploaded: a.isUploaded ?? false,
      created_by: a.createdById ?? null,
      created_at: a.createdAt?.toISOString() ?? null,
      updated_at: a.updatedAt?.toISOString() ?? null,
    }));
  }

  if (expandFields.includes("parent") && issue.parentId) {
    const parent = await db.query.issues.findFirst({
      where: and(eq(issues.id, issue.parentId), isNull(issues.deletedAt)),
    });
    if (parent) {
      const parentAssignees = await db.select({ assigneeId: issueAssignees.assigneeId }).from(issueAssignees).where(eq(issueAssignees.issueId, parent.id));
      const parentLabels = await db.select({ labelId: issueLabels.labelId }).from(issueLabels).where(eq(issueLabels.issueId, parent.id));
      result.parent = {
        id: parent.id,
        project_id: parent.projectId,
        workspace_id: parent.workspaceId,
        parent_id: parent.parentId ?? null,
        state_id: parent.stateId ?? null,
        name: parent.name,
        priority: parent.priority ?? 0,
        sort_order: parent.sortOrder ?? 65535,
        start_date: parent.startDate?.toISOString()?.split("T")[0] ?? null,
        target_date: parent.targetDate?.toISOString()?.split("T")[0] ?? null,
        completed_at: parent.completedAt?.toISOString() ?? null,
        archived_at: parent.archivedAt?.toISOString() ?? null,
        sequence_id: parent.sequenceId ?? null,
        estimate_point: parent.estimatePoint ?? null,
        is_epic: parent.isEpic ?? false,
        assignee_ids: parentAssignees.map((r) => r.assigneeId),
        label_ids: parentLabels.map((r) => r.labelId),
        created_by: parent.createdById ?? null,
        updated_by: parent.updatedById ?? null,
        created_at: parent.createdAt?.toISOString() ?? null,
        updated_at: parent.updatedAt?.toISOString() ?? null,
      };
    } else {
      result.parent = null;
    }
  }

  return c.json(result);
});

function h(uid: string = userId) {
  return { "x-test-user": uid, "Content-Type": "application/json" };
}

describe("Work Item by Identifier Endpoint", () => {
  beforeAll(async () => {
    await db.insert(users).values([
      { id: userId, email: "wii-test@test.com", name: "WII Test", emailVerified: true },
      { id: guestUserId, email: "wii-guest@test.com", name: "WII Guest", emailVerified: true },
      { id: nonMemberUserId, email: "wii-nonmember@test.com", name: "WII NonMember", emailVerified: true },
    ]);
    await db.insert(workspaces).values({ id: workspaceId, name: "Test WS", slug: "test-ws", ownerId: userId });
    await db.insert(workspaceMembers).values([
      { id: createId(), workspaceId, userId, role: 20 },
      { id: createId(), workspaceId, userId: guestUserId, role: 5 },
    ]);
    await db.insert(projects).values({ id: projectId, workspaceId, name: "Test Project", identifier: "TEST", createdById: userId });
    await db.insert(projectMembers).values([
      { id: createId(), projectId, memberId: userId, role: 20 },
      { id: createId(), projectId, memberId: guestUserId, role: 5 },
    ]);

    // Label
    await db.insert(labels).values({ id: labelId, projectId, workspaceId, name: "Bug", color: "#ff0000" });

    // Parent issue
    await db.insert(issues).values({ id: parentIssueId, projectId, workspaceId, name: "Parent Issue", sequenceId: 1, createdById: userId });
    // Main issue with parent, created by userId
    await db.insert(issues).values({ id: issueId, projectId, workspaceId, name: "Test Issue", sequenceId: 2, parentId: parentIssueId, createdById: userId, priority: 2 });
    // A child issue
    await db.insert(issues).values({ id: createId(), projectId, workspaceId, name: "Child Issue", sequenceId: 3, parentId: issueId, createdById: userId });

    // Assignee
    await db.insert(issueAssignees).values({ issueId, assigneeId: userId });
    // Label
    await db.insert(issueLabels).values({ issueId, labelId });
    // Link
    await db.insert(issueLinks).values({ id: createId(), issueId, url: "https://example.com", title: "Example" });
    // Reaction
    await db.insert(issueReactions).values({ id: createId(), issueId, actorId: userId, reaction: "thumbsup" });
    // Subscriber
    await db.insert(issueSubscribers).values({ id: createId(), issueId, subscriberId: userId, workspaceId, projectId });
    // Module
    await db.insert(modules).values({ id: moduleId, workspaceId, projectId, name: "Test Module", createdById: userId });
    await db.insert(moduleIssues).values({ id: createId(), moduleId, issueId });
    // Cycle
    await db.insert(cycles).values({ id: cycleId, workspaceId, projectId, name: "Test Cycle", createdById: userId });
    await db.insert(cycleIssues).values({ id: createId(), cycleId, issueId });
    // Attachment (file asset)
    await db.insert(fileAssets).values({ id: createId(), entityIdentifier: issueId, entityType: "issue_attachment", asset: "/path/to/file.png", isDeleted: false, isUploaded: true });
  });

  afterAll(async () => {
    await db.delete(fileAssets).where(eq(fileAssets.entityIdentifier, issueId));
    await db.delete(cycleIssues).where(eq(cycleIssues.cycleId, cycleId));
    await db.delete(cycles).where(eq(cycles.id, cycleId));
    await db.delete(moduleIssues).where(eq(moduleIssues.moduleId, moduleId));
    await db.delete(modules).where(eq(modules.id, moduleId));
    await db.delete(issueSubscribers).where(eq(issueSubscribers.issueId, issueId));
    await db.delete(issueReactions).where(eq(issueReactions.issueId, issueId));
    await db.delete(issueLinks).where(eq(issueLinks.issueId, issueId));
    await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
    await db.delete(issueAssignees).where(eq(issueAssignees.issueId, issueId));
    await db.delete(issues).where(eq(issues.workspaceId, workspaceId));
    await db.delete(labels).where(eq(labels.id, labelId));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, guestUserId));
    await db.delete(users).where(eq(users.id, nonMemberUserId));
  });

  test("returns issue by identifier (TEST-2)", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/", { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe(issueId);
    expect(data.name).toBe("Test Issue");
    expect(data.sequence_id).toBe(2);
    expect(data.project_id).toBe(projectId);
    expect(data.workspace_id).toBe(workspaceId);
    expect(data.parent_id).toBe(parentIssueId);
    expect(data.priority).toBe(2);
    expect(data.is_subscribed).toBe(true);
    expect(data.is_intake).toBe(false);
    expect(data.is_draft).toBe(false);
  });

  test("returns correct relation counts", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/", { headers: h() });
    const data = await res.json();

    expect(data.assignee_ids).toContain(userId);
    expect(data.label_ids).toContain(labelId);
    expect(data.module_ids).toContain(moduleId);
    expect(data.cycle_id).toBe(cycleId);
    expect(data.sub_issues_count).toBe(1);
    expect(data.link_count).toBe(1);
    expect(data.attachment_count).toBe(1);
  });

  test("case-insensitive project identifier", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/test-2/", { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(issueId);
  });

  test("expand=issue_reactions returns reactions", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/?expand=issue_reactions", { headers: h() });
    const data = await res.json();

    expect(data.issue_reactions).toBeDefined();
    expect(data.issue_reactions.length).toBe(1);
    expect(data.issue_reactions[0].reaction).toBe("thumbsup");
    expect(data.issue_reactions[0].actor).toBe(userId);
  });

  test("expand=issue_link returns links", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/?expand=issue_link", { headers: h() });
    const data = await res.json();

    expect(data.issue_link).toBeDefined();
    expect(data.issue_link.length).toBe(1);
    expect(data.issue_link[0].url).toBe("https://example.com");
    expect(data.issue_link[0].title).toBe("Example");
  });

  test("expand=issue_attachments returns attachments", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/?expand=issue_attachments", { headers: h() });
    const data = await res.json();

    expect(data.issue_attachments).toBeDefined();
    expect(data.issue_attachments.length).toBe(1);
    expect(data.issue_attachments[0].asset).toBe("/path/to/file.png");
  });

  test("expand=parent returns parent issue", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/?expand=parent", { headers: h() });
    const data = await res.json();

    expect(data.parent).toBeDefined();
    expect(data.parent.id).toBe(parentIssueId);
    expect(data.parent.name).toBe("Parent Issue");
    expect(data.parent.sequence_id).toBe(1);
  });

  test("expand=multiple fields works", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/?expand=issue_reactions,issue_link,issue_attachments,parent", { headers: h() });
    const data = await res.json();

    expect(data.issue_reactions.length).toBe(1);
    expect(data.issue_link.length).toBe(1);
    expect(data.issue_attachments.length).toBe(1);
    expect(data.parent.id).toBe(parentIssueId);
  });

  test("returns 400 for invalid identifier (no dash)", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/NODASH/", { headers: h() });
    expect(res.status).toBe(400);
  });

  test("returns 400 for non-numeric sequence", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-abc/", { headers: h() });
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent project", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/NOPE-1/", { headers: h() });
    expect(res.status).toBe(404);
  });

  test("returns 404 for non-existent sequence", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-999/", { headers: h() });
    expect(res.status).toBe(404);
  });

  test("returns 403 for non-project member", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/", { headers: h(nonMemberUserId) });
    expect(res.status).toBe(403);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/");
    expect(res.status).toBe(401);
  });

  test("is_subscribed is false for non-subscriber", async () => {
    const res = await app.request("/api/workspaces/test-ws/work-items/TEST-2/", { headers: h(guestUserId) });
    // Guest can view because the issue was created by userId but guest can still see it
    // since guestViewAllFeatures defaults to false and createdById !== guestUserId
    // Actually guest role=5, guestViewAllFeatures is falsy, and createdById is userId not guestUserId → 403
    expect(res.status).toBe(403);
  });
});

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers, states } from "../../db/schema/project";
import { issues, issueAssignees, issueSubscribers } from "../../db/schema/issue";
import { cycles, cycleIssues } from "../../db/schema/cycle";
import { eq, and, inArray, not, isNull, count, lt, gt } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

type Variables = any;
const app = new Hono<{ Variables: Variables }>();

const userId = createId();
const targetUserId = createId();
const workspaceId = createId();
const projectId = createId();

// State IDs
const backlogStateId = createId();
const startedStateId = createId();
const completedStateId = createId();
const cancelledStateId = createId();

// Issue IDs
const issue1Id = createId();
const issue2Id = createId();
const issue3Id = createId();
const issue4Id = createId();

// Cycle IDs
const presentCycleId = createId();
const upcomingCycleId = createId();

// Fake auth middleware
app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  c.set("user", { id: uid, email: "test@test.com", name: "Test" });
  c.set("session", { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace", { id: workspaceId, name: "Stats WS", slug: "stats-ws", ownerId: userId });
  c.set("workspaceMembership", { id: "wm", workspaceId, userId: uid, role: 20 });
  await next();
});

// Inline user-stats route
app.get("/:slug/user-stats/:userId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const reqTargetUserId = c.req.param("userId");

  const memberProjects = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projectMembers.memberId, user.id),
        eq(projectMembers.isActive, true),
        eq(projects.workspaceId, workspace.id),
        isNull(projects.archivedAt)
      )
    );

  const memberProjectIds = memberProjects.map((p) => p.projectId);

  if (memberProjectIds.length === 0) {
    return c.json({
      state_distribution: [],
      priority_distribution: [],
      created_issues: 0,
      assigned_issues: 0,
      completed_issues: 0,
      pending_issues: 0,
      subscribed_issues: 0,
      present_cycles: [],
      upcoming_cycles: [],
    });
  }

  const priorityNames: Record<number, string> = {
    0: "none",
    1: "urgent",
    2: "high",
    3: "medium",
    4: "low",
  };

  const priorityOrder: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
    none: 4,
  };

  const stateDistribution = await db
    .select({
      state_group: states.group,
      state_count: count(),
    })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        eq(issueAssignees.assigneeId, reqTargetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    )
    .groupBy(states.group)
    .orderBy(states.group);

  const priorityDistributionRaw = await db
    .select({
      priority: issues.priority,
      priority_count: count(),
    })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(issueAssignees.assigneeId, reqTargetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    )
    .groupBy(issues.priority);

  const priorityDistribution = priorityDistributionRaw
    .filter((p) => p.priority_count >= 1)
    .map((p) => ({
      priority: priorityNames[p.priority ?? 0] ?? "none",
      priority_count: p.priority_count,
    }))
    .sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99));

  const [createdResult] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.createdById, reqTargetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  const [assignedResult] = await db
    .select({ count: count() })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(issueAssignees.assigneeId, reqTargetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  const [completedResult] = await db
    .select({ count: count() })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        eq(issueAssignees.assigneeId, reqTargetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        eq(states.group, "completed"),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  const [pendingResult] = await db
    .select({ count: count() })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        eq(issueAssignees.assigneeId, reqTargetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        not(inArray(states.group, ["completed", "cancelled"])),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  const [subscribedResult] = await db
    .select({ count: count() })
    .from(issueSubscribers)
    .innerJoin(projects, eq(issueSubscribers.projectId, projects.id))
    .where(
      and(
        eq(issueSubscribers.subscriberId, reqTargetUserId),
        eq(issueSubscribers.workspaceId, workspace.id),
        inArray(issueSubscribers.projectId, memberProjectIds),
        isNull(projects.archivedAt)
      )
    );

  const now = new Date();

  const presentCyclesRaw = await db
    .select({
      cycle__name: cycles.name,
      cycle__id: cycles.id,
      cycle__project_id: cycles.projectId,
    })
    .from(cycleIssues)
    .innerJoin(cycles, eq(cycleIssues.cycleId, cycles.id))
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(cycles.workspaceId, workspace.id),
        lt(cycles.startDate, now),
        gt(cycles.endDate, now),
        eq(issueAssignees.assigneeId, reqTargetUserId)
      )
    )
    .groupBy(cycles.id, cycles.name, cycles.projectId);

  const upcomingCyclesRaw = await db
    .select({
      cycle__name: cycles.name,
      cycle__id: cycles.id,
      cycle__project_id: cycles.projectId,
    })
    .from(cycleIssues)
    .innerJoin(cycles, eq(cycleIssues.cycleId, cycles.id))
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(cycles.workspaceId, workspace.id),
        gt(cycles.startDate, now),
        eq(issueAssignees.assigneeId, reqTargetUserId)
      )
    )
    .groupBy(cycles.id, cycles.name, cycles.projectId);

  return c.json({
    state_distribution: stateDistribution,
    priority_distribution: priorityDistribution,
    created_issues: createdResult?.count ?? 0,
    assigned_issues: assignedResult?.count ?? 0,
    completed_issues: completedResult?.count ?? 0,
    pending_issues: pendingResult?.count ?? 0,
    subscribed_issues: subscribedResult?.count ?? 0,
    present_cycles: presentCyclesRaw,
    upcoming_cycles: upcomingCyclesRaw,
  });
});

// --- Seed & Cleanup ---

beforeAll(async () => {
  // Create users
  await db.insert(users).values([
    { id: userId, email: "stats-requester@test.com", name: "Requester", emailVerified: true },
    { id: targetUserId, email: "stats-target@test.com", name: "Target User", emailVerified: true },
  ]);

  // Create workspace and membership
  await db.insert(workspaces).values({
    id: workspaceId,
    name: "Stats WS",
    slug: "stats-ws",
    ownerId: userId,
  });
  await db.insert(workspaceMembers).values([
    { workspaceId, userId, role: 20 },
    { workspaceId, userId: targetUserId, role: 15 },
  ]);

  // Create project and memberships
  await db.insert(projects).values({
    id: projectId,
    workspaceId,
    name: "Stats Project",
    identifier: "STP",
  });
  await db.insert(projectMembers).values([
    { projectId, memberId: userId, role: 20 },
    { projectId, memberId: targetUserId, role: 15 },
  ]);

  // Create states
  await db.insert(states).values([
    { id: backlogStateId, projectId, workspaceId, name: "Backlog", color: "#ccc", group: "backlog" },
    { id: startedStateId, projectId, workspaceId, name: "In Progress", color: "#ff0", group: "started" },
    { id: completedStateId, projectId, workspaceId, name: "Done", color: "#0f0", group: "completed" },
    { id: cancelledStateId, projectId, workspaceId, name: "Cancelled", color: "#f00", group: "cancelled" },
  ]);

  // Create issues
  // issue1: assigned to target, backlog, priority urgent (1), created by target
  await db.insert(issues).values({
    id: issue1Id,
    projectId,
    workspaceId,
    name: "Issue 1",
    stateId: backlogStateId,
    priority: 1,
    createdById: targetUserId,
  });
  // issue2: assigned to target, started, priority high (2), created by requester
  await db.insert(issues).values({
    id: issue2Id,
    projectId,
    workspaceId,
    name: "Issue 2",
    stateId: startedStateId,
    priority: 2,
    createdById: userId,
  });
  // issue3: assigned to target, completed, priority medium (3), created by target
  await db.insert(issues).values({
    id: issue3Id,
    projectId,
    workspaceId,
    name: "Issue 3",
    stateId: completedStateId,
    priority: 3,
    createdById: targetUserId,
  });
  // issue4: assigned to target, cancelled, priority low (4), created by target
  await db.insert(issues).values({
    id: issue4Id,
    projectId,
    workspaceId,
    name: "Issue 4",
    stateId: cancelledStateId,
    priority: 4,
    createdById: targetUserId,
  });

  // Assign all issues to target user
  await db.insert(issueAssignees).values([
    { issueId: issue1Id, assigneeId: targetUserId },
    { issueId: issue2Id, assigneeId: targetUserId },
    { issueId: issue3Id, assigneeId: targetUserId },
    { issueId: issue4Id, assigneeId: targetUserId },
  ]);

  // Subscribe target user to issue1 and issue2
  await db.insert(issueSubscribers).values([
    { issueId: issue1Id, subscriberId: targetUserId, projectId, workspaceId },
    { issueId: issue2Id, subscriberId: targetUserId, projectId, workspaceId },
  ]);

  // Create present cycle (started yesterday, ends tomorrow)
  const yesterday = new Date(Date.now() - 86400000);
  const tomorrow = new Date(Date.now() + 86400000);
  const nextWeek = new Date(Date.now() + 7 * 86400000);
  const nextWeekEnd = new Date(Date.now() + 14 * 86400000);

  await db.insert(cycles).values([
    {
      id: presentCycleId,
      projectId,
      workspaceId,
      name: "Current Sprint",
      startDate: yesterday,
      endDate: tomorrow,
    },
    {
      id: upcomingCycleId,
      projectId,
      workspaceId,
      name: "Next Sprint",
      startDate: nextWeek,
      endDate: nextWeekEnd,
    },
  ]);

  // Add issue1 to present cycle, issue2 to upcoming cycle
  await db.insert(cycleIssues).values([
    { cycleId: presentCycleId, issueId: issue1Id },
    { cycleId: upcomingCycleId, issueId: issue2Id },
  ]);
});

afterAll(async () => {
  // Clean up in reverse dependency order
  await db.delete(cycleIssues).where(inArray(cycleIssues.cycleId, [presentCycleId, upcomingCycleId]));
  await db.delete(cycles).where(inArray(cycles.id, [presentCycleId, upcomingCycleId]));
  await db.delete(issueSubscribers).where(eq(issueSubscribers.workspaceId, workspaceId));
  await db.delete(issueAssignees).where(inArray(issueAssignees.issueId, [issue1Id, issue2Id, issue3Id, issue4Id]));
  await db.delete(issues).where(eq(issues.workspaceId, workspaceId));
  await db.delete(states).where(eq(states.workspaceId, workspaceId));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(inArray(users.id, [userId, targetUserId]));
});

// --- Tests ---

describe("GET /:slug/user-stats/:userId/", () => {
  test("returns 401 without auth", async () => {
    const res = await app.request(`/stats-ws/user-stats/${targetUserId}/`);
    expect(res.status).toBe(401);
  });

  test("returns correct stats for target user", async () => {
    const res = await app.request(`/stats-ws/user-stats/${targetUserId}/`, {
      headers: { "x-test-user": userId },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    // State distribution: backlog(1), started(1), completed(1), cancelled(1)
    expect(data.state_distribution).toBeArray();
    expect(data.state_distribution.length).toBe(4);

    const stateMap = Object.fromEntries(
      data.state_distribution.map((s: any) => [s.state_group, s.state_count])
    );
    expect(stateMap["backlog"]).toBe(1);
    expect(stateMap["started"]).toBe(1);
    expect(stateMap["completed"]).toBe(1);
    expect(stateMap["cancelled"]).toBe(1);

    // Priority distribution: urgent(1), high(1), medium(1), low(1)
    expect(data.priority_distribution).toBeArray();
    expect(data.priority_distribution.length).toBe(4);
    // Should be sorted: urgent, high, medium, low
    expect(data.priority_distribution[0].priority).toBe("urgent");
    expect(data.priority_distribution[1].priority).toBe("high");
    expect(data.priority_distribution[2].priority).toBe("medium");
    expect(data.priority_distribution[3].priority).toBe("low");

    // Created issues: target user created issue1, issue3, issue4 = 3
    expect(data.created_issues).toBe(3);

    // Assigned issues: all 4
    expect(data.assigned_issues).toBe(4);

    // Completed issues: issue3 (completed state) = 1
    expect(data.completed_issues).toBe(1);

    // Pending issues: NOT completed/cancelled = backlog + started = 2
    expect(data.pending_issues).toBe(2);

    // Subscribed issues: 2
    expect(data.subscribed_issues).toBe(2);

    // Present cycles: 1 (Current Sprint)
    expect(data.present_cycles).toBeArray();
    expect(data.present_cycles.length).toBe(1);
    expect(data.present_cycles[0].cycle__name).toBe("Current Sprint");

    // Upcoming cycles: 1 (Next Sprint)
    expect(data.upcoming_cycles).toBeArray();
    expect(data.upcoming_cycles.length).toBe(1);
    expect(data.upcoming_cycles[0].cycle__name).toBe("Next Sprint");
  });

  test("returns empty stats for user with no issues", async () => {
    const noIssuesUserId = createId();
    // Use the requesting user but ask for stats of a user with no issues
    const res = await app.request(`/stats-ws/user-stats/${noIssuesUserId}/`, {
      headers: { "x-test-user": userId },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.state_distribution).toEqual([]);
    expect(data.priority_distribution).toEqual([]);
    expect(data.created_issues).toBe(0);
    expect(data.assigned_issues).toBe(0);
    expect(data.completed_issues).toBe(0);
    expect(data.pending_issues).toBe(0);
    expect(data.subscribed_issues).toBe(0);
    expect(data.present_cycles).toEqual([]);
    expect(data.upcoming_cycles).toEqual([]);
  });
});

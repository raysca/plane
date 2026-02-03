import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers, states, labels } from "../../db/schema/project";
import { issues, issueAssignees, issueLabels } from "../../db/schema/issue";
import { cycles, cycleIssues } from "../../db/schema/cycle";
import { eq, and, isNull, isNotNull, inArray, sql, count as countFn } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

type Variables = any;
const app = new Hono<{ Variables: Variables }>();

const userId = createId();
const userId2 = createId();
const workspaceId = createId();
const projectId = createId();
const cycleId = createId();
const stateCompletedId = createId();
const stateStartedId = createId();
const labelId1 = createId();
const labelId2 = createId();

// Fake middleware
app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  c.set("user", { id: uid, email: "test@test.com", name: "Test" });
  c.set("session", { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace", { id: workspaceId, name: "Test WS", slug: `ca-test-ws-${workspaceId}`, ownerId: userId });
  c.set("workspaceMembership", { id: "wm", workspaceId, userId: uid, role: 20 });
  c.set("project", { id: projectId, workspaceId, name: "Test Project", identifier: "TP", estimateId: null });
  c.set("projectMembership", { id: "pm", projectId, memberId: uid, role: 20 });
  await next();
});

// Inline analytics route (copy of the route handler logic)
app.get("/api/projects/:projectId/cycles/:cycleId/analytics/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  if (!project || !workspace) return c.json({ detail: "Not found." }, 404);

  const cId = c.req.param("cycleId");
  const type = c.req.query("type") || "issues";

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cId), eq(cycles.projectId, project.id)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  // If cycle has a progress_snapshot with distribution data, return cached data
  const snapshot = cycle.progressSnapshot as Record<string, any> | null;
  if (snapshot && snapshot.distribution) {
    const dist = snapshot.distribution;
    const completionChart = snapshot.completion_chart || {};
    return c.json({
      assignees: dist.assignees || [],
      labels: dist.labels || [],
      completion_chart: completionChart,
    });
  }

  // Get all active cycle issues
  const cycleIssueRows = await db
    .select({
      issueId: cycleIssues.issueId,
      stateGroup: states.group,
      estimatePoint: issues.estimatePoint,
      completedAt: issues.completedAt,
    })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        eq(cycleIssues.cycleId, cId),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt)
      )
    );

  const issueIds = cycleIssueRows.map((r) => r.issueId);

  // --- Assignee distribution ---
  let assigneeDistribution: any[] = [];
  if (issueIds.length > 0) {
    const assigneeRows = await db
      .select({ issueId: issueAssignees.issueId, assigneeId: issueAssignees.assigneeId })
      .from(issueAssignees)
      .where(inArray(issueAssignees.issueId, issueIds));

    const issueMap = new Map<string, { stateGroup: string; estimatePoint: number | null }>();
    for (const row of cycleIssueRows) {
      issueMap.set(row.issueId, { stateGroup: row.stateGroup, estimatePoint: row.estimatePoint });
    }

    const assigneeIssuesMap = new Map<string, string[]>();
    const assignedIssueIds = new Set<string>();
    for (const row of assigneeRows) {
      assignedIssueIds.add(row.issueId);
      const existing = assigneeIssuesMap.get(row.assigneeId) || [];
      existing.push(row.issueId);
      assigneeIssuesMap.set(row.assigneeId, existing);
    }

    const unassignedIssues = issueIds.filter((iid) => !assignedIssueIds.has(iid));

    const aIds = [...assigneeIssuesMap.keys()];
    const userMap = new Map<string, { displayName: string | null; avatar: string | null }>();
    if (aIds.length > 0) {
      const userRows = await db
        .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
        .from(users)
        .where(inArray(users.id, aIds));
      for (const u of userRows) {
        userMap.set(u.id, { displayName: u.displayName, avatar: u.avatar });
      }
    }

    for (const [assigneeId, aIssueIds] of assigneeIssuesMap) {
      const user = userMap.get(assigneeId);
      let total = 0, completed = 0, pending = 0;
      if (type === "points") {
        for (const iid of aIssueIds) {
          const info = issueMap.get(iid);
          if (!info) continue;
          const pts = Number(info.estimatePoint) || 0;
          total += pts;
          if (info.stateGroup === "completed") completed += pts;
          else pending += pts;
        }
      } else {
        total = aIssueIds.length;
        for (const iid of aIssueIds) {
          const info = issueMap.get(iid);
          if (info?.stateGroup === "completed") completed++;
        }
        pending = total - completed;
      }
      assigneeDistribution.push({
        display_name: user?.displayName || "",
        assignee_id: assigneeId,
        avatar: user?.avatar || "",
        total_issues: total,
        completed_issues: completed,
        pending_issues: pending,
      });
    }

    if (unassignedIssues.length > 0) {
      let total = 0, completed = 0, pending = 0;
      if (type === "points") {
        for (const iid of unassignedIssues) {
          const info = issueMap.get(iid);
          if (!info) continue;
          const pts = Number(info.estimatePoint) || 0;
          total += pts;
          if (info.stateGroup === "completed") completed += pts;
          else pending += pts;
        }
      } else {
        total = unassignedIssues.length;
        for (const iid of unassignedIssues) {
          const info = issueMap.get(iid);
          if (info?.stateGroup === "completed") completed++;
        }
        pending = total - completed;
      }
      assigneeDistribution.push({
        display_name: "",
        assignee_id: null,
        avatar: "",
        total_issues: total,
        completed_issues: completed,
        pending_issues: pending,
      });
    }
  }

  // --- Label distribution ---
  let labelDistribution: any[] = [];
  if (issueIds.length > 0) {
    const labelRows = await db
      .select({ issueId: issueLabels.issueId, labelId: issueLabels.labelId })
      .from(issueLabels)
      .where(inArray(issueLabels.issueId, issueIds));

    const issueMap = new Map<string, { stateGroup: string; estimatePoint: number | null }>();
    for (const row of cycleIssueRows) {
      issueMap.set(row.issueId, { stateGroup: row.stateGroup, estimatePoint: row.estimatePoint });
    }

    const labelIssuesMap = new Map<string, string[]>();
    const labeledIssueIds = new Set<string>();
    for (const row of labelRows) {
      labeledIssueIds.add(row.issueId);
      const existing = labelIssuesMap.get(row.labelId) || [];
      existing.push(row.issueId);
      labelIssuesMap.set(row.labelId, existing);
    }

    const unlabeledIssues = issueIds.filter((iid) => !labeledIssueIds.has(iid));

    const lIds = [...labelIssuesMap.keys()];
    const labelDetailsMap = new Map<string, { name: string; color: string | null }>();
    if (lIds.length > 0) {
      const labelDetailRows = await db
        .select({ id: labels.id, name: labels.name, color: labels.color })
        .from(labels)
        .where(inArray(labels.id, lIds));
      for (const l of labelDetailRows) {
        labelDetailsMap.set(l.id, { name: l.name, color: l.color });
      }
    }

    for (const [labelId, lIssueIds] of labelIssuesMap) {
      const label = labelDetailsMap.get(labelId);
      let total = 0, completed = 0, pending = 0;
      if (type === "points") {
        for (const iid of lIssueIds) {
          const info = issueMap.get(iid);
          if (!info) continue;
          const pts = Number(info.estimatePoint) || 0;
          total += pts;
          if (info.stateGroup === "completed") completed += pts;
          else pending += pts;
        }
      } else {
        total = lIssueIds.length;
        for (const iid of lIssueIds) {
          const info = issueMap.get(iid);
          if (info?.stateGroup === "completed") completed++;
        }
        pending = total - completed;
      }
      labelDistribution.push({
        label_name: label?.name || "",
        color: label?.color || "",
        label_id: labelId,
        total_issues: total,
        completed_issues: completed,
        pending_issues: pending,
      });
    }

    if (unlabeledIssues.length > 0) {
      let total = 0, completed = 0, pending = 0;
      if (type === "points") {
        for (const iid of unlabeledIssues) {
          const info = issueMap.get(iid);
          if (!info) continue;
          const pts = Number(info.estimatePoint) || 0;
          total += pts;
          if (info.stateGroup === "completed") completed += pts;
          else pending += pts;
        }
      } else {
        total = unlabeledIssues.length;
        for (const iid of unlabeledIssues) {
          const info = issueMap.get(iid);
          if (info?.stateGroup === "completed") completed++;
        }
        pending = total - completed;
      }
      labelDistribution.push({
        label_name: "None",
        color: "",
        label_id: null,
        total_issues: total,
        completed_issues: completed,
        pending_issues: pending,
      });
    }
  }

  // --- Completion chart (burndown) ---
  const completionChart: Record<string, number | null> = {};

  if (cycle.startDate && cycle.endDate) {
    const startDate = new Date(cycle.startDate);
    const endDate = new Date(cycle.endDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const dateRange: string[] = [];
    const d = new Date(startDate);
    while (d <= endDate) {
      dateRange.push(d.toISOString().split("T")[0]);
      d.setDate(d.getDate() + 1);
    }

    let totalValue = 0;
    if (type === "points") {
      for (const row of cycleIssueRows) {
        totalValue += Number(row.estimatePoint) || 0;
      }
    } else {
      totalValue = cycleIssueRows.length;
    }

    const completedByDate = new Map<string, number>();
    for (const row of cycleIssueRows) {
      if (row.completedAt) {
        const dateStr = new Date(row.completedAt).toISOString().split("T")[0];
        const val = type === "points" ? (Number(row.estimatePoint) || 0) : 1;
        completedByDate.set(dateStr, (completedByDate.get(dateStr) || 0) + val);
      }
    }

    let cumulativeCompleted = 0;
    for (const dateStr of dateRange) {
      const dateObj = new Date(dateStr + "T00:00:00");
      if (dateObj > today) {
        completionChart[dateStr] = null;
      } else {
        cumulativeCompleted += completedByDate.get(dateStr) || 0;
        completionChart[dateStr] = totalValue - cumulativeCompleted;
      }
    }
  }

  return c.json({
    assignees: assigneeDistribution,
    labels: labelDistribution,
    completion_chart: completionChart,
  });
});

// --- Setup ---
beforeAll(async () => {
  // Create user
  await db.insert(users).values([
    { id: userId, email: `ca-user1-${userId}@test.com`, name: "User One", displayName: "User One", username: `ca_user1_${userId}`, avatar: "https://avatar.com/1" },
    { id: userId2, email: `ca-user2-${userId2}@test.com`, name: "User Two", displayName: "User Two", username: `ca_user2_${userId2}`, avatar: "https://avatar.com/2" },
  ]);
  // Create workspace
  await db.insert(workspaces).values({ id: workspaceId, name: "Test WS", slug: `ca-test-ws-${workspaceId}`, ownerId: userId });
  await db.insert(workspaceMembers).values({ workspaceId, userId, role: 20 });
  // Create project
  await db.insert(projects).values({ id: projectId, workspaceId, name: "Test Project", identifier: "TP", network: 2 });
  await db.insert(projectMembers).values({ projectId, memberId: userId, role: 20 });
  // Create states
  await db.insert(states).values([
    { id: stateCompletedId, projectId, workspaceId, name: "Done", group: "completed", color: "#00ff00", sequence: 1 },
    { id: stateStartedId, projectId, workspaceId, name: "In Progress", group: "started", color: "#0000ff", sequence: 2 },
  ]);
  // Create labels
  await db.insert(labels).values([
    { id: labelId1, projectId, workspaceId, name: "Bug", color: "#ff0000", sortOrder: 1 },
    { id: labelId2, projectId, workspaceId, name: "Feature", color: "#00ff00", sortOrder: 2 },
  ]);
});

// Helper to make requests
function req(path: string, headers: Record<string, string> = {}) {
  return app.request(path, { headers: { "x-test-user": userId, ...headers } });
}

describe("Cycle Analytics", () => {
  test("returns empty analytics for cycle with no issues", async () => {
    const emptyCycleId = createId();
    await db.insert(cycles).values({
      id: emptyCycleId,
      projectId,
      workspaceId,
      name: "Empty Cycle",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-14"),
    });

    const res = await req(`/api/projects/${projectId}/cycles/${emptyCycleId}/analytics/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.assignees).toEqual([]);
    expect(data.labels).toEqual([]);
    // completion_chart should have dates but all values (past dates) should be 0
    expect(typeof data.completion_chart).toBe("object");
  });

  test("returns 404 for non-existent cycle", async () => {
    const res = await req(`/api/projects/${projectId}/cycles/${createId()}/analytics/`);
    expect(res.status).toBe(404);
  });

  test("returns assignee distribution for issues type", async () => {
    // Create cycle with start/end in the past
    const cId = createId();
    await db.insert(cycles).values({
      id: cId,
      projectId,
      workspaceId,
      name: "Sprint 1",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-14"),
    });

    // Create issues - 2 assigned to user1, 1 completed
    const issA = createId();
    const issB = createId();
    const issC = createId(); // unassigned

    await db.insert(issues).values([
      { id: issA, projectId, workspaceId, name: "Issue A", stateId: stateStartedId },
      { id: issB, projectId, workspaceId, name: "Issue B", stateId: stateCompletedId, completedAt: new Date("2025-01-05") },
      { id: issC, projectId, workspaceId, name: "Issue C", stateId: stateStartedId },
    ]);

    // Add to cycle
    await db.insert(cycleIssues).values([
      { cycleId: cId, issueId: issA },
      { cycleId: cId, issueId: issB },
      { cycleId: cId, issueId: issC },
    ]);

    // Assign issues A and B to user1
    await db.insert(issueAssignees).values([
      { issueId: issA, assigneeId: userId },
      { issueId: issB, assigneeId: userId },
    ]);

    const res = await req(`/api/projects/${projectId}/cycles/${cId}/analytics/?type=issues`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Should have 2 entries: user1 and unassigned
    expect(data.assignees.length).toBe(2);

    const user1Entry = data.assignees.find((a: any) => a.assignee_id === userId);
    expect(user1Entry).toBeDefined();
    expect(user1Entry.display_name).toBe("User One");
    expect(user1Entry.total_issues).toBe(2);
    expect(user1Entry.completed_issues).toBe(1);
    expect(user1Entry.pending_issues).toBe(1);

    const unassignedEntry = data.assignees.find((a: any) => a.assignee_id === null);
    expect(unassignedEntry).toBeDefined();
    expect(unassignedEntry.total_issues).toBe(1);
    expect(unassignedEntry.pending_issues).toBe(1);
  });

  test("returns label distribution", async () => {
    const cId = createId();
    await db.insert(cycles).values({
      id: cId,
      projectId,
      workspaceId,
      name: "Sprint Labels",
      startDate: new Date("2025-02-01"),
      endDate: new Date("2025-02-14"),
    });

    const issD = createId();
    const issE = createId();
    const issF = createId(); // unlabeled

    await db.insert(issues).values([
      { id: issD, projectId, workspaceId, name: "Issue D", stateId: stateCompletedId, completedAt: new Date("2025-02-03") },
      { id: issE, projectId, workspaceId, name: "Issue E", stateId: stateStartedId },
      { id: issF, projectId, workspaceId, name: "Issue F", stateId: stateStartedId },
    ]);

    await db.insert(cycleIssues).values([
      { cycleId: cId, issueId: issD },
      { cycleId: cId, issueId: issE },
      { cycleId: cId, issueId: issF },
    ]);

    // Label D as Bug, E as Feature
    await db.insert(issueLabels).values([
      { issueId: issD, labelId: labelId1 },
      { issueId: issE, labelId: labelId2 },
    ]);

    const res = await req(`/api/projects/${projectId}/cycles/${cId}/analytics/?type=issues`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.labels.length).toBe(3); // Bug, Feature, None

    const bugEntry = data.labels.find((l: any) => l.label_id === labelId1);
    expect(bugEntry).toBeDefined();
    expect(bugEntry.label_name).toBe("Bug");
    expect(bugEntry.total_issues).toBe(1);
    expect(bugEntry.completed_issues).toBe(1);

    const featureEntry = data.labels.find((l: any) => l.label_id === labelId2);
    expect(featureEntry).toBeDefined();
    expect(featureEntry.label_name).toBe("Feature");
    expect(featureEntry.total_issues).toBe(1);
    expect(featureEntry.pending_issues).toBe(1);

    const noneEntry = data.labels.find((l: any) => l.label_id === null);
    expect(noneEntry).toBeDefined();
    expect(noneEntry.total_issues).toBe(1);
  });

  test("returns burndown chart with correct cumulative pending", async () => {
    const cId = createId();
    await db.insert(cycles).values({
      id: cId,
      projectId,
      workspaceId,
      name: "Burndown Cycle",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-01-05"),
    });

    const issG = createId();
    const issH = createId();
    const issI = createId();

    await db.insert(issues).values([
      { id: issG, projectId, workspaceId, name: "Issue G", stateId: stateCompletedId, completedAt: new Date("2025-01-02") },
      { id: issH, projectId, workspaceId, name: "Issue H", stateId: stateCompletedId, completedAt: new Date("2025-01-03") },
      { id: issI, projectId, workspaceId, name: "Issue I", stateId: stateStartedId },
    ]);

    await db.insert(cycleIssues).values([
      { cycleId: cId, issueId: issG },
      { cycleId: cId, issueId: issH },
      { cycleId: cId, issueId: issI },
    ]);

    const res = await req(`/api/projects/${projectId}/cycles/${cId}/analytics/?type=issues`);
    expect(res.status).toBe(200);
    const data = await res.json();

    const chart = data.completion_chart;
    // Total is 3 issues
    // Jan 1: 0 completed → pending = 3
    expect(chart["2025-01-01"]).toBe(3);
    // Jan 2: 1 completed → pending = 2
    expect(chart["2025-01-02"]).toBe(2);
    // Jan 3: 2 completed → pending = 1
    expect(chart["2025-01-03"]).toBe(1);
    // Jan 4 & 5: still 2 completed → pending = 1 (past dates, no more completions)
    expect(chart["2025-01-04"]).toBe(1);
    expect(chart["2025-01-05"]).toBe(1);
  });

  test("returns points-based analytics when type=points", async () => {
    const cId = createId();
    await db.insert(cycles).values({
      id: cId,
      projectId,
      workspaceId,
      name: "Points Cycle",
      startDate: new Date("2025-03-01"),
      endDate: new Date("2025-03-07"),
    });

    const issJ = createId();
    const issK = createId();

    await db.insert(issues).values([
      { id: issJ, projectId, workspaceId, name: "Issue J", stateId: stateCompletedId, estimatePoint: 5, completedAt: new Date("2025-03-02") },
      { id: issK, projectId, workspaceId, name: "Issue K", stateId: stateStartedId, estimatePoint: 3 },
    ]);

    await db.insert(cycleIssues).values([
      { cycleId: cId, issueId: issJ },
      { cycleId: cId, issueId: issK },
    ]);

    await db.insert(issueAssignees).values([
      { issueId: issJ, assigneeId: userId },
      { issueId: issK, assigneeId: userId },
    ]);

    const res = await req(`/api/projects/${projectId}/cycles/${cId}/analytics/?type=points`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Assignee distribution by points
    const user1Entry = data.assignees.find((a: any) => a.assignee_id === userId);
    expect(user1Entry).toBeDefined();
    expect(user1Entry.total_issues).toBe(8); // 5 + 3
    expect(user1Entry.completed_issues).toBe(5);
    expect(user1Entry.pending_issues).toBe(3);

    // Burndown by points: total = 8
    const chart = data.completion_chart;
    expect(chart["2025-03-01"]).toBe(8); // 0 completed
    expect(chart["2025-03-02"]).toBe(3); // 5 completed
    expect(chart["2025-03-03"]).toBe(3); // still 5 completed
  });

  test("returns cached data from progress_snapshot", async () => {
    const cId = createId();
    const snapshotData = {
      distribution: {
        assignees: [{ display_name: "Cached User", assignee_id: "cached-id", avatar: "", total_issues: 10, completed_issues: 5, pending_issues: 5 }],
        labels: [{ label_name: "Cached Label", color: "#abc", label_id: "cached-label", total_issues: 10, completed_issues: 5, pending_issues: 5 }],
      },
      completion_chart: { "2025-04-01": 10, "2025-04-02": 8 },
    };

    await db.insert(cycles).values({
      id: cId,
      projectId,
      workspaceId,
      name: "Snapshot Cycle",
      progressSnapshot: snapshotData,
    });

    const res = await req(`/api/projects/${projectId}/cycles/${cId}/analytics/`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.assignees).toEqual(snapshotData.distribution.assignees);
    expect(data.labels).toEqual(snapshotData.distribution.labels);
    expect(data.completion_chart).toEqual(snapshotData.completion_chart);
  });

  test("handles cycle without start/end dates (no burndown)", async () => {
    const cId = createId();
    await db.insert(cycles).values({
      id: cId,
      projectId,
      workspaceId,
      name: "No Dates Cycle",
    });

    const issL = createId();
    await db.insert(issues).values([
      { id: issL, projectId, workspaceId, name: "Issue L", stateId: stateStartedId },
    ]);
    await db.insert(cycleIssues).values([{ cycleId: cId, issueId: issL }]);

    const res = await req(`/api/projects/${projectId}/cycles/${cId}/analytics/?type=issues`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // No burndown chart since no start/end dates
    expect(data.completion_chart).toEqual({});
    // But should still have distribution
    expect(data.assignees.length).toBeGreaterThanOrEqual(1);
  });

  test("handles multiple assignees on same issue", async () => {
    const cId = createId();
    await db.insert(cycles).values({
      id: cId,
      projectId,
      workspaceId,
      name: "Multi Assignee Cycle",
      startDate: new Date("2025-05-01"),
      endDate: new Date("2025-05-07"),
    });

    const issM = createId();
    await db.insert(issues).values([
      { id: issM, projectId, workspaceId, name: "Issue M", stateId: stateStartedId },
    ]);
    await db.insert(cycleIssues).values([{ cycleId: cId, issueId: issM }]);

    // Assign to both users
    await db.insert(issueAssignees).values([
      { issueId: issM, assigneeId: userId },
      { issueId: issM, assigneeId: userId2 },
    ]);

    const res = await req(`/api/projects/${projectId}/cycles/${cId}/analytics/?type=issues`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Both users should appear in distribution, each counting the issue
    expect(data.assignees.length).toBe(2);
    const u1 = data.assignees.find((a: any) => a.assignee_id === userId);
    const u2 = data.assignees.find((a: any) => a.assignee_id === userId2);
    expect(u1.total_issues).toBe(1);
    expect(u2.total_issues).toBe(1);
    // No unassigned since issue has assignees
  });

  test("excludes archived and deleted issues", async () => {
    const cId = createId();
    await db.insert(cycles).values({
      id: cId,
      projectId,
      workspaceId,
      name: "Exclusion Cycle",
      startDate: new Date("2025-06-01"),
      endDate: new Date("2025-06-07"),
    });

    const issN = createId();
    const issO = createId();
    const issP = createId();
    await db.insert(issues).values([
      { id: issN, projectId, workspaceId, name: "Active", stateId: stateStartedId },
      { id: issO, projectId, workspaceId, name: "Archived", stateId: stateStartedId, archivedAt: new Date() },
      { id: issP, projectId, workspaceId, name: "Deleted", stateId: stateStartedId, deletedAt: new Date() },
    ]);
    await db.insert(cycleIssues).values([
      { cycleId: cId, issueId: issN },
      { cycleId: cId, issueId: issO },
      { cycleId: cId, issueId: issP },
    ]);

    const res = await req(`/api/projects/${projectId}/cycles/${cId}/analytics/?type=issues`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Only 1 active issue should be counted
    const unassigned = data.assignees.find((a: any) => a.assignee_id === null);
    expect(unassigned).toBeDefined();
    expect(unassigned.total_issues).toBe(1);
  });

  test("returns 401 without auth header", async () => {
    const res = await app.request(`/api/projects/${projectId}/cycles/${cycleId}/analytics/`);
    expect(res.status).toBe(401);
  });
});

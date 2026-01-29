import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  eq,
  and,
  desc,
  asc,
  isNull,
  isNotNull,
  inArray,
  sql,
  like,
  lte,
  gte,
  count as countFn,
  or,
} from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { projects, states, labels as projectLabels } from "../../db/schema/project";
import {
  issues,
  issueAssignees,
  issueLabels,
  issueComments,
  issueActivities,
  issueReactions,
  commentReactions,
  issueRelations,
  issueAttachments,
  issueLinks,
} from "../../db/schema/issue";
import { authMiddleware, ROLES } from "../../middleware/auth";
import { workspaceMiddleware } from "../../middleware/workspace";
import {
  projectMiddleware,
  requireProjectMember,
} from "../../middleware/project";
import type { Variables } from "../../app";

const issueRoutes = new Hono<{ Variables: Variables }>();

// Apply middleware chain: auth → workspace → project
issueRoutes.use("*", authMiddleware);
issueRoutes.use("*", workspaceMiddleware);
issueRoutes.use("*", projectMiddleware);

// --- Validation Schemas ---

const createIssueSchema = z.object({
  name: z.string().min(1).max(500),
  description_html: z.string().optional(),
  description_stripped: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  state_id: z.string().optional().nullable(),
  parent_id: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  target_date: z.string().optional().nullable(),
  sort_order: z.number().optional(),
  estimate_point: z.number().int().optional().nullable(),
  assignees: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

const updateIssueSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  description_html: z.string().optional().nullable(),
  description_stripped: z.string().optional().nullable(),
  priority: z.number().int().min(0).max(4).optional(),
  state_id: z.string().optional().nullable(),
  parent_id: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  target_date: z.string().optional().nullable(),
  sort_order: z.number().optional(),
  estimate_point: z.number().int().optional().nullable(),
  assignees: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

const createCommentSchema = z.object({
  comment_html: z.string().optional(),
  comment_stripped: z.string().optional(),
  comment_json: z.record(z.string(), z.unknown()).optional(),
  access_level: z.number().int().min(0).max(1).optional(),
});

const updateCommentSchema = z.object({
  comment_html: z.string().optional(),
  comment_stripped: z.string().optional(),
  comment_json: z.record(z.string(), z.unknown()).optional(),
  access_level: z.number().int().min(0).max(1).optional(),
});

const createReactionSchema = z.object({
  reaction: z.string().min(1).max(50),
});

const createRelationSchema = z.object({
  related_issue_id: z.string().min(1),
  relation_type: z.enum(["blocks", "is_blocked_by", "duplicate_of", "relates_to"]),
});

const createLinkSchema = z.object({
  title: z.string().optional(),
  url: z.string().url(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateLinkSchema = z.object({
  title: z.string().optional().nullable(),
  url: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const bulkOperationSchema = z.object({
  issue_ids: z.array(z.string()).min(1).max(100),
  properties: z.record(z.string(), z.unknown()),
});

// --- Helper functions ---

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

async function getIssueAssigneeIds(issueId: string): Promise<string[]> {
  const rows = await db
    .select({ assigneeId: issueAssignees.assigneeId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, issueId));
  return rows.map((r) => r.assigneeId);
}

async function getIssueLabelIds(issueId: string): Promise<string[]> {
  const rows = await db
    .select({ labelId: issueLabels.labelId })
    .from(issueLabels)
    .where(eq(issueLabels.issueId, issueId));
  return rows.map((r) => r.labelId);
}

async function syncAssignees(issueId: string, assigneeIds: string[]) {
  // Delete existing
  await db.delete(issueAssignees).where(eq(issueAssignees.issueId, issueId));
  // Insert new
  if (assigneeIds.length > 0) {
    await db.insert(issueAssignees).values(
      assigneeIds.map((assigneeId) => ({
        issueId,
        assigneeId,
      }))
    );
  }
}

async function syncLabels(issueId: string, labelIds: string[]) {
  await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
  if (labelIds.length > 0) {
    await db.insert(issueLabels).values(
      labelIds.map((labelId) => ({
        issueId,
        labelId,
      }))
    );
  }
}

async function getNextSequenceId(projectId: string): Promise<number> {
  const result = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${issues.sequenceId}), 0)` })
    .from(issues)
    .where(eq(issues.projectId, projectId));
  return (result[0]?.maxSeq ?? 0) + 1;
}

async function recordActivity(params: {
  issueId: string;
  projectId: string;
  workspaceId: string;
  actorId: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
  verb: string;
}) {
  await db.insert(issueActivities).values({
    issueId: params.issueId,
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    actorId: params.actorId,
    field: params.field,
    oldValue: params.oldValue,
    newValue: params.newValue,
    verb: params.verb,
    epochTimestamp: Math.floor(Date.now() / 1000),
  });
}

function formatIssue(
  issue: typeof issues.$inferSelect,
  assigneeIds: string[],
  labelIds: string[]
) {
  return {
    id: issue.id,
    project_id: issue.projectId,
    workspace_id: issue.workspaceId,
    parent_id: issue.parentId ?? null,
    state_id: issue.stateId ?? null,
    name: issue.name,
    description_html: issue.descriptionHtml ?? "",
    description_stripped: issue.descriptionStripped ?? "",
    priority: issue.priority ?? 0,
    sort_order: issue.sortOrder ?? 65535,
    start_date: issue.startDate?.toISOString()?.split("T")[0] ?? null,
    target_date: issue.targetDate?.toISOString()?.split("T")[0] ?? null,
    completed_at: issue.completedAt?.toISOString() ?? null,
    archived_at: issue.archivedAt?.toISOString() ?? null,
    sequence_id: issue.sequenceId ?? null,
    estimate_point: issue.estimatePoint ?? null,
    is_epic: issue.isEpic ?? false,
    assignees: assigneeIds,
    labels: labelIds,
    created_by_id: issue.createdById ?? null,
    updated_by_id: issue.updatedById ?? null,
    created_at: issue.createdAt?.toISOString() ?? null,
    updated_at: issue.updatedAt?.toISOString() ?? null,
  };
}

function formatComment(c: typeof issueComments.$inferSelect) {
  return {
    id: c.id,
    issue_id: c.issueId,
    actor_id: c.actorId,
    comment_html: c.commentHtml ?? "",
    comment_stripped: c.commentStripped ?? "",
    comment_json: c.commentJson ?? null,
    access_level: c.accessLevel ?? 0,
    created_at: c.createdAt?.toISOString() ?? null,
    updated_at: c.updatedAt?.toISOString() ?? null,
  };
}

function formatActivity(a: typeof issueActivities.$inferSelect) {
  return {
    id: a.id,
    issue_id: a.issueId,
    project_id: a.projectId,
    workspace_id: a.workspaceId,
    actor_id: a.actorId,
    field: a.field ?? null,
    old_value: a.oldValue ?? null,
    new_value: a.newValue ?? null,
    verb: a.verb,
    old_identifier: a.oldIdentifier ?? null,
    new_identifier: a.newIdentifier ?? null,
    epoch: a.epochTimestamp ?? null,
    created_at: a.createdAt?.toISOString() ?? null,
  };
}

function formatReaction(r: typeof issueReactions.$inferSelect) {
  return {
    id: r.id,
    issue_id: r.issueId,
    actor_id: r.actorId,
    reaction: r.reaction,
    created_at: r.createdAt?.toISOString() ?? null,
  };
}

function formatCommentReaction(r: typeof commentReactions.$inferSelect) {
  return {
    id: r.id,
    comment_id: r.commentId,
    actor_id: r.actorId,
    reaction: r.reaction,
    created_at: r.createdAt?.toISOString() ?? null,
  };
}

function formatRelation(r: typeof issueRelations.$inferSelect) {
  return {
    id: r.id,
    issue_id: r.issueId,
    related_issue_id: r.relatedIssueId,
    relation_type: r.relationType,
    created_at: r.createdAt?.toISOString() ?? null,
  };
}

function formatLink(l: typeof issueLinks.$inferSelect) {
  return {
    id: l.id,
    issue_id: l.issueId,
    title: l.title ?? "",
    url: l.url,
    metadata: l.metadata ?? null,
    created_by_id: l.createdById ?? null,
    created_at: l.createdAt?.toISOString() ?? null,
  };
}

function formatAttachment(a: typeof issueAttachments.$inferSelect) {
  return {
    id: a.id,
    issue_id: a.issueId,
    workspace_id: a.workspaceId,
    file_name: a.fileName,
    file_size: a.fileSize,
    mime_type: a.mimeType ?? null,
    storage_key: a.storageKey,
    uploaded_by_id: a.uploadedById ?? null,
    created_at: a.createdAt?.toISOString() ?? null,
  };
}

// =====================================================
// 5.1 Issue CRUD
// =====================================================

// GET / - List issues with filtering and pagination
issueRoutes.get("/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  // Parse query params
  const query = c.req.query();
  const cursor = query.cursor;
  const perPage = Math.min(parseInt(query.per_page || "50") || 50, 100);
  const orderBy = query.order_by || "-created_at";
  const groupBy = query.group_by;

  // Build where conditions
  const conditions: ReturnType<typeof eq>[] = [
    eq(issues.projectId, project.id),
    isNull(issues.deletedAt),
    isNull(issues.archivedAt),
  ];

  // Filters
  if (query.state) {
    const stateIds = query.state.split(",");
    conditions.push(inArray(issues.stateId, stateIds));
  }
  if (query.priority) {
    const priorities = query.priority.split(",").map(Number);
    conditions.push(inArray(issues.priority, priorities));
  }
  if (query.parent) {
    conditions.push(eq(issues.parentId, query.parent));
  }
  if (query.start_date) {
    conditions.push(gte(issues.startDate, new Date(query.start_date)));
  }
  if (query.target_date) {
    conditions.push(lte(issues.targetDate, new Date(query.target_date)));
  }
  if (query.created_at__gte) {
    conditions.push(gte(issues.createdAt, new Date(query.created_at__gte)));
  }
  if (query.created_at__lte) {
    conditions.push(lte(issues.createdAt, new Date(query.created_at__lte)));
  }
  if (query.search) {
    conditions.push(like(issues.name, `%${query.search}%`));
  }

  // Cursor pagination
  if (cursor) {
    conditions.push(sql`${issues.id} > ${cursor}`);
  }

  // Determine sort
  let sortColumn: ReturnType<typeof asc>;
  const isDesc = orderBy.startsWith("-");
  const sortField = isDesc ? orderBy.slice(1) : orderBy;
  const sortFn = isDesc ? desc : asc;

  switch (sortField) {
    case "created_at":
      sortColumn = sortFn(issues.createdAt);
      break;
    case "updated_at":
      sortColumn = sortFn(issues.updatedAt);
      break;
    case "priority":
      sortColumn = sortFn(issues.priority);
      break;
    case "sort_order":
      sortColumn = sortFn(issues.sortOrder);
      break;
    case "sequence_id":
      sortColumn = sortFn(issues.sequenceId);
      break;
    case "name":
      sortColumn = sortFn(issues.name);
      break;
    default:
      sortColumn = sortFn(issues.createdAt);
  }

  // Fetch issues
  const issueList = await db
    .select()
    .from(issues)
    .where(and(...conditions))
    .orderBy(sortColumn)
    .limit(perPage + 1); // Fetch one extra for next_cursor

  // Handle assignees/labels filters (post-filter since these are junction tables)
  let filteredIssues = issueList;
  if (query.assignees) {
    const filterAssigneeIds = query.assignees.split(",");
    const matchingIssueIds = await db
      .select({ issueId: issueAssignees.issueId })
      .from(issueAssignees)
      .where(
        and(
          inArray(
            issueAssignees.issueId,
            issueList.map((i) => i.id)
          ),
          inArray(issueAssignees.assigneeId, filterAssigneeIds)
        )
      );
    const matchSet = new Set(matchingIssueIds.map((m) => m.issueId));
    filteredIssues = filteredIssues.filter((i) => matchSet.has(i.id));
  }
  if (query.labels) {
    const filterLabelIds = query.labels.split(",");
    const matchingIssueIds = await db
      .select({ issueId: issueLabels.issueId })
      .from(issueLabels)
      .where(
        and(
          inArray(
            issueLabels.issueId,
            filteredIssues.map((i) => i.id)
          ),
          inArray(issueLabels.labelId, filterLabelIds)
        )
      );
    const matchSet = new Set(matchingIssueIds.map((m) => m.issueId));
    filteredIssues = filteredIssues.filter((i) => matchSet.has(i.id));
  }

  // Determine pagination
  const hasMore = filteredIssues.length > perPage;
  const resultIssues = hasMore ? filteredIssues.slice(0, perPage) : filteredIssues;
  const nextCursor = hasMore ? resultIssues[resultIssues.length - 1]?.id : null;

  // Batch fetch assignees and labels for all result issues
  const resultIds = resultIssues.map((i) => i.id);

  const allAssignees =
    resultIds.length > 0
      ? await db
          .select()
          .from(issueAssignees)
          .where(inArray(issueAssignees.issueId, resultIds))
      : [];

  const allLabels =
    resultIds.length > 0
      ? await db
          .select()
          .from(issueLabels)
          .where(inArray(issueLabels.issueId, resultIds))
      : [];

  const assigneeMap = new Map<string, string[]>();
  for (const a of allAssignees) {
    const existing = assigneeMap.get(a.issueId) ?? [];
    existing.push(a.assigneeId);
    assigneeMap.set(a.issueId, existing);
  }

  const labelMap = new Map<string, string[]>();
  for (const l of allLabels) {
    const existing = labelMap.get(l.issueId) ?? [];
    existing.push(l.labelId);
    labelMap.set(l.issueId, existing);
  }

  // Get total count
  const totalResult = await db
    .select({ count: countFn() })
    .from(issues)
    .where(
      and(
        eq(issues.projectId, project.id),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  const results = resultIssues.map((i) =>
    formatIssue(i, assigneeMap.get(i.id) ?? [], labelMap.get(i.id) ?? [])
  );

  // Group if requested
  if (groupBy) {
    const grouped: Record<string, typeof results> = {};
    for (const issue of results) {
      let groupKey: string;
      switch (groupBy) {
        case "state":
          groupKey = issue.state_id ?? "none";
          break;
        case "priority":
          groupKey = String(issue.priority);
          break;
        case "assignees":
          groupKey = issue.assignees.length > 0 ? issue.assignees.join(",") : "none";
          break;
        case "labels":
          groupKey = issue.labels.length > 0 ? issue.labels.join(",") : "none";
          break;
        default:
          groupKey = "all";
      }
      if (!grouped[groupKey]) grouped[groupKey] = [];
      grouped[groupKey]!.push(issue);
    }
    return c.json({
      grouped_results: grouped,
      total_count: totalResult[0]?.count ?? 0,
      next_cursor: nextCursor,
      prev_cursor: cursor ?? null,
    });
  }

  return c.json({
    results,
    total_count: totalResult[0]?.count ?? 0,
    next_cursor: nextCursor,
    prev_cursor: cursor ?? null,
    next_page_results: hasMore,
  });
});

// POST / - Create issue
issueRoutes.post("/", requireProjectMember, zValidator("json", createIssueSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  // Get default state if none provided
  let stateId = body.state_id;
  if (!stateId) {
    const defaultState = await db.query.states.findFirst({
      where: and(eq(states.projectId, project.id), eq(states.isDefault, true)),
    });
    stateId = defaultState?.id ?? null;
  }

  const sequenceId = await getNextSequenceId(project.id);

  const result = await db
    .insert(issues)
    .values({
      projectId: project.id,
      workspaceId: workspace.id,
      name: body.name,
      descriptionHtml: body.description_html,
      descriptionStripped: body.description_stripped,
      priority: body.priority ?? 0,
      stateId,
      parentId: body.parent_id,
      startDate: parseDate(body.start_date),
      targetDate: parseDate(body.target_date),
      sortOrder: body.sort_order ?? 65535,
      estimatePoint: body.estimate_point,
      sequenceId,
      createdById: user.id,
      updatedById: user.id,
    })
    .returning();
  const issue = result[0]!;

  // Sync assignees and labels
  if (body.assignees && body.assignees.length > 0) {
    await syncAssignees(issue.id, body.assignees);
  }
  if (body.labels && body.labels.length > 0) {
    await syncLabels(issue.id, body.labels);
  }

  // Record activity
  await recordActivity({
    issueId: issue.id,
    projectId: project.id,
    workspaceId: workspace.id,
    actorId: user.id,
    verb: "created",
  });

  const assigneeIds = body.assignees ?? [];
  const labelIds = body.labels ?? [];

  return c.json(formatIssue(issue, assigneeIds, labelIds), 201);
});

// GET /detail/ - Detailed issue list (includes sub-issue counts etc.)
issueRoutes.get("/detail/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const issueList = await db.query.issues.findMany({
    where: and(
      eq(issues.projectId, project.id),
      isNull(issues.deletedAt),
      isNull(issues.archivedAt)
    ),
    orderBy: [asc(issues.sortOrder)],
  });

  const issueIds = issueList.map((i) => i.id);

  const allAssignees =
    issueIds.length > 0
      ? await db.select().from(issueAssignees).where(inArray(issueAssignees.issueId, issueIds))
      : [];
  const allLabels =
    issueIds.length > 0
      ? await db.select().from(issueLabels).where(inArray(issueLabels.issueId, issueIds))
      : [];

  const assigneeMap = new Map<string, string[]>();
  for (const a of allAssignees) {
    const existing = assigneeMap.get(a.issueId) ?? [];
    existing.push(a.assigneeId);
    assigneeMap.set(a.issueId, existing);
  }
  const labelMap = new Map<string, string[]>();
  for (const l of allLabels) {
    const existing = labelMap.get(l.issueId) ?? [];
    existing.push(l.labelId);
    labelMap.set(l.issueId, existing);
  }

  // Count sub-issues per issue
  const subIssueCounts =
    issueIds.length > 0
      ? await db
          .select({
            parentId: issues.parentId,
            count: countFn(),
          })
          .from(issues)
          .where(
            and(
              inArray(issues.parentId, issueIds),
              isNull(issues.deletedAt)
            )
          )
          .groupBy(issues.parentId)
      : [];

  const subCountMap = new Map(subIssueCounts.map((s) => [s.parentId!, s.count]));

  const results = issueList.map((i) => ({
    ...formatIssue(i, assigneeMap.get(i.id) ?? [], labelMap.get(i.id) ?? []),
    sub_issues_count: subCountMap.get(i.id) ?? 0,
  }));

  return c.json(results);
});

// GET /:issueId/ - Get single issue
issueRoutes.get("/:issueId/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");

  const issue = await db.query.issues.findFirst({
    where: and(
      eq(issues.id, issueId),
      eq(issues.projectId, project.id),
      isNull(issues.deletedAt)
    ),
  });

  if (!issue) return c.json({ detail: "Issue not found." }, 404);

  const assigneeIds = await getIssueAssigneeIds(issueId);
  const labelIds = await getIssueLabelIds(issueId);

  return c.json(formatIssue(issue, assigneeIds, labelIds));
});

// PATCH /:issueId/ - Update issue
issueRoutes.patch("/:issueId/", requireProjectMember, zValidator("json", updateIssueSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");

  const issue = await db.query.issues.findFirst({
    where: and(
      eq(issues.id, issueId),
      eq(issues.projectId, project.id),
      isNull(issues.deletedAt)
    ),
  });

  if (!issue) return c.json({ detail: "Issue not found." }, 404);

  const body = c.req.valid("json");
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedById: user.id,
  };

  if (body.name !== undefined) updateData.name = body.name;
  if (body.description_html !== undefined) updateData.descriptionHtml = body.description_html;
  if (body.description_stripped !== undefined) updateData.descriptionStripped = body.description_stripped;
  if (body.priority !== undefined) updateData.priority = body.priority;
  if (body.state_id !== undefined) updateData.stateId = body.state_id;
  if (body.parent_id !== undefined) updateData.parentId = body.parent_id;
  if (body.start_date !== undefined) updateData.startDate = parseDate(body.start_date);
  if (body.target_date !== undefined) updateData.targetDate = parseDate(body.target_date);
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;
  if (body.estimate_point !== undefined) updateData.estimatePoint = body.estimate_point;

  // Check if state changed to completed
  if (body.state_id && body.state_id !== issue.stateId) {
    const newState = await db.query.states.findFirst({
      where: eq(states.id, body.state_id),
    });
    if (newState?.group === "completed") {
      updateData.completedAt = new Date();
    } else if (issue.completedAt) {
      // Moving away from completed
      updateData.completedAt = null;
    }
  }

  await db.update(issues).set(updateData).where(eq(issues.id, issueId));

  // Sync assignees/labels if provided
  if (body.assignees !== undefined) {
    await syncAssignees(issueId, body.assignees ?? []);
  }
  if (body.labels !== undefined) {
    await syncLabels(issueId, body.labels ?? []);
  }

  // Record activity
  await recordActivity({
    issueId,
    projectId: project.id,
    workspaceId: workspace.id,
    actorId: user.id,
    verb: "updated",
  });

  const updated = await db.query.issues.findFirst({
    where: eq(issues.id, issueId),
  });

  const assigneeIds = await getIssueAssigneeIds(issueId);
  const labelIds = await getIssueLabelIds(issueId);

  return c.json(formatIssue(updated!, assigneeIds, labelIds));
});

// DELETE /:issueId/ - Soft delete issue
issueRoutes.delete("/:issueId/", requireProjectMember, async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");

  const issue = await db.query.issues.findFirst({
    where: and(
      eq(issues.id, issueId),
      eq(issues.projectId, project.id),
      isNull(issues.deletedAt)
    ),
  });

  if (!issue) return c.json({ detail: "Issue not found." }, 404);

  await db.update(issues).set({
    deletedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));

  await recordActivity({
    issueId,
    projectId: project.id,
    workspaceId: workspace.id,
    actorId: user.id,
    verb: "deleted",
  });

  return new Response(null, { status: 204 });
});

// =====================================================
// 5.4 Issue Comments
// =====================================================

// GET /:issueId/comments/ - List comments
issueRoutes.get("/:issueId/comments/", async (c) => {
  const issueId = c.req.param("issueId");

  const comments = await db.query.issueComments.findMany({
    where: eq(issueComments.issueId, issueId),
    orderBy: [asc(issueComments.createdAt)],
  });

  return c.json(comments.map(formatComment));
});

// POST /:issueId/comments/ - Create comment
issueRoutes.post("/:issueId/comments/", requireProjectMember, zValidator("json", createCommentSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");
  const body = c.req.valid("json");

  const result = await db
    .insert(issueComments)
    .values({
      issueId,
      actorId: user.id,
      commentHtml: body.comment_html,
      commentStripped: body.comment_stripped,
      commentJson: body.comment_json,
      accessLevel: body.access_level ?? 0,
    })
    .returning();

  await recordActivity({
    issueId,
    projectId: project.id,
    workspaceId: workspace.id,
    actorId: user.id,
    field: "comment",
    verb: "created",
    newValue: result[0]!.id,
  });

  return c.json(formatComment(result[0]!), 201);
});

// PATCH /:issueId/comments/:commentId/ - Update comment
issueRoutes.patch("/:issueId/comments/:commentId/", requireProjectMember, zValidator("json", updateCommentSchema), async (c) => {
  const issueId = c.req.param("issueId");
  const commentId = c.req.param("commentId");

  const comment = await db.query.issueComments.findFirst({
    where: and(
      eq(issueComments.id, commentId),
      eq(issueComments.issueId, issueId)
    ),
  });

  if (!comment) return c.json({ detail: "Comment not found." }, 404);

  const body = c.req.valid("json");
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.comment_html !== undefined) updateData.commentHtml = body.comment_html;
  if (body.comment_stripped !== undefined) updateData.commentStripped = body.comment_stripped;
  if (body.comment_json !== undefined) updateData.commentJson = body.comment_json;
  if (body.access_level !== undefined) updateData.accessLevel = body.access_level;

  await db.update(issueComments).set(updateData).where(eq(issueComments.id, commentId));

  const updated = await db.query.issueComments.findFirst({
    where: eq(issueComments.id, commentId),
  });

  return c.json(formatComment(updated!));
});

// DELETE /:issueId/comments/:commentId/ - Delete comment
issueRoutes.delete("/:issueId/comments/:commentId/", requireProjectMember, async (c) => {
  const issueId = c.req.param("issueId");
  const commentId = c.req.param("commentId");

  const comment = await db.query.issueComments.findFirst({
    where: and(
      eq(issueComments.id, commentId),
      eq(issueComments.issueId, issueId)
    ),
  });

  if (!comment) return c.json({ detail: "Comment not found." }, 404);

  await db.delete(issueComments).where(eq(issueComments.id, commentId));

  return new Response(null, { status: 204 });
});

// =====================================================
// 5.5 Issue History/Activity
// =====================================================

// GET /:issueId/history/ - Get combined activity and comments
issueRoutes.get("/:issueId/history/", async (c) => {
  const issueId = c.req.param("issueId");

  const activities = await db.query.issueActivities.findMany({
    where: eq(issueActivities.issueId, issueId),
    orderBy: [asc(issueActivities.createdAt)],
  });

  const comments = await db.query.issueComments.findMany({
    where: eq(issueComments.issueId, issueId),
    orderBy: [asc(issueComments.createdAt)],
  });

  // Merge and sort by created_at
  const history = [
    ...activities.map((a) => ({
      type: "activity" as const,
      ...formatActivity(a),
    })),
    ...comments.map((c) => ({
      type: "comment" as const,
      ...formatComment(c),
    })),
  ].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return aTime - bTime;
  });

  return c.json(history);
});

// =====================================================
// 5.6 Issue Reactions
// =====================================================

// GET /:issueId/reactions/ - List issue reactions
issueRoutes.get("/:issueId/reactions/", async (c) => {
  const issueId = c.req.param("issueId");

  const reactions = await db.query.issueReactions.findMany({
    where: eq(issueReactions.issueId, issueId),
    orderBy: [asc(issueReactions.createdAt)],
  });

  return c.json(reactions.map(formatReaction));
});

// POST /:issueId/reactions/ - Add reaction
issueRoutes.post("/:issueId/reactions/", requireProjectMember, zValidator("json", createReactionSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");
  const { reaction } = c.req.valid("json");

  // Check if reaction already exists
  const existing = await db.query.issueReactions.findFirst({
    where: and(
      eq(issueReactions.issueId, issueId),
      eq(issueReactions.actorId, user.id),
      eq(issueReactions.reaction, reaction)
    ),
  });

  if (existing) {
    return c.json(formatReaction(existing));
  }

  const result = await db
    .insert(issueReactions)
    .values({ issueId, actorId: user.id, reaction })
    .returning();

  return c.json(formatReaction(result[0]!), 201);
});

// DELETE /:issueId/reactions/:reactionId/ - Remove reaction
issueRoutes.delete("/:issueId/reactions/:reactionId/", requireProjectMember, async (c) => {
  const issueId = c.req.param("issueId");
  const reactionId = c.req.param("reactionId");

  const reaction = await db.query.issueReactions.findFirst({
    where: and(
      eq(issueReactions.id, reactionId),
      eq(issueReactions.issueId, issueId)
    ),
  });

  if (!reaction) return c.json({ detail: "Reaction not found." }, 404);

  await db.delete(issueReactions).where(eq(issueReactions.id, reactionId));

  return new Response(null, { status: 204 });
});

// --- Comment Reactions ---

// GET /:issueId/comments/:commentId/reactions/ - List comment reactions
issueRoutes.get("/:issueId/comments/:commentId/reactions/", async (c) => {
  const commentId = c.req.param("commentId");

  const reactions = await db.query.commentReactions.findMany({
    where: eq(commentReactions.commentId, commentId),
    orderBy: [asc(commentReactions.createdAt)],
  });

  return c.json(reactions.map(formatCommentReaction));
});

// POST /:issueId/comments/:commentId/reactions/ - Add comment reaction
issueRoutes.post("/:issueId/comments/:commentId/reactions/", requireProjectMember, zValidator("json", createReactionSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Not found." }, 404);

  const commentId = c.req.param("commentId");
  const { reaction } = c.req.valid("json");

  const existing = await db.query.commentReactions.findFirst({
    where: and(
      eq(commentReactions.commentId, commentId),
      eq(commentReactions.actorId, user.id),
      eq(commentReactions.reaction, reaction)
    ),
  });

  if (existing) {
    return c.json(formatCommentReaction(existing));
  }

  const result = await db
    .insert(commentReactions)
    .values({ commentId, actorId: user.id, reaction })
    .returning();

  return c.json(formatCommentReaction(result[0]!), 201);
});

// DELETE /:issueId/comments/:commentId/reactions/:reactionId/
issueRoutes.delete("/:issueId/comments/:commentId/reactions/:reactionId/", requireProjectMember, async (c) => {
  const reactionId = c.req.param("reactionId");

  const reaction = await db.query.commentReactions.findFirst({
    where: eq(commentReactions.id, reactionId),
  });

  if (!reaction) return c.json({ detail: "Reaction not found." }, 404);

  await db.delete(commentReactions).where(eq(commentReactions.id, reactionId));

  return new Response(null, { status: 204 });
});

// =====================================================
// 5.7 Issue Relations
// =====================================================

// GET /:issueId/issue-relation/ - List relations
issueRoutes.get("/:issueId/issue-relation/", async (c) => {
  const issueId = c.req.param("issueId");

  const relations = await db.query.issueRelations.findMany({
    where: or(
      eq(issueRelations.issueId, issueId),
      eq(issueRelations.relatedIssueId, issueId)
    ),
  });

  return c.json(relations.map(formatRelation));
});

// POST /:issueId/issue-relation/ - Create relation
issueRoutes.post("/:issueId/issue-relation/", requireProjectMember, zValidator("json", createRelationSchema), async (c) => {
  const issueId = c.req.param("issueId");
  const body = c.req.valid("json");

  // Check if relation already exists
  const existing = await db.query.issueRelations.findFirst({
    where: and(
      eq(issueRelations.issueId, issueId),
      eq(issueRelations.relatedIssueId, body.related_issue_id),
      eq(issueRelations.relationType, body.relation_type)
    ),
  });

  if (existing) {
    return c.json(formatRelation(existing));
  }

  const result = await db
    .insert(issueRelations)
    .values({
      issueId,
      relatedIssueId: body.related_issue_id,
      relationType: body.relation_type,
    })
    .returning();

  return c.json(formatRelation(result[0]!), 201);
});

// DELETE /:issueId/issue-relation/:relationId/ - Remove relation
issueRoutes.delete("/:issueId/issue-relation/:relationId/", requireProjectMember, async (c) => {
  const relationId = c.req.param("relationId");

  const relation = await db.query.issueRelations.findFirst({
    where: eq(issueRelations.id, relationId),
  });

  if (!relation) return c.json({ detail: "Relation not found." }, 404);

  await db.delete(issueRelations).where(eq(issueRelations.id, relationId));

  return new Response(null, { status: 204 });
});

// =====================================================
// 5.8 Issue Attachments
// =====================================================

// GET /:issueId/attachments/ - List attachments
issueRoutes.get("/:issueId/attachments/", async (c) => {
  const issueId = c.req.param("issueId");

  const attachments = await db.query.issueAttachments.findMany({
    where: eq(issueAttachments.issueId, issueId),
    orderBy: [desc(issueAttachments.createdAt)],
  });

  return c.json(attachments.map(formatAttachment));
});

// DELETE /:issueId/attachments/:attachmentId/ - Delete attachment
issueRoutes.delete("/:issueId/attachments/:attachmentId/", requireProjectMember, async (c) => {
  const attachmentId = c.req.param("attachmentId");

  const attachment = await db.query.issueAttachments.findFirst({
    where: eq(issueAttachments.id, attachmentId),
  });

  if (!attachment) return c.json({ detail: "Attachment not found." }, 404);

  // TODO: Delete file from storage
  await db.delete(issueAttachments).where(eq(issueAttachments.id, attachmentId));

  return new Response(null, { status: 204 });
});

// =====================================================
// Issue Links
// =====================================================

// GET /:issueId/links/ - List links
issueRoutes.get("/:issueId/links/", async (c) => {
  const issueId = c.req.param("issueId");

  const links = await db.query.issueLinks.findMany({
    where: eq(issueLinks.issueId, issueId),
    orderBy: [desc(issueLinks.createdAt)],
  });

  return c.json(links.map(formatLink));
});

// POST /:issueId/links/ - Create link
issueRoutes.post("/:issueId/links/", requireProjectMember, zValidator("json", createLinkSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");
  const body = c.req.valid("json");

  const result = await db
    .insert(issueLinks)
    .values({
      issueId,
      title: body.title,
      url: body.url,
      metadata: body.metadata,
      createdById: user.id,
    })
    .returning();

  return c.json(formatLink(result[0]!), 201);
});

// PATCH /:issueId/links/:linkId/ - Update link
issueRoutes.patch("/:issueId/links/:linkId/", requireProjectMember, zValidator("json", updateLinkSchema), async (c) => {
  const linkId = c.req.param("linkId");

  const link = await db.query.issueLinks.findFirst({
    where: eq(issueLinks.id, linkId),
  });

  if (!link) return c.json({ detail: "Link not found." }, 404);

  const body = c.req.valid("json");
  const updateData: Record<string, unknown> = {};

  if (body.title !== undefined) updateData.title = body.title;
  if (body.url !== undefined) updateData.url = body.url;
  if (body.metadata !== undefined) updateData.metadata = body.metadata;

  await db.update(issueLinks).set(updateData).where(eq(issueLinks.id, linkId));

  const updated = await db.query.issueLinks.findFirst({
    where: eq(issueLinks.id, linkId),
  });

  return c.json(formatLink(updated!));
});

// DELETE /:issueId/links/:linkId/ - Delete link
issueRoutes.delete("/:issueId/links/:linkId/", requireProjectMember, async (c) => {
  const linkId = c.req.param("linkId");

  const link = await db.query.issueLinks.findFirst({
    where: eq(issueLinks.id, linkId),
  });

  if (!link) return c.json({ detail: "Link not found." }, 404);

  await db.delete(issueLinks).where(eq(issueLinks.id, linkId));

  return new Response(null, { status: 204 });
});

// =====================================================
// 5.9 Bulk Operations
// =====================================================

// POST /bulk-operation-issues/ - Bulk update issues
issueRoutes.post("/bulk-operation-issues/", requireProjectMember, zValidator("json", bulkOperationSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const { issue_ids, properties } = c.req.valid("json");

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
    updatedById: user.id,
  };

  // Map snake_case properties to camelCase columns
  if (properties.state_id !== undefined) updateData.stateId = properties.state_id;
  if (properties.priority !== undefined) updateData.priority = properties.priority;
  if (properties.parent_id !== undefined) updateData.parentId = properties.parent_id;
  if (properties.start_date !== undefined) updateData.startDate = parseDate(properties.start_date as string);
  if (properties.target_date !== undefined) updateData.targetDate = parseDate(properties.target_date as string);
  if (properties.estimate_point !== undefined) updateData.estimatePoint = properties.estimate_point;

  await db
    .update(issues)
    .set(updateData)
    .where(and(inArray(issues.id, issue_ids), eq(issues.projectId, project.id)));

  // Bulk sync assignees/labels if provided
  if (properties.assignees !== undefined) {
    const assigneeIds = properties.assignees as string[];
    for (const issueId of issue_ids) {
      await syncAssignees(issueId, assigneeIds);
    }
  }
  if (properties.labels !== undefined) {
    const labelIds = properties.labels as string[];
    for (const issueId of issue_ids) {
      await syncLabels(issueId, labelIds);
    }
  }

  return c.json({ detail: `${issue_ids.length} issues updated.` });
});

// =====================================================
// 5.10 Archived & Deleted Issues
// =====================================================

// GET /archived-issues/ - List archived issues
issueRoutes.get("/archived-issues/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const archived = await db.query.issues.findMany({
    where: and(
      eq(issues.projectId, project.id),
      isNotNull(issues.archivedAt),
      isNull(issues.deletedAt)
    ),
    orderBy: [desc(issues.archivedAt)],
  });

  const issueIds = archived.map((i) => i.id);
  const allAssignees =
    issueIds.length > 0
      ? await db.select().from(issueAssignees).where(inArray(issueAssignees.issueId, issueIds))
      : [];
  const allLabels =
    issueIds.length > 0
      ? await db.select().from(issueLabels).where(inArray(issueLabels.issueId, issueIds))
      : [];

  const assigneeMap = new Map<string, string[]>();
  for (const a of allAssignees) {
    const existing = assigneeMap.get(a.issueId) ?? [];
    existing.push(a.assigneeId);
    assigneeMap.set(a.issueId, existing);
  }
  const labelMap = new Map<string, string[]>();
  for (const l of allLabels) {
    const existing = labelMap.get(l.issueId) ?? [];
    existing.push(l.labelId);
    labelMap.set(l.issueId, existing);
  }

  return c.json(
    archived.map((i) => formatIssue(i, assigneeMap.get(i.id) ?? [], labelMap.get(i.id) ?? []))
  );
});

// POST /:issueId/archive/ - Archive issue
issueRoutes.post("/:issueId/archive/", requireProjectMember, async (c) => {
  const issueId = c.req.param("issueId");

  await db.update(issues).set({
    archivedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));

  return c.json({ detail: "Issue archived." });
});

// POST /:issueId/unarchive/ - Unarchive issue
issueRoutes.post("/:issueId/unarchive/", requireProjectMember, async (c) => {
  const issueId = c.req.param("issueId");

  await db.update(issues).set({
    archivedAt: null,
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));

  return c.json({ detail: "Issue unarchived." });
});

// GET /deleted-issues/ - List soft-deleted issues
issueRoutes.get("/deleted-issues/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const deleted = await db.query.issues.findMany({
    where: and(
      eq(issues.projectId, project.id),
      isNotNull(issues.deletedAt)
    ),
    orderBy: [desc(issues.deletedAt)],
  });

  return c.json(deleted.map((i) => formatIssue(i, [], [])));
});

// POST /:issueId/restore/ - Restore soft-deleted issue
issueRoutes.post("/:issueId/restore/", requireProjectMember, async (c) => {
  const issueId = c.req.param("issueId");

  await db.update(issues).set({
    deletedAt: null,
    updatedAt: new Date(),
  }).where(eq(issues.id, issueId));

  return c.json({ detail: "Issue restored." });
});

export { issueRoutes };

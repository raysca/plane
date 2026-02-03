import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  eq,
  and,
  desc,
  isNull,
  inArray,
  sql,
  max,
} from "drizzle-orm";
import { db } from "../../db";
import {
  draftIssues,
  draftIssueAssignees,
  draftIssueLabels,
  draftIssueModules,
  draftIssueCycles,
} from "../../db/schema/draft";
import {
  issues,
  issueAssignees,
  issueLabels,
  issueActivities,
} from "../../db/schema/issue";
import { states } from "../../db/schema/project";
import { cycleIssues } from "../../db/schema/cycle";
import { moduleIssues } from "../../db/schema/module";
import { fileAssets } from "../../db/schema/asset";
import { authMiddleware } from "../../middleware/auth";
import { workspaceMiddleware } from "../../middleware/workspace";
import type { Variables } from "../../app";

const draftRoutes = new Hono<{ Variables: Variables }>();

// Apply middleware chain: auth → workspace
draftRoutes.use("*", authMiddleware);
draftRoutes.use("*", workspaceMiddleware);

// --- Validation Schemas ---

const createDraftSchema = z.object({
  name: z.string().optional().nullable(),
  description_html: z.string().optional().nullable(),
  description_stripped: z.string().optional().nullable(),
  priority: z.string().optional().nullable(),
  state_id: z.string().optional().nullable(),
  parent_id: z.string().optional().nullable(),
  estimate_point: z.string().optional().nullable(),
  project_id: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  target_date: z.string().optional().nullable(),
  sort_order: z.number().optional().nullable(),
  assignee_ids: z.array(z.string()).optional().nullable(),
  label_ids: z.array(z.string()).optional().nullable(),
  cycle_id: z.string().optional().nullable(),
  module_ids: z.array(z.string()).optional().nullable(),
  type_id: z.string().optional().nullable(),
}).passthrough();

const updateDraftSchema = createDraftSchema;

// --- Helpers ---

/** Convert empty strings to null (frontend sometimes sends "" for optional FK fields) */
function emptyToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

interface DraftExtra {
  assigneeIds: string[];
  labelIds: string[];
  moduleIds: string[];
  cycleId: string | null;
}

function formatDraft(
  draft: typeof draftIssues.$inferSelect,
  extra: DraftExtra
) {
  return {
    id: draft.id,
    name: draft.name ?? "",
    state_id: draft.stateId ?? null,
    sort_order: draft.sortOrder ?? 65535,
    completed_at: draft.completedAt?.toISOString() ?? null,
    estimate_point: draft.estimatePoint ?? null,
    priority: draft.priority ?? "none",
    start_date: draft.startDate ?? null,
    target_date: draft.targetDate ?? null,
    project_id: draft.projectId ?? null,
    parent_id: draft.parentId ?? null,
    cycle_id: extra.cycleId,
    module_ids: extra.moduleIds,
    label_ids: extra.labelIds,
    assignee_ids: extra.assigneeIds,
    created_at: draft.createdAt?.toISOString() ?? null,
    updated_at: draft.updatedAt?.toISOString() ?? null,
    created_by: draft.createdById ?? null,
    updated_by: draft.updatedById ?? null,
    type_id: draft.typeId ?? null,
    description_html: draft.descriptionHtml ?? "",
    is_draft: true,
  };
}

async function getDraftExtras(draftIds: string[]): Promise<Map<string, DraftExtra>> {
  if (draftIds.length === 0) return new Map();

  const [assigneeRows, labelRows, moduleRows, cycleRows] = await Promise.all([
    db.select().from(draftIssueAssignees).where(
      and(inArray(draftIssueAssignees.draftIssueId, draftIds), isNull(draftIssueAssignees.deletedAt))
    ),
    db.select().from(draftIssueLabels).where(
      and(inArray(draftIssueLabels.draftIssueId, draftIds), isNull(draftIssueLabels.deletedAt))
    ),
    db.select().from(draftIssueModules).where(
      and(inArray(draftIssueModules.draftIssueId, draftIds), isNull(draftIssueModules.deletedAt))
    ),
    db.select().from(draftIssueCycles).where(
      and(inArray(draftIssueCycles.draftIssueId, draftIds), isNull(draftIssueCycles.deletedAt))
    ),
  ]);

  const result = new Map<string, DraftExtra>();

  for (const id of draftIds) {
    result.set(id, { assigneeIds: [], labelIds: [], moduleIds: [], cycleId: null });
  }

  for (const row of assigneeRows) {
    result.get(row.draftIssueId)!.assigneeIds.push(row.assigneeId);
  }
  for (const row of labelRows) {
    result.get(row.draftIssueId)!.labelIds.push(row.labelId);
  }
  for (const row of moduleRows) {
    result.get(row.draftIssueId)!.moduleIds.push(row.moduleId);
  }
  for (const row of cycleRows) {
    const extra = result.get(row.draftIssueId)!;
    extra.cycleId = row.cycleId;
  }

  return result;
}

async function getNextSequenceId(projectId: string): Promise<number> {
  const result = await db
    .select({ maxSeq: max(issues.sequenceId) })
    .from(issues)
    .where(eq(issues.projectId, projectId));
  return (result[0]?.maxSeq ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// GET / – List draft issues (paginated, filtered by current user)
// ---------------------------------------------------------------------------
draftRoutes.get("/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const perPage = Math.min(Math.max(parseInt(c.req.query("per_page") || "50"), 1), 100);
  const cursor = c.req.query("cursor") || `${perPage}:0:0`;

  // Parse cursor: "perPage:offset:isPrev"
  const cursorParts = cursor.split(":");
  const offset = parseInt(cursorParts[1] || "0");

  // Fetch drafts created by the current user
  const drafts = await db
    .select()
    .from(draftIssues)
    .where(
      and(
        eq(draftIssues.workspaceId, workspace.id),
        eq(draftIssues.createdById, user.id),
        isNull(draftIssues.deletedAt)
      )
    )
    .orderBy(desc(draftIssues.createdAt))
    .limit(perPage + 1) // fetch one extra to check for next page
    .offset(offset);

  const hasNext = drafts.length > perPage;
  const pageResults = hasNext ? drafts.slice(0, perPage) : drafts;

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(draftIssues)
    .where(
      and(
        eq(draftIssues.workspaceId, workspace.id),
        eq(draftIssues.createdById, user.id),
        isNull(draftIssues.deletedAt)
      )
    );
  const totalCount = countResult[0]?.count ?? 0;

  // Get extras for all drafts
  const draftIds = pageResults.map((d) => d.id);
  const extrasMap = await getDraftExtras(draftIds);

  const results = pageResults.map((draft) =>
    formatDraft(draft, extrasMap.get(draft.id)!)
  );

  const nextCursor = hasNext ? `${perPage}:${offset + perPage}:0` : undefined;
  const prevCursor = offset > 0 ? `${perPage}:${Math.max(0, offset - perPage)}:1` : undefined;
  const totalPages = Math.ceil(totalCount / perPage);

  return c.json({
    next_cursor: nextCursor,
    prev_cursor: prevCursor,
    next_page_results: hasNext,
    prev_page_results: offset > 0,
    total_pages: totalPages,
    count: results.length,
    total_count: totalCount,
    results,
    extra_stats: null,
    grouped_by: null,
    sub_grouped_by: null,
  });
});

// ---------------------------------------------------------------------------
// POST / – Create a draft issue
// ---------------------------------------------------------------------------
draftRoutes.post("/", zValidator("json", createDraftSchema), async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  // Validate start_date < target_date
  if (body.start_date && body.target_date && body.start_date > body.target_date) {
    return c.json({ error: "Start date cannot exceed target date" }, 400);
  }

  const descriptionStripped = body.description_html
    ? stripHtmlTags(body.description_html)
    : null;

  // Compute sort_order
  let sortOrder = body.sort_order ?? 65535;
  if (emptyToNull(body.state_id) && emptyToNull(body.project_id)) {
    const maxResult = await db
      .select({ maxSort: max(draftIssues.sortOrder) })
      .from(draftIssues)
      .where(
        and(
          eq(draftIssues.projectId, body.project_id),
          eq(draftIssues.stateId, body.state_id),
          isNull(draftIssues.deletedAt)
        )
      );
    const largest = maxResult[0]?.maxSort;
    if (largest != null) {
      sortOrder = largest + 10000;
    }
  }

  const result = await db
    .insert(draftIssues)
    .values({
      workspaceId: workspace.id,
      projectId: emptyToNull(body.project_id),
      name: body.name ?? null,
      descriptionHtml: body.description_html ?? "<p></p>",
      descriptionStripped,
      priority: body.priority ?? "none",
      stateId: emptyToNull(body.state_id),
      parentId: emptyToNull(body.parent_id),
      estimatePoint: body.estimate_point ?? null,
      startDate: body.start_date ?? null,
      targetDate: body.target_date ?? null,
      sortOrder,
      typeId: emptyToNull(body.type_id),
      createdById: user.id,
      updatedById: user.id,
    })
    .returning();
  const draft = result[0]!;

  const assigneeIds = body.assignee_ids ?? [];
  const labelIds = body.label_ids ?? [];
  const moduleIds = body.module_ids ?? [];
  const cycleId = body.cycle_id ?? null;

  // Bulk create junction records
  if (assigneeIds.length > 0) {
    await db.insert(draftIssueAssignees).values(
      assigneeIds.map((assigneeId) => ({
        draftIssueId: draft.id,
        assigneeId,
        workspaceId: workspace.id,
        projectId: emptyToNull(body.project_id),
        createdById: user.id,
        updatedById: user.id,
      }))
    );
  }

  if (labelIds.length > 0) {
    await db.insert(draftIssueLabels).values(
      labelIds.map((labelId) => ({
        draftIssueId: draft.id,
        labelId,
        workspaceId: workspace.id,
        projectId: emptyToNull(body.project_id),
        createdById: user.id,
        updatedById: user.id,
      }))
    );
  }

  if (cycleId) {
    await db.insert(draftIssueCycles).values({
      draftIssueId: draft.id,
      cycleId,
      workspaceId: workspace.id,
      projectId: body.project_id ?? null,
      createdById: user.id,
      updatedById: user.id,
    });
  }

  if (moduleIds.length > 0) {
    await db.insert(draftIssueModules).values(
      moduleIds.map((moduleId) => ({
        draftIssueId: draft.id,
        moduleId,
        workspaceId: workspace.id,
        projectId: emptyToNull(body.project_id),
        createdById: user.id,
        updatedById: user.id,
      }))
    );
  }

  return c.json(
    formatDraft(draft, { assigneeIds, labelIds, moduleIds, cycleId }),
    201
  );
});

// ---------------------------------------------------------------------------
// GET /:draftId/ – Get draft issue details
// ---------------------------------------------------------------------------
draftRoutes.get("/:draftId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const draftId = c.req.param("draftId");

  const draft = await db.query.draftIssues.findFirst({
    where: and(
      eq(draftIssues.id, draftId),
      eq(draftIssues.workspaceId, workspace.id),
      eq(draftIssues.createdById, user.id),
      isNull(draftIssues.deletedAt)
    ),
  });

  if (!draft) {
    return c.json({ error: "The required object does not exist." }, 404);
  }

  const extrasMap = await getDraftExtras([draft.id]);
  return c.json(formatDraft(draft, extrasMap.get(draft.id)!));
});

// ---------------------------------------------------------------------------
// PATCH /:draftId/ – Update a draft issue
// ---------------------------------------------------------------------------
draftRoutes.patch("/:draftId/", zValidator("json", updateDraftSchema), async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const draftId = c.req.param("draftId");
  const body = c.req.valid("json");

  const draft = await db.query.draftIssues.findFirst({
    where: and(
      eq(draftIssues.id, draftId),
      eq(draftIssues.workspaceId, workspace.id),
      eq(draftIssues.createdById, user.id),
      isNull(draftIssues.deletedAt)
    ),
  });

  if (!draft) {
    return c.json({ error: "Issue not found" }, 404);
  }

  // Validate dates
  const startDate = body.start_date !== undefined ? body.start_date : draft.startDate;
  const targetDate = body.target_date !== undefined ? body.target_date : draft.targetDate;
  if (startDate && targetDate && startDate > targetDate) {
    return c.json({ error: "Start date cannot exceed target date" }, 400);
  }

  // Build update values
  const updateValues: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updateValues.name = body.name;
  if (body.description_html !== undefined) {
    updateValues.descriptionHtml = body.description_html;
    updateValues.descriptionStripped = body.description_html ? stripHtmlTags(body.description_html) : null;
  }
  if (body.priority !== undefined) updateValues.priority = body.priority;
  if (body.state_id !== undefined) updateValues.stateId = emptyToNull(body.state_id);
  if (body.parent_id !== undefined) updateValues.parentId = emptyToNull(body.parent_id);
  if (body.estimate_point !== undefined) updateValues.estimatePoint = body.estimate_point;
  if (body.project_id !== undefined) updateValues.projectId = emptyToNull(body.project_id);
  if (body.start_date !== undefined) updateValues.startDate = body.start_date;
  if (body.target_date !== undefined) updateValues.targetDate = body.target_date;
  if (body.sort_order !== undefined) updateValues.sortOrder = body.sort_order;
  if (body.type_id !== undefined) updateValues.typeId = emptyToNull(body.type_id);

  await db.update(draftIssues).set(updateValues).where(eq(draftIssues.id, draftId));

  const projectId = body.project_id !== undefined ? body.project_id : draft.projectId;

  // Sync assignees
  if (body.assignee_ids !== undefined) {
    await db.delete(draftIssueAssignees).where(eq(draftIssueAssignees.draftIssueId, draftId));
    if (body.assignee_ids && body.assignee_ids.length > 0) {
      await db.insert(draftIssueAssignees).values(
        body.assignee_ids.map((assigneeId) => ({
          draftIssueId: draftId,
          assigneeId,
          workspaceId: workspace.id,
          projectId,
          createdById: user.id,
          updatedById: user.id,
        }))
      );
    }
  }

  // Sync labels
  if (body.label_ids !== undefined) {
    await db.delete(draftIssueLabels).where(eq(draftIssueLabels.draftIssueId, draftId));
    if (body.label_ids && body.label_ids.length > 0) {
      await db.insert(draftIssueLabels).values(
        body.label_ids.map((labelId) => ({
          draftIssueId: draftId,
          labelId,
          workspaceId: workspace.id,
          projectId,
          createdById: user.id,
          updatedById: user.id,
        }))
      );
    }
  }

  // Sync cycle (use "not_provided" sentinel logic like Django)
  if (body.cycle_id !== undefined) {
    await db.delete(draftIssueCycles).where(eq(draftIssueCycles.draftIssueId, draftId));
    if (body.cycle_id) {
      await db.insert(draftIssueCycles).values({
        draftIssueId: draftId,
        cycleId: body.cycle_id,
        workspaceId: workspace.id,
        projectId,
        createdById: user.id,
        updatedById: user.id,
      });
    }
  }

  // Sync modules
  if (body.module_ids !== undefined) {
    await db.delete(draftIssueModules).where(eq(draftIssueModules.draftIssueId, draftId));
    if (body.module_ids && body.module_ids.length > 0) {
      await db.insert(draftIssueModules).values(
        body.module_ids.map((moduleId) => ({
          draftIssueId: draftId,
          moduleId,
          workspaceId: workspace.id,
          projectId,
          createdById: user.id,
          updatedById: user.id,
        }))
      );
    }
  }

  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// DELETE /:draftId/ – Delete a draft issue
// ---------------------------------------------------------------------------
draftRoutes.delete("/:draftId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const draftId = c.req.param("draftId");

  const draft = await db.query.draftIssues.findFirst({
    where: and(
      eq(draftIssues.id, draftId),
      eq(draftIssues.workspaceId, workspace.id),
      eq(draftIssues.createdById, user.id),
      isNull(draftIssues.deletedAt)
    ),
  });

  if (!draft) {
    return c.json({ error: "The required object does not exist." }, 404);
  }

  await db.delete(draftIssues).where(eq(draftIssues.id, draftId));
  return c.body(null, 204);
});

// ===========================================================================
// Draft-to-Issue Conversion Route
// ===========================================================================

const draftToIssueRoutes = new Hono<{ Variables: Variables }>();
draftToIssueRoutes.use("*", authMiddleware);
draftToIssueRoutes.use("*", workspaceMiddleware);

// Priority map for converting string priority to numeric (matching issue routes)
const priorityMap: Record<string, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// POST /:draftId/ – Convert a draft issue into a real issue
// ---------------------------------------------------------------------------
draftToIssueRoutes.post("/:draftId/", zValidator("json", createDraftSchema), async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const draftId = c.req.param("draftId");
  const body = c.req.valid("json");

  // Fetch the draft with its related data
  const draft = await db.query.draftIssues.findFirst({
    where: and(
      eq(draftIssues.id, draftId),
      eq(draftIssues.workspaceId, workspace.id),
      isNull(draftIssues.deletedAt)
    ),
  });

  if (!draft) {
    return c.json({ error: "Draft issue not found." }, 404);
  }

  // Use project_id from body or draft
  const projectId = body.project_id ?? draft.projectId;
  if (!projectId) {
    return c.json({ error: "Project is required to create an issue." }, 400);
  }

  // Get default state if none provided
  const stateId = body.state_id ?? draft.stateId ?? null;
  let resolvedStateId = stateId;
  if (!resolvedStateId) {
    const defaultState = await db.query.states.findFirst({
      where: and(eq(states.projectId, projectId), eq(states.isDefault, true)),
    });
    resolvedStateId = defaultState?.id ?? null;
  }

  const sequenceId = await getNextSequenceId(projectId);

  // Convert priority from string to number if needed
  const draftPriority = body.priority ?? draft.priority ?? "none";
  const numericPriority = typeof draftPriority === "string"
    ? (priorityMap[draftPriority] ?? 0)
    : draftPriority;

  // Create the real issue
  const issueResult = await db
    .insert(issues)
    .values({
      projectId,
      workspaceId: workspace.id,
      name: body.name ?? draft.name ?? "Untitled",
      descriptionHtml: body.description_html ?? draft.descriptionHtml ?? undefined,
      descriptionStripped: body.description_stripped ?? draft.descriptionStripped ?? undefined,
      priority: numericPriority,
      stateId: resolvedStateId,
      parentId: body.parent_id ?? draft.parentId ?? null,
      startDate: parseDate(body.start_date ?? draft.startDate),
      targetDate: parseDate(body.target_date ?? draft.targetDate),
      sortOrder: body.sort_order ?? draft.sortOrder ?? 65535,
      estimatePoint: body.estimate_point != null
        ? (isNaN(Number(body.estimate_point)) ? null : Number(body.estimate_point))
        : (draft.estimatePoint != null
          ? (isNaN(Number(draft.estimatePoint)) ? null : Number(draft.estimatePoint))
          : null),
      sequenceId,
      createdById: user.id,
      updatedById: user.id,
    })
    .returning();
  const issue = issueResult[0]!;

  // Get draft extras to transfer relationships
  const extrasMap = await getDraftExtras([draftId]);
  const extras = extrasMap.get(draftId)!;

  // Transfer assignees
  const assigneeIds = body.assignee_ids || extras.assigneeIds;
  if (assigneeIds.length > 0) {
    await db.insert(issueAssignees).values(
      assigneeIds.map((assigneeId) => ({
        issueId: issue.id,
        assigneeId,
      }))
    );
  }

  // Transfer labels
  const labelIds = body.label_ids || extras.labelIds;
  if (labelIds.length > 0) {
    await db.insert(issueLabels).values(
      labelIds.map((labelId) => ({
        issueId: issue.id,
        labelId,
      }))
    );
  }

  // Transfer cycle
  const cycleId = body.cycle_id ?? extras.cycleId;
  if (cycleId) {
    await db.insert(cycleIssues).values({
      cycleId,
      issueId: issue.id,
    });
  }

  // Transfer modules
  const moduleIdList = body.module_ids || extras.moduleIds;
  if (moduleIdList.length > 0) {
    await db.insert(moduleIssues).values(
      moduleIdList.map((moduleId) => ({
        moduleId,
        issueId: issue.id,
      }))
    );
  }

  // Record activity
  await db.insert(issueActivities).values({
    issueId: issue.id,
    projectId,
    workspaceId: workspace.id,
    actorId: user.id,
    verb: "created",
    epochTimestamp: Math.floor(Date.now() / 1000),
  });

  // Delete the draft
  await db.delete(draftIssues).where(eq(draftIssues.id, draftId));

  // Look up state group for the response
  let stateGroup: string | null = null;
  if (issue.stateId) {
    const state = await db.query.states.findFirst({
      where: eq(states.id, issue.stateId),
    });
    stateGroup = state?.group ?? null;
  }

  return c.json({
    id: issue.id,
    project_id: issue.projectId,
    workspace_id: issue.workspaceId,
    parent_id: issue.parentId ?? null,
    state_id: issue.stateId ?? null,
    state__group: stateGroup ?? "backlog",
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
    assignee_ids: assigneeIds,
    label_ids: labelIds,
    module_ids: moduleIdList,
    cycle_id: cycleId,
    sub_issues_count: 0,
    attachment_count: 0,
    link_count: 0,
    created_by: issue.createdById ?? null,
    updated_by: issue.updatedById ?? null,
    created_at: issue.createdAt?.toISOString() ?? null,
    updated_at: issue.updatedAt?.toISOString() ?? null,
  }, 201);
});

export { draftRoutes, draftToIssueRoutes };

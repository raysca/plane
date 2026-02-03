import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, or, gte, isNull, desc } from "drizzle-orm";
import { db } from "../../db";
import { intakes, intakeIssues } from "../../db/schema/intake";
import { issues, issueAssignees, issueLabels, issueActivities } from "../../db/schema/issue";
import { projects, states, projectMembers } from "../../db/schema/project";
import { authMiddleware, ROLES } from "../../middleware/auth";
import { workspaceMiddleware } from "../../middleware/workspace";
import { projectMiddleware } from "../../middleware/project";
import type { Variables } from "../../app";

const intakeRoutes = new Hono<{ Variables: Variables }>();

// Apply middleware chain: auth → workspace → project
intakeRoutes.use("*", authMiddleware);
intakeRoutes.use("*", workspaceMiddleware);
intakeRoutes.use("*", projectMiddleware);

// --- Validation Schemas ---

const createIntakeIssueSchema = z.object({
  source: z.string().optional().default("IN_APP"),
  issue: z.object({
    name: z.string().min(1),
    description: z.any().optional(),
    description_html: z.string().optional().nullable(),
    priority: z.enum(["none", "low", "medium", "high", "urgent"]).optional().default("none"),
  }),
}).passthrough();

const updateIntakeIssueSchema = z.object({
  status: z.number().int().min(-2).max(2).optional(),
  snoozed_till: z.string().optional().nullable(),
  duplicate_to: z.string().optional().nullable(),
  source: z.string().optional(),
  source_email: z.string().optional().nullable(),
  issue: z.object({
    name: z.string().optional(),
    description: z.any().optional(),
    description_html: z.string().optional().nullable(),
    priority: z.union([z.string(), z.number()]).optional(),
    state_id: z.string().optional().nullable(),
    assignee_ids: z.array(z.string()).optional(),
    label_ids: z.array(z.string()).optional(),
  }).optional(),
}).passthrough();

// --- Priority Map ---
const priorityMap: Record<string, number> = {
  none: 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

// --- Format Helpers ---

function formatIntakeIssue(
  intakeIssue: typeof intakeIssues.$inferSelect,
  issueData: typeof issues.$inferSelect | null,
  duplicateIssue?: { id: string; sequenceId: number | null; name: string } | null,
  assigneeIds?: string[],
  labelIds?: string[],
  stateGroup?: string,
) {
  return {
    id: intakeIssue.id,
    status: intakeIssue.status ?? -2,
    snoozed_till: intakeIssue.snoozedTill?.toISOString() ?? null,
    duplicate_to: intakeIssue.duplicateToId ?? null,
    source: intakeIssue.source ?? "IN_APP",
    source_email: intakeIssue.sourceEmail ?? null,
    external_source: intakeIssue.externalSource ?? null,
    external_id: intakeIssue.externalId ?? null,
    extra: intakeIssue.extra ?? {},
    created_by: intakeIssue.createdById ?? null,
    created_at: intakeIssue.createdAt?.toISOString() ?? null,
    updated_at: intakeIssue.updatedAt?.toISOString() ?? null,
    project: intakeIssue.projectId,
    workspace: intakeIssue.workspaceId,
    intake: intakeIssue.intakeId,
    inbox: intakeIssue.intakeId,
    issue: intakeIssue.issueId,
    // Nested issue detail (expanded)
    issue_detail: issueData ? {
      id: issueData.id,
      name: issueData.name,
      description_html: issueData.descriptionHtml ?? "",
      description_stripped: issueData.descriptionStripped ?? "",
      priority: issueData.priority ?? 0,
      state_id: issueData.stateId ?? null,
      state__group: stateGroup ?? "backlog",
      project_id: issueData.projectId,
      workspace_id: issueData.workspaceId,
      parent_id: issueData.parentId ?? null,
      sort_order: issueData.sortOrder ?? 65535,
      start_date: issueData.startDate?.toISOString()?.split("T")[0] ?? null,
      target_date: issueData.targetDate?.toISOString()?.split("T")[0] ?? null,
      completed_at: issueData.completedAt?.toISOString() ?? null,
      archived_at: issueData.archivedAt?.toISOString() ?? null,
      sequence_id: issueData.sequenceId ?? null,
      estimate_point: issueData.estimatePoint ?? null,
      assignee_ids: assigneeIds ?? [],
      label_ids: labelIds ?? [],
      created_by: issueData.createdById ?? null,
      updated_by: issueData.updatedById ?? null,
      created_at: issueData.createdAt?.toISOString() ?? null,
      updated_at: issueData.updatedAt?.toISOString() ?? null,
    } : null,
    // Duplicate issue detail
    duplicate_issue_detail: duplicateIssue ? {
      id: duplicateIssue.id,
      sequence_id: duplicateIssue.sequenceId,
      name: duplicateIssue.name,
    } : null,
  };
}

// --- Helper: Get or create intake for project ---
async function getOrCreateIntake(projectId: string, workspaceId: string) {
  let intake = await db.query.intakes.findFirst({
    where: and(eq(intakes.projectId, projectId), isNull(intakes.deletedAt)),
  });

  if (!intake) {
    const [newIntake] = await db.insert(intakes).values({
      projectId,
      workspaceId,
      name: "Intake",
      isDefault: true,
    }).returning();
    intake = newIntake;
  }

  return intake;
}

// --- Helper: Get or create triage state ---
async function getOrCreateTriageState(projectId: string, workspaceId: string) {
  let triageState = await db.query.states.findFirst({
    where: and(eq(states.projectId, projectId), eq(states.group, "triage")),
  });

  if (!triageState) {
    const [newState] = await db.insert(states).values({
      projectId,
      workspaceId,
      name: "Triage",
      group: "triage",
      color: "#4E5355",
      sequence: 65000,
      isDefault: false,
    }).returning();
    triageState = newState;
  }

  return triageState;
}

// --- Helper: Enrich intake issue with issue data ---
async function enrichIntakeIssue(intakeIssue: typeof intakeIssues.$inferSelect) {
  const issueData = await db.query.issues.findFirst({
    where: eq(issues.id, intakeIssue.issueId),
  });

  // Get assignee IDs
  const assigneeRows = await db.select({ assigneeId: issueAssignees.assigneeId })
    .from(issueAssignees)
    .where(eq(issueAssignees.issueId, intakeIssue.issueId));

  // Get label IDs
  const labelRows = await db.select({ labelId: issueLabels.labelId })
    .from(issueLabels)
    .where(eq(issueLabels.issueId, intakeIssue.issueId));

  // Get state group
  let stateGroup = "backlog";
  if (issueData?.stateId) {
    const state = await db.query.states.findFirst({
      where: eq(states.id, issueData.stateId),
    });
    if (state) stateGroup = state.group;
  }

  // Get duplicate issue details
  let duplicateIssue = null;
  if (intakeIssue.duplicateToId) {
    const dupIssue = await db.query.issues.findFirst({
      where: eq(issues.id, intakeIssue.duplicateToId),
    });
    if (dupIssue) {
      duplicateIssue = { id: dupIssue.id, sequenceId: dupIssue.sequenceId, name: dupIssue.name };
    }
  }

  return formatIntakeIssue(
    intakeIssue,
    issueData ?? null,
    duplicateIssue,
    assigneeRows.map((r) => r.assigneeId),
    labelRows.map((r) => r.labelId),
    stateGroup,
  );
}

// =====================================================
// GET / - List intake issues
// =====================================================
intakeRoutes.get("/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  if (!project || !workspace) return c.json({ detail: "Not found." }, 404);

  // Check intake_view is enabled
  const fullProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });
  if (!fullProject?.intakeView) {
    return c.json({ results: [], total_results: 0, next_cursor: "10:0:0", prev_cursor: "10:0:0" });
  }

  const intake = await db.query.intakes.findFirst({
    where: and(eq(intakes.projectId, project.id), isNull(intakes.deletedAt)),
  });
  if (!intake) {
    return c.json({ results: [], total_results: 0, next_cursor: "10:0:0", prev_cursor: "10:0:0" });
  }

  // Query params
  const statusFilter = c.req.query("status");
  const perPage = parseInt(c.req.query("per_page") || "10", 10);
  const cursor = c.req.query("cursor") || "10:0:0";
  const orderBy = c.req.query("order_by") || "-created_at";

  // Parse cursor: "per_page:offset:is_prev"
  const cursorParts = cursor.split(":");
  const offset = parseInt(cursorParts[1] || "0", 10);

  const now = new Date();

  // Build conditions
  const conditions = [
    eq(intakeIssues.intakeId, intake.id),
    eq(intakeIssues.projectId, project.id),
    or(gte(intakeIssues.snoozedTill, now), isNull(intakeIssues.snoozedTill)),
  ];

  // Status filter
  if (statusFilter) {
    const statusValues = statusFilter.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    if (statusValues.length > 0) {
      const statusConditions = statusValues.map((s) => eq(intakeIssues.status, s));
      conditions.push(or(...statusConditions)!);
    }
  }

  // Get total count
  const allMatching = await db.select({ id: intakeIssues.id })
    .from(intakeIssues)
    .where(and(...conditions));
  const totalResults = allMatching.length;

  // Get paginated results
  const sortDesc = orderBy.startsWith("-");
  const rows = await db.select()
    .from(intakeIssues)
    .where(and(...conditions))
    .orderBy(sortDesc ? desc(intakeIssues.createdAt) : intakeIssues.createdAt)
    .limit(perPage)
    .offset(offset);

  // Enrich with issue data
  const results = await Promise.all(rows.map(enrichIntakeIssue));

  const nextOffset = offset + perPage;
  const prevOffset = Math.max(0, offset - perPage);

  return c.json({
    results,
    total_results: totalResults,
    next_cursor: nextOffset < totalResults ? `${perPage}:${nextOffset}:0` : `${perPage}:${offset}:0`,
    prev_cursor: `${perPage}:${prevOffset}:0`,
    next_page_results: nextOffset < totalResults,
  });
});

// =====================================================
// POST / - Create intake issue
// =====================================================
intakeRoutes.post(
  "/",
  zValidator("json", createIntakeIssueSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");

    // Check intake is enabled
    const fullProject = await db.query.projects.findFirst({
      where: eq(projects.id, project.id),
    });
    if (!fullProject?.intakeView) {
      return c.json(
        { error: "Intake is not enabled for this project enable it through the project's api" },
        400
      );
    }

    if (!body.issue?.name) {
      return c.json({ error: "Name is required" }, 400);
    }

    // Validate priority
    const priority = body.issue.priority || "none";
    if (!["low", "medium", "high", "urgent", "none"].includes(priority)) {
      return c.json({ error: "Invalid priority" }, 400);
    }

    // Get or create intake
    const intake = await getOrCreateIntake(project.id, workspace.id);

    // Get or create triage state
    const triageState = await getOrCreateTriageState(project.id, workspace.id);

    // Create the issue
    const [newIssue] = await db.insert(issues).values({
      projectId: project.id,
      workspaceId: workspace.id,
      stateId: triageState.id,
      name: body.issue.name,
      descriptionHtml: body.issue.description_html ?? "<p></p>",
      priority: priorityMap[priority] ?? 0,
      createdById: user.id,
    }).returning();

    if (!newIssue) return c.json({ error: "Failed to create issue" }, 500);

    // Create the intake issue
    const [intakeIssue] = await db.insert(intakeIssues).values({
      intakeId: intake.id,
      issueId: newIssue.id,
      projectId: project.id,
      workspaceId: workspace.id,
      source: body.source || "IN_APP",
      createdById: user.id,
    }).returning();

    if (!intakeIssue) return c.json({ error: "Failed to create intake issue" }, 500);

    // Create issue activity
    await db.insert(issueActivities).values({
      issueId: newIssue.id,
      projectId: project.id,
      workspaceId: workspace.id,
      actorId: user.id,
      verb: "created",
      field: "issue",
    });

    const result = await enrichIntakeIssue(intakeIssue);
    return c.json(result, 201);
  }
);

// =====================================================
// GET /:issueId/ - Retrieve intake issue by issue ID
// =====================================================
intakeRoutes.get("/:issueId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  if (!project || !workspace) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");

  // Check intake is enabled
  const fullProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });
  if (!fullProject?.intakeView) {
    return c.json({ detail: "Not found." }, 404);
  }

  const intake = await db.query.intakes.findFirst({
    where: and(eq(intakes.projectId, project.id), isNull(intakes.deletedAt)),
  });
  if (!intake) return c.json({ detail: "Not found." }, 404);

  const intakeIssue = await db.query.intakeIssues.findFirst({
    where: and(
      eq(intakeIssues.issueId, issueId),
      eq(intakeIssues.intakeId, intake.id),
      eq(intakeIssues.projectId, project.id),
    ),
  });

  if (!intakeIssue) return c.json({ detail: "Not found." }, 404);

  const result = await enrichIntakeIssue(intakeIssue);
  return c.json(result);
});

// =====================================================
// PATCH /:issueId/ - Update intake issue
// =====================================================
intakeRoutes.patch(
  "/:issueId/",
  zValidator("json", updateIntakeIssueSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const issueId = c.req.param("issueId");
    const body = c.req.valid("json");

    // Check intake is enabled
    const fullProject = await db.query.projects.findFirst({
      where: eq(projects.id, project.id),
    });
    if (!fullProject?.intakeView) {
      return c.json(
        { error: "Intake is not enabled for this project enable it through the project's api" },
        400
      );
    }

    const intake = await db.query.intakes.findFirst({
      where: and(eq(intakes.projectId, project.id), isNull(intakes.deletedAt)),
    });
    if (!intake) return c.json({ detail: "Not found." }, 404);

    // Get the intake issue
    const intakeIssue = await db.query.intakeIssues.findFirst({
      where: and(
        eq(intakeIssues.issueId, issueId),
        eq(intakeIssues.intakeId, intake.id),
        eq(intakeIssues.projectId, project.id),
      ),
    });
    if (!intakeIssue) return c.json({ detail: "Not found." }, 404);

    // Get project membership
    const membership = c.get("projectMembership");
    if (!membership) return c.json({ detail: "Not found." }, 404);

    // Only project members admins and created_by users can access this endpoint
    if (membership.role <= ROLES.GUEST && intakeIssue.createdById !== user.id) {
      return c.json({ error: "You cannot edit intake work items" }, 400);
    }

    // Handle issue data update
    const issueData = body.issue;
    if (issueData) {
      const existingIssue = await db.query.issues.findFirst({
        where: eq(issues.id, issueId),
      });
      if (!existingIssue) return c.json({ detail: "Issue not found." }, 404);

      // Only allow guests to edit name and description
      let updateData: Record<string, unknown> = {};
      if (membership.role <= ROLES.GUEST) {
        if (issueData.name !== undefined) updateData.name = issueData.name;
        if (issueData.description_html !== undefined) updateData.descriptionHtml = issueData.description_html;
      } else {
        if (issueData.name !== undefined) updateData.name = issueData.name;
        if (issueData.description_html !== undefined) updateData.descriptionHtml = issueData.description_html;
        if (issueData.priority !== undefined) {
          updateData.priority = typeof issueData.priority === "string"
            ? (priorityMap[issueData.priority] ?? 0)
            : issueData.priority;
        }
        if (issueData.state_id !== undefined) updateData.stateId = issueData.state_id;
      }

      if (Object.keys(updateData).length > 0) {
        updateData.updatedAt = new Date();
        await db.update(issues).set(updateData).where(eq(issues.id, issueId));

        // Log activity
        await db.insert(issueActivities).values({
          issueId,
          projectId: project.id,
          workspaceId: workspace.id,
          actorId: user.id,
          verb: "updated",
          field: "issue",
        });
      }

      // Handle assignee updates
      if (issueData.assignee_ids && membership.role > ROLES.GUEST) {
        // Remove existing assignees
        await db.delete(issueAssignees).where(eq(issueAssignees.issueId, issueId));
        // Add new assignees
        for (const assigneeId of issueData.assignee_ids) {
          await db.insert(issueAssignees).values({ issueId, assigneeId });
        }
      }

      // Handle label updates
      if (issueData.label_ids && membership.role > ROLES.GUEST) {
        await db.delete(issueLabels).where(eq(issueLabels.issueId, issueId));
        for (const labelId of issueData.label_ids) {
          await db.insert(issueLabels).values({ issueId, labelId });
        }
      }
    }

    // Handle intake issue status update (only admins/members)
    if (membership.role > ROLES.MEMBER) {
      const intakeUpdate: Record<string, unknown> = {};

      if (body.status !== undefined) {
        // If accepting (status=1), verify default state exists and transition issue
        if (body.status === 1) {
          const issue = await db.query.issues.findFirst({ where: eq(issues.id, issueId) });
          if (issue?.stateId) {
            const currentState = await db.query.states.findFirst({ where: eq(states.id, issue.stateId) });
            if (currentState?.group === "triage") {
              const defaultState = await db.query.states.findFirst({
                where: and(
                  eq(states.projectId, project.id),
                  eq(states.isDefault, true),
                ),
              });
              if (!defaultState) {
                return c.json({ error: "Cannot accept intake issue: No default state found for the project" }, 400);
              }
              // Transition issue from triage to default state
              await db.update(issues)
                .set({ stateId: defaultState.id, updatedAt: new Date() })
                .where(eq(issues.id, issueId));
            }
          }
        }
        intakeUpdate.status = body.status;
      }

      if (body.snoozed_till !== undefined) {
        intakeUpdate.snoozedTill = body.snoozed_till ? new Date(body.snoozed_till) : null;
      }
      if (body.duplicate_to !== undefined) {
        intakeUpdate.duplicateToId = body.duplicate_to;
      }
      if (body.source !== undefined) {
        intakeUpdate.source = body.source;
      }
      if (body.source_email !== undefined) {
        intakeUpdate.sourceEmail = body.source_email;
      }

      if (Object.keys(intakeUpdate).length > 0) {
        intakeUpdate.updatedAt = new Date();
        await db.update(intakeIssues).set(intakeUpdate).where(eq(intakeIssues.id, intakeIssue.id));
      }
    }

    // Return updated intake issue
    const updated = await db.query.intakeIssues.findFirst({
      where: eq(intakeIssues.id, intakeIssue.id),
    });
    if (!updated) return c.json({ detail: "Not found." }, 404);

    const result = await enrichIntakeIssue(updated);
    return c.json(result);
  }
);

// =====================================================
// DELETE /:issueId/ - Delete intake issue
// =====================================================
intakeRoutes.delete("/:issueId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");

  // Check intake is enabled
  const fullProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });
  if (!fullProject?.intakeView) {
    return c.json(
      { error: "Intake is not enabled for this project enable it through the project's api" },
      400
    );
  }

  const intake = await db.query.intakes.findFirst({
    where: and(eq(intakes.projectId, project.id), isNull(intakes.deletedAt)),
  });
  if (!intake) return c.json({ detail: "Not found." }, 404);

  // Get the intake issue
  const intakeIssue = await db.query.intakeIssues.findFirst({
    where: and(
      eq(intakeIssues.issueId, issueId),
      eq(intakeIssues.intakeId, intake.id),
      eq(intakeIssues.projectId, project.id),
    ),
  });
  if (!intakeIssue) return c.json({ detail: "Not found." }, 404);

  // If issue is not accepted (status is pending, rejected, snoozed, or duplicate), also delete the issue
  if (intakeIssue.status !== 1) {
    // Check permissions: only admin or creator can delete
    const issue = await db.query.issues.findFirst({
      where: eq(issues.id, issueId),
    });

    if (issue && issue.createdById !== user.id) {
      const isAdmin = await db.query.projectMembers.findFirst({
        where: and(
          eq(projectMembers.projectId, project.id),
          eq(projectMembers.memberId, user.id),
          eq(projectMembers.role, ROLES.ADMIN),
          eq(projectMembers.isActive, true),
        ),
      });

      if (!isAdmin) {
        return c.json({ error: "Only admin or creator can delete the work item" }, 403);
      }
    }

    // Delete the issue
    if (issue) {
      await db.delete(issues).where(eq(issues.id, issueId));
    }
  }

  // Delete the intake issue
  await db.delete(intakeIssues).where(eq(intakeIssues.id, intakeIssue.id));

  return c.body(null, 204);
});

export { intakeRoutes };

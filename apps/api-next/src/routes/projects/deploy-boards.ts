import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../../db";
import { projects, projectMembers, deployBoards } from "../../db/schema/project";
import { workspaces } from "../../db/schema/workspace";
import { users } from "../../db/schema/user";
import { authMiddleware } from "../../middleware/auth";
import { workspaceMiddleware } from "../../middleware/workspace";
import { projectMiddleware, requireProjectAdmin } from "../../middleware/project";
import type { Variables } from "../../app";

const deployBoardRoutes = new Hono<{ Variables: Variables }>();

// Apply auth + workspace + project middleware
deployBoardRoutes.use("*", authMiddleware);
deployBoardRoutes.use("*", workspaceMiddleware);
deployBoardRoutes.use("*", projectMiddleware);

// --- Helpers ---

function formatDeployBoard(
  board: typeof deployBoards.$inferSelect | null,
  project?: typeof projects.$inferSelect | null,
  workspace?: typeof workspaces.$inferSelect | null,
) {
  if (!board) {
    return {
      id: null,
      anchor: null,
      entity_identifier: null,
      entity_name: null,
      is_comments_enabled: false,
      is_reactions_enabled: false,
      is_votes_enabled: false,
      view_props: {},
      is_activity_enabled: true,
      is_disabled: false,
      project: null,
      workspace: null,
      project_details: null,
      workspace_detail: null,
      created_at: null,
      updated_at: null,
      created_by: null,
    };
  }

  return {
    id: board.id,
    anchor: board.anchor,
    entity_identifier: board.entityIdentifier,
    entity_name: board.entityName,
    is_comments_enabled: board.isCommentsEnabled ?? false,
    is_reactions_enabled: board.isReactionsEnabled ?? false,
    is_votes_enabled: board.isVotesEnabled ?? false,
    view_props: board.viewProps ?? {},
    is_activity_enabled: board.isActivityEnabled ?? true,
    is_disabled: board.isDisabled ?? false,
    project: board.projectId,
    workspace: board.workspaceId,
    project_details: project
      ? {
          id: project.id,
          name: project.name,
          identifier: project.identifier,
          emoji: project.emoji ?? null,
          icon_prop: project.iconProp ?? null,
          logo_props: project.logoProps ?? {},
          cover_image: project.coverImage ?? null,
          description: project.description ?? "",
        }
      : null,
    workspace_detail: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        }
      : null,
    created_at: board.createdAt?.toISOString() ?? null,
    updated_at: board.updatedAt?.toISOString() ?? null,
    created_by: board.createdById ?? null,
  };
}

// --- GET / - List deploy board for project ---
deployBoardRoutes.get("/", async (c) => {
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;

  const board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.entityName, "project"),
      eq(deployBoards.entityIdentifier, project.id),
      eq(deployBoards.workspaceId, workspace.id),
      isNull(deployBoards.deletedAt),
    ),
  });

  const fullProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });
  const fullWorkspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspace.id),
  });

  return c.json(formatDeployBoard(board ?? null, fullProject, fullWorkspace));
});

// --- POST / - Create or update deploy board ---
const createDeployBoardSchema = z.object({
  is_comments_enabled: z.boolean().optional().default(false),
  is_reactions_enabled: z.boolean().optional().default(false),
  is_votes_enabled: z.boolean().optional().default(false),
  views: z
    .object({
      list: z.boolean().optional(),
      kanban: z.boolean().optional(),
      calendar: z.boolean().optional(),
      gantt: z.boolean().optional(),
      spreadsheet: z.boolean().optional(),
    })
    .optional()
    .default({
      list: true,
      kanban: true,
      calendar: true,
      gantt: true,
      spreadsheet: true,
    }),
  view_props: z
    .object({
      list: z.boolean().optional(),
      kanban: z.boolean().optional(),
      calendar: z.boolean().optional(),
      gantt: z.boolean().optional(),
      spreadsheet: z.boolean().optional(),
    })
    .optional(),
  intake: z.string().nullable().optional(),
});

deployBoardRoutes.post("/", zValidator("json", createDeployBoardSchema), async (c) => {
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const user = c.get("user")!;
  const data = c.req.valid("json");

  const viewProps = data.view_props ?? data.views ?? {
    list: true,
    kanban: true,
    calendar: true,
    gantt: true,
    spreadsheet: true,
  };

  // Check if deploy board already exists (get_or_create pattern)
  let board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.entityName, "project"),
      eq(deployBoards.entityIdentifier, project.id),
      isNull(deployBoards.deletedAt),
    ),
  });

  if (board) {
    // Update existing
    const [updated] = await db
      .update(deployBoards)
      .set({
        isCommentsEnabled: data.is_comments_enabled ?? false,
        isReactionsEnabled: data.is_reactions_enabled ?? false,
        isVotesEnabled: data.is_votes_enabled ?? false,
        viewProps: viewProps,
        updatedAt: new Date(),
      })
      .where(eq(deployBoards.id, board.id))
      .returning();
    board = updated;
  } else {
    // Create new
    const [created] = await db
      .insert(deployBoards)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
        entityIdentifier: project.id,
        entityName: "project",
        isCommentsEnabled: data.is_comments_enabled ?? false,
        isReactionsEnabled: data.is_reactions_enabled ?? false,
        isVotesEnabled: data.is_votes_enabled ?? false,
        viewProps: viewProps,
        createdById: user.id,
      })
      .returning();
    board = created;
  }

  const fullProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });
  const fullWorkspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspace.id),
  });

  return c.json(formatDeployBoard(board, fullProject, fullWorkspace));
});

// --- PATCH /:publishId - Update deploy board ---
const updateDeployBoardSchema = z.object({
  is_comments_enabled: z.boolean().optional(),
  is_reactions_enabled: z.boolean().optional(),
  is_votes_enabled: z.boolean().optional(),
  view_props: z
    .object({
      list: z.boolean().optional(),
      kanban: z.boolean().optional(),
      calendar: z.boolean().optional(),
      gantt: z.boolean().optional(),
      spreadsheet: z.boolean().optional(),
    })
    .optional(),
  views: z
    .object({
      list: z.boolean().optional(),
      kanban: z.boolean().optional(),
      calendar: z.boolean().optional(),
      gantt: z.boolean().optional(),
      spreadsheet: z.boolean().optional(),
    })
    .optional(),
  is_activity_enabled: z.boolean().optional(),
  is_disabled: z.boolean().optional(),
});

deployBoardRoutes.patch("/:publishId/", zValidator("json", updateDeployBoardSchema), async (c) => {
  const publishId = c.req.param("publishId");
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const data = c.req.valid("json");

  const board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.id, publishId),
      eq(deployBoards.projectId, project.id),
      isNull(deployBoards.deletedAt),
    ),
  });

  if (!board) {
    return c.json({ detail: "Deploy board not found." }, 404);
  }

  const viewProps = data.view_props ?? data.views;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (data.is_comments_enabled !== undefined) updates.isCommentsEnabled = data.is_comments_enabled;
  if (data.is_reactions_enabled !== undefined) updates.isReactionsEnabled = data.is_reactions_enabled;
  if (data.is_votes_enabled !== undefined) updates.isVotesEnabled = data.is_votes_enabled;
  if (viewProps !== undefined) updates.viewProps = viewProps;
  if (data.is_activity_enabled !== undefined) updates.isActivityEnabled = data.is_activity_enabled;
  if (data.is_disabled !== undefined) updates.isDisabled = data.is_disabled;

  const [updated] = await db
    .update(deployBoards)
    .set(updates)
    .where(eq(deployBoards.id, publishId))
    .returning();

  const fullProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });
  const fullWorkspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspace.id),
  });

  return c.json(formatDeployBoard(updated, fullProject, fullWorkspace));
});

// --- DELETE /:publishId - Unpublish (soft delete) ---
deployBoardRoutes.delete("/:publishId/", async (c) => {
  const publishId = c.req.param("publishId");
  const project = c.get("project")!;

  const board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.id, publishId),
      eq(deployBoards.projectId, project.id),
      isNull(deployBoards.deletedAt),
    ),
  });

  if (!board) {
    return c.json({ detail: "Deploy board not found." }, 404);
  }

  await db
    .update(deployBoards)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(deployBoards.id, publishId));

  return c.body(null, 204);
});

// --- GET /:publishId - Get specific deploy board ---
deployBoardRoutes.get("/:publishId/", async (c) => {
  const publishId = c.req.param("publishId");
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;

  const board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.id, publishId),
      eq(deployBoards.projectId, project.id),
      isNull(deployBoards.deletedAt),
    ),
  });

  if (!board) {
    return c.json({ detail: "Deploy board not found." }, 404);
  }

  const fullProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });
  const fullWorkspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspace.id),
  });

  return c.json(formatDeployBoard(board, fullProject, fullWorkspace));
});

export { deployBoardRoutes };

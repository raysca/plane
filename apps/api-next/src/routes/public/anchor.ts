import { Hono } from "hono";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { projects, projectMembers, deployBoards } from "../../db/schema/project";
import { workspaces } from "../../db/schema/workspace";
import { users } from "../../db/schema/user";

const publicAnchorRoutes = new Hono();

// --- GET /anchor/:anchor/settings/ - Public deploy board settings ---
publicAnchorRoutes.get("/anchor/:anchor/settings/", async (c) => {
  const anchor = c.req.param("anchor");

  const board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.anchor, anchor),
      eq(deployBoards.entityName, "project"),
      isNull(deployBoards.deletedAt),
    ),
  });

  if (!board) {
    return c.json({ detail: "Project is not published." }, 404);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, board.projectId),
  });
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, board.workspaceId),
  });

  return c.json({
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
  });
});

// --- GET /workspaces/:slug/projects/:projectId/anchor/ - Get anchor by project ---
publicAnchorRoutes.get("/workspaces/:slug/projects/:projectId/anchor/", async (c) => {
  const slug = c.req.param("slug");
  const projectId = c.req.param("projectId");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  const board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.workspaceId, workspace.id),
      eq(deployBoards.projectId, projectId),
      eq(deployBoards.entityName, "project"),
      isNull(deployBoards.deletedAt),
    ),
  });

  if (!board) {
    return c.json({ detail: "Project is not published." }, 404);
  }

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, board.projectId),
  });

  return c.json({
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
    workspace_detail: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    },
    created_at: board.createdAt?.toISOString() ?? null,
    updated_at: board.updatedAt?.toISOString() ?? null,
    created_by: board.createdById ?? null,
  });
});

// --- GET /anchor/:anchor/members/ - Public project members ---
publicAnchorRoutes.get("/anchor/:anchor/members/", async (c) => {
  const anchor = c.req.param("anchor");

  const board = await db.query.deployBoards.findFirst({
    where: and(
      eq(deployBoards.anchor, anchor),
      isNull(deployBoards.deletedAt),
    ),
  });

  if (!board) {
    return c.json({ detail: "Project is not published." }, 404);
  }

  const members = await db
    .select({
      id: projectMembers.id,
      member: projectMembers.memberId,
      member__display_name: users.displayName,
      member__first_name: users.name,
      project: projectMembers.projectId,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.memberId, users.id))
    .where(
      and(
        eq(projectMembers.projectId, board.projectId),
        eq(projectMembers.isActive, true),
      )
    );

  return c.json(
    members.map((m) => ({
      id: m.id,
      member: m.member,
      member__display_name: m.member__display_name ?? "",
      member__first_name: m.member__first_name ?? "",
      project: m.project,
      workspace: board.workspaceId,
    }))
  );
});

export { publicAnchorRoutes };

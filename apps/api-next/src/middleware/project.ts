import { createMiddleware } from "hono/factory";
import type { Variables } from "../app";
import { db } from "../db";
import { projects, projectMembers } from "../db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { ROLES } from "./auth";

/**
 * Project middleware
 * Loads project by ID and checks membership
 * Must be used after workspaceMiddleware
 */
export const projectMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const projectId = c.req.param("projectId");
  const workspace = c.get("workspace");
  const user = c.get("user");

  if (!user) {
    return c.json({ detail: "Authentication credentials were not provided." }, 401);
  }

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 400);
  }

  if (!projectId) {
    return c.json({ detail: "Project ID is required." }, 400);
  }

  // Find project
  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.workspaceId, workspace.id),
      isNull(projects.deletedAt)
    ),
  });

  if (!project) {
    return c.json({ detail: "Project not found." }, 404);
  }

  // Check project membership
  const membership = await db.query.projectMembers.findFirst({
    where: and(eq(projectMembers.projectId, project.id), eq(projectMembers.memberId, user.id)),
  });

  // If not a project member, check workspace role
  // Workspace admins have access to all projects
  const workspaceMembership = c.get("workspaceMembership");
  if (!membership && workspaceMembership?.role !== ROLES.ADMIN) {
    // Check if project is public within workspace
    if (project.network !== 2) {
      // 2 = public
      return c.json({ detail: "You are not a member of this project." }, 403);
    }
  }

  c.set("project", project);
  if (membership) {
    c.set("projectMembership", membership);
  }

  await next();
});

/**
 * Require project admin role
 */
export const requireProjectAdmin = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const projectMembership = c.get("projectMembership");
  const workspaceMembership = c.get("workspaceMembership");

  // Workspace admins have full project access
  if (workspaceMembership?.role === ROLES.ADMIN) {
    return await next();
  }

  if (!projectMembership) {
    return c.json({ detail: "Project membership not found." }, 403);
  }

  if (projectMembership.role < ROLES.ADMIN) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  await next();
});

/**
 * Require project member role (or higher)
 */
export const requireProjectMember = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const projectMembership = c.get("projectMembership");
  const workspaceMembership = c.get("workspaceMembership");

  // Workspace admins have full project access
  if (workspaceMembership?.role === ROLES.ADMIN) {
    return await next();
  }

  if (!projectMembership) {
    return c.json({ detail: "Project membership not found." }, 403);
  }

  if (projectMembership.role < ROLES.MEMBER) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  await next();
});

/**
 * Check if user can view project (viewer role or higher)
 */
export const requireProjectViewer = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const projectMembership = c.get("projectMembership");
  const workspaceMembership = c.get("workspaceMembership");
  const project = c.get("project");

  // Workspace admins have full project access
  if (workspaceMembership?.role === ROLES.ADMIN) {
    return await next();
  }

  // Public projects can be viewed by workspace members
  if (project?.network === 2 && workspaceMembership) {
    return await next();
  }

  if (!projectMembership) {
    return c.json({ detail: "Project membership not found." }, 403);
  }

  if (projectMembership.role < ROLES.VIEWER) {
    return c.json({ detail: "You do not have permission to view this project." }, 403);
  }

  await next();
});

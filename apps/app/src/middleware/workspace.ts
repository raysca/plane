import { createMiddleware } from "hono/factory";
import type { Variables } from "../app";
import { db } from "../db";
import { workspaces, workspaceMembers } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { ROLES, type Role } from "./auth";

/**
 * Workspace middleware
 * Loads workspace by slug and checks membership
 * Must be used after authMiddleware
 */
export const workspaceMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  if (!user) {
    return c.json({ detail: "Authentication credentials were not provided." }, 401);
  }

  if (!slug) {
    return c.json({ detail: "Workspace slug is required." }, 400);
  }

  // Find workspace by slug
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  // Check membership
  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id)
    ),
  });

  if (!membership) {
    return c.json({ detail: "You are not a member of this workspace." }, 403);
  }

  if (!membership.isActive) {
    return c.json({ detail: "Your workspace membership is inactive." }, 403);
  }

  c.set("workspace", workspace);
  c.set("workspaceMembership", membership);

  await next();
});

/**
 * Require workspace admin role
 */
export const requireWorkspaceAdmin = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const membership = c.get("workspaceMembership");

  if (!membership) {
    return c.json({ detail: "Workspace membership not found." }, 403);
  }

  if (membership.role < ROLES.ADMIN) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  await next();
});

/**
 * Require workspace member role (or higher)
 */
export const requireWorkspaceMember = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    const membership = c.get("workspaceMembership");

    if (!membership) {
      return c.json({ detail: "Workspace membership not found." }, 403);
    }

    if (membership.role < ROLES.MEMBER) {
      return c.json({ detail: "You do not have permission to perform this action." }, 403);
    }

    await next();
  }
);

/**
 * Check if user is workspace owner
 */
export const requireWorkspaceOwner = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const workspace = c.get("workspace");
  const user = c.get("user");

  if (!workspace || !user) {
    return c.json({ detail: "Workspace or user not found." }, 400);
  }

  if (workspace.ownerId !== user.id) {
    return c.json({ detail: "Only the workspace owner can perform this action." }, 403);
  }

  await next();
});

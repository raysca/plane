import { createMiddleware } from "hono/factory";
import type { Variables } from "../app";
import { auth } from "../lib/auth";

// Role constants (match Django)
export const ROLES = {
  GUEST: 5,
  VIEWER: 10,
  MEMBER: 15,
  ADMIN: 20,
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/**
 * Authentication middleware using Better Auth session
 * Requires valid session, returns 401 if not authenticated
 */
export const authMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      console.log("[AuthDebug] Headers:", c.req.raw.headers);
      console.log("[AuthDebug] Session not found");
      return c.json({ detail: "Authentication credentials were not provided." }, 401);
    }

    if (!session.user.isActive) {
      return c.json({ detail: "User account is disabled." }, 403);
    }

    // Set user in context with proper types
    c.set("user", {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      username: session.user.username || null,
      displayName: session.user.displayName || null,
      avatar: session.user.avatar || null,
      isOnboarded: session.user.isOnboarded || false,
      isActive: session.user.isActive ?? true,
      createdAt: session.user.createdAt ? new Date(session.user.createdAt) : new Date(),
      updatedAt: session.user.updatedAt ? new Date(session.user.updatedAt) : new Date(),
    });

    c.set("session", {
      id: session.session.id,
      userId: session.session.userId,
      expiresAt: new Date(session.session.expiresAt),
    });

    await next();
  } catch (error) {
    console.error("[Auth] Session error:", error);
    return c.json({ detail: "Authentication credentials were not provided." }, 401);
  }
});

/**
 * Optional authentication middleware
 * Attaches user if present but doesn't require it
 */
export const optionalAuthMiddleware = createMiddleware<{ Variables: Variables }>(
  async (c, next) => {
    try {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });

      if (session?.user && session.user.isActive) {
        c.set("user", {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          username: session.user.username || null,
          displayName: session.user.displayName || null,
          avatar: session.user.avatar || null,
          isOnboarded: session.user.isOnboarded || false,
          isActive: session.user.isActive ?? true,
          createdAt: session.user.createdAt ? new Date(session.user.createdAt) : new Date(),
          updatedAt: session.user.updatedAt ? new Date(session.user.updatedAt) : new Date(),
        });

        c.set("session", {
          id: session.session.id,
          userId: session.session.userId,
          expiresAt: new Date(session.session.expiresAt),
        });
      }
    } catch {
      // Silently ignore auth errors for optional auth
    }

    await next();
  }
);

/**
 * API token authentication middleware
 * Checks X-API-Key header for programmatic access
 */
export const apiTokenMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const apiKey = c.req.header("X-API-Key");

  if (!apiKey) {
    // No API key, fall through to session auth
    return await next();
  }

  // TODO: Implement API token validation when API tokens schema is ready
  // const tokenHash = await hashToken(apiKey);
  // const token = await db.query.apiTokens.findFirst({
  //   where: eq(apiTokens.tokenHash, tokenHash),
  // });
  //
  // if (!token) {
  //   return c.json({ detail: "Invalid API key." }, 401);
  // }
  //
  // if (token.expiresAt && token.expiresAt < new Date()) {
  //   return c.json({ detail: "API key expired." }, 401);
  // }
  //
  // // Update last used
  // await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id));
  //
  // // Fetch user
  // const user = await db.query.users.findFirst({ where: eq(users.id, token.userId) });
  // c.set("user", user);

  return c.json({ detail: "API token authentication not yet implemented." }, 501);
});

/**
 * Role check middleware factory
 * Use after auth middleware to check minimum role
 */
export const requireRole = (minRole: Role) =>
  createMiddleware<{ Variables: Variables }>(async (c, next) => {
    const membership = c.get("workspaceMembership") || c.get("projectMembership");

    if (!membership) {
      return c.json({ detail: "You do not have permission to perform this action." }, 403);
    }

    if (membership.role < minRole) {
      return c.json({ detail: "You do not have permission to perform this action." }, 403);
    }

    await next();
  });

/**
 * Helper to hash API tokens
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Buffer.from(hash).toString("hex");
}

/**
 * Helper to generate API tokens
 */
export function generateApiToken(): { token: string; prefix: string } {
  const token = `plane_${crypto.randomUUID().replace(/-/g, "")}`;
  const prefix = token.slice(0, 12);
  return { token, prefix };
}

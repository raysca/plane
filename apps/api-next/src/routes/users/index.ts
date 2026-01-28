import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { db } from "../../db";
import {
  users,
  accounts,
  userProfiles,
} from "../../db/schema/user";
import {
  workspaces,
  workspaceMembers,
  recentVisits,
} from "../../db/schema/workspace";
import { notificationPreferences } from "../../db/schema/notification";
import { authMiddleware } from "../../middleware/auth";
import type { Variables } from "../../app";

const userRoutes = new Hono<{ Variables: Variables }>();

// Apply auth middleware to all user routes
userRoutes.use("*", authMiddleware);

// Helper to format user for API response (snake_case)
function formatUserResponse(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    first_name: user.firstName ?? "",
    last_name: user.lastName ?? "",
    username: user.username ?? "",
    display_name: user.displayName ?? user.name ?? "",
    avatar: user.avatar ?? user.image ?? "",
    cover_image: user.coverImage ?? "",
    is_onboarded: user.isOnboarded ?? false,
    is_active: user.isActive ?? true,
    is_tour_completed: user.isTourCompleted ?? false,
    onboarding_step: user.onboardingStep ?? 0,
    created_at: user.createdAt?.toISOString() ?? null,
    updated_at: user.updatedAt?.toISOString() ?? null,
    last_login_at: user.lastLoginAt?.toISOString() ?? null,
  };
}

// Helper to format profile response
function formatProfileResponse(profile: typeof userProfiles.$inferSelect) {
  return {
    id: profile.id,
    user_id: profile.userId,
    timezone: profile.timezone ?? "UTC",
    date_format: profile.dateFormat ?? "MM/DD/YYYY",
    time_format: profile.timeFormat ?? "12h",
    theme: profile.theme ?? "system",
    language: profile.language ?? "en",
    created_at: profile.createdAt?.toISOString() ?? null,
    updated_at: profile.updatedAt?.toISOString() ?? null,
  };
}

// Helper to format notification preferences response
function formatNotificationPrefsResponse(prefs: typeof notificationPreferences.$inferSelect) {
  return {
    id: prefs.id,
    user_id: prefs.userId,
    property_change_email: prefs.propertyChangeEmail ?? true,
    state_change_email: prefs.stateChangeEmail ?? true,
    comment_email: prefs.commentEmail ?? true,
    mention_email: prefs.mentionEmail ?? true,
    issue_completed_email: prefs.issueCompletedEmail ?? true,
    created_at: prefs.createdAt?.toISOString() ?? null,
    updated_at: prefs.updatedAt?.toISOString() ?? null,
  };
}

// Validation schemas
const updateUserSchema = z.object({
  first_name: z.string().max(50).optional(),
  last_name: z.string().max(50).optional(),
  display_name: z.string().max(100).optional(),
  username: z.string().min(3).max(30).regex(/^[a-z0-9_-]+$/).optional(),
  avatar: z.string().url().optional().nullable(),
  cover_image: z.string().url().optional().nullable(),
  is_onboarded: z.boolean().optional(),
  is_tour_completed: z.boolean().optional(),
  onboarding_step: z.number().int().min(0).max(10).optional(),
});

const updateProfileSchema = z.object({
  timezone: z.string().max(50).optional(),
  date_format: z.string().max(20).optional(),
  time_format: z.enum(["12h", "24h"]).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  language: z.string().max(10).optional(),
});

const updateNotificationPrefsSchema = z.object({
  property_change_email: z.boolean().optional(),
  state_change_email: z.boolean().optional(),
  comment_email: z.boolean().optional(),
  mention_email: z.boolean().optional(),
  issue_completed_email: z.boolean().optional(),
});

const addEmailSchema = z.object({
  email: z.string().email(),
});

// Helper to get or create profile
async function getOrCreateProfile(userId: string) {
  let profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
  });

  if (!profile) {
    const result = await db.insert(userProfiles).values({
      userId,
    }).returning();
    profile = result[0];
  }

  return profile!;
}

// Helper to get or create notification prefs
async function getOrCreateNotificationPrefs(userId: string) {
  let prefs = await db.query.notificationPreferences.findFirst({
    where: eq(notificationPreferences.userId, userId),
  });

  if (!prefs) {
    const result = await db.insert(notificationPreferences).values({
      userId,
    }).returning();
    prefs = result[0];
  }

  return prefs!;
}

// GET /api/users/me/ - Get current user
userRoutes.get("/me/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, contextUser.id),
  });

  if (!user) {
    return c.json({ detail: "User not found." }, 404);
  }

  return c.json(formatUserResponse(user));
});

// PATCH /api/users/me/ - Update current user
userRoutes.patch("/me/", zValidator("json", updateUserSchema), async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const body = c.req.valid("json");

  // Check username uniqueness if being updated
  if (body.username) {
    const existing = await db.query.users.findFirst({
      where: eq(users.username, body.username),
    });
    if (existing && existing.id !== contextUser.id) {
      return c.json({ username: ["This username is already taken."] }, 400);
    }
  }

  // Convert snake_case to camelCase for DB
  const updateData: Partial<typeof users.$inferInsert> = {
    ...(body.first_name !== undefined && { firstName: body.first_name }),
    ...(body.last_name !== undefined && { lastName: body.last_name }),
    ...(body.display_name !== undefined && { displayName: body.display_name }),
    ...(body.username !== undefined && { username: body.username }),
    ...(body.avatar !== undefined && { avatar: body.avatar }),
    ...(body.cover_image !== undefined && { coverImage: body.cover_image }),
    ...(body.is_onboarded !== undefined && { isOnboarded: body.is_onboarded }),
    ...(body.is_tour_completed !== undefined && { isTourCompleted: body.is_tour_completed }),
    ...(body.onboarding_step !== undefined && { onboardingStep: body.onboarding_step }),
    updatedAt: new Date(),
  };

  await db.update(users).set(updateData).where(eq(users.id, contextUser.id));

  const updatedUser = await db.query.users.findFirst({
    where: eq(users.id, contextUser.id),
  });

  if (!updatedUser) {
    return c.json({ detail: "User not found." }, 404);
  }

  return c.json(formatUserResponse(updatedUser));
});

// GET /api/users/me/profile/ - Get user profile
userRoutes.get("/me/profile/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const profile = await getOrCreateProfile(contextUser.id);
  return c.json(formatProfileResponse(profile));
});

// PATCH /api/users/me/profile/ - Update user profile
userRoutes.patch("/me/profile/", zValidator("json", updateProfileSchema), async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const body = c.req.valid("json");

  // Ensure profile exists
  await getOrCreateProfile(contextUser.id);

  const updateData = {
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    ...(body.date_format !== undefined && { dateFormat: body.date_format }),
    ...(body.time_format !== undefined && { timeFormat: body.time_format }),
    ...(body.theme !== undefined && { theme: body.theme }),
    ...(body.language !== undefined && { language: body.language }),
    updatedAt: new Date(),
  };

  await db.update(userProfiles).set(updateData).where(eq(userProfiles.userId, contextUser.id));

  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, contextUser.id),
  });

  return c.json(formatProfileResponse(profile!));
});

// GET /api/users/me/settings/ - Get user settings (alias for profile)
userRoutes.get("/me/settings/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const profile = await getOrCreateProfile(contextUser.id);

  // Settings combines profile data with user display preferences
  return c.json({
    id: profile.id,
    user_id: profile.userId,
    timezone: profile.timezone ?? "UTC",
    date_format: profile.dateFormat ?? "MM/DD/YYYY",
    time_format: profile.timeFormat ?? "12h",
    theme: profile.theme ?? "system",
    language: profile.language ?? "en",
  });
});

// PATCH /api/users/me/settings/ - Update user settings
userRoutes.patch("/me/settings/", zValidator("json", updateProfileSchema), async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const body = c.req.valid("json");

  // Ensure profile exists
  await getOrCreateProfile(contextUser.id);

  const updateData = {
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    ...(body.date_format !== undefined && { dateFormat: body.date_format }),
    ...(body.time_format !== undefined && { timeFormat: body.time_format }),
    ...(body.theme !== undefined && { theme: body.theme }),
    ...(body.language !== undefined && { language: body.language }),
    updatedAt: new Date(),
  };

  await db.update(userProfiles).set(updateData).where(eq(userProfiles.userId, contextUser.id));

  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, contextUser.id),
  });

  return c.json({
    id: profile!.id,
    user_id: profile!.userId,
    timezone: profile!.timezone ?? "UTC",
    date_format: profile!.dateFormat ?? "MM/DD/YYYY",
    time_format: profile!.timeFormat ?? "12h",
    theme: profile!.theme ?? "system",
    language: profile!.language ?? "en",
  });
});

// GET /api/users/me/accounts/ - Get linked OAuth accounts
userRoutes.get("/me/accounts/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const linkedAccounts = await db.query.accounts.findMany({
    where: eq(accounts.userId, contextUser.id),
  });

  // Return accounts in DRF format (excluding credential accounts)
  const oauthAccounts = linkedAccounts
    .filter((acc) => acc.providerId !== "credential")
    .map((acc) => ({
      id: acc.id,
      provider: acc.providerId,
      provider_account_id: acc.accountId,
      created_at: acc.createdAt?.toISOString() ?? null,
    }));

  return c.json(oauthAccounts);
});

// GET /api/users/me/workspaces/ - Get user's workspaces
userRoutes.get("/me/workspaces/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  // Get memberships with workspace data using a join
  const memberships = await db
    .select({
      membership: workspaceMembers,
      workspace: workspaces,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, contextUser.id));

  const workspaceList = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    logo: m.workspace.logo,
    owner_id: m.workspace.ownerId,
    organization_size: m.workspace.organizationSize,
    role: m.membership.role,
    is_active: m.membership.isActive,
    created_at: m.workspace.createdAt?.toISOString() ?? null,
    updated_at: m.workspace.updatedAt?.toISOString() ?? null,
  }));

  return c.json(workspaceList);
});

// GET /api/users/me/activities/ - Get user activities (recent visits)
userRoutes.get("/me/activities/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  // Get recent visits with workspace data
  const visits = await db
    .select({
      visit: recentVisits,
      workspace: workspaces,
    })
    .from(recentVisits)
    .innerJoin(workspaces, eq(recentVisits.workspaceId, workspaces.id))
    .where(eq(recentVisits.userId, contextUser.id))
    .orderBy(desc(recentVisits.visitedAt))
    .limit(20);

  const activities = visits.map((v) => ({
    id: v.visit.id,
    workspace_id: v.visit.workspaceId,
    workspace_slug: v.workspace.slug,
    entity_type: v.visit.entityType,
    entity_id: v.visit.entityId,
    visited_at: v.visit.visitedAt?.toISOString() ?? null,
  }));

  return c.json(activities);
});

// GET /api/users/me/notification-preferences/ - Get notification preferences
userRoutes.get("/me/notification-preferences/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const prefs = await getOrCreateNotificationPrefs(contextUser.id);
  return c.json(formatNotificationPrefsResponse(prefs));
});

// PATCH /api/users/me/notification-preferences/ - Update notification preferences
userRoutes.patch(
  "/me/notification-preferences/",
  zValidator("json", updateNotificationPrefsSchema),
  async (c) => {
    const contextUser = c.get("user");
    if (!contextUser) {
      return c.json({ detail: "Authentication required." }, 401);
    }

    const body = c.req.valid("json");

    // Ensure prefs exist
    await getOrCreateNotificationPrefs(contextUser.id);

    const updateData = {
      ...(body.property_change_email !== undefined && {
        propertyChangeEmail: body.property_change_email,
      }),
      ...(body.state_change_email !== undefined && {
        stateChangeEmail: body.state_change_email,
      }),
      ...(body.comment_email !== undefined && {
        commentEmail: body.comment_email,
      }),
      ...(body.mention_email !== undefined && {
        mentionEmail: body.mention_email,
      }),
      ...(body.issue_completed_email !== undefined && {
        issueCompletedEmail: body.issue_completed_email,
      }),
      updatedAt: new Date(),
    };

    await db
      .update(notificationPreferences)
      .set(updateData)
      .where(eq(notificationPreferences.userId, contextUser.id));

    const prefs = await db.query.notificationPreferences.findFirst({
      where: eq(notificationPreferences.userId, contextUser.id),
    });

    return c.json(formatNotificationPrefsResponse(prefs!));
  }
);

// GET /api/users/me/instance-admin/ - Check if user is instance admin
userRoutes.get("/me/instance-admin/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  // For now, there's no instance admin concept - always return false
  // This can be extended later with an instance_admins table
  return c.json({ is_admin: false });
});

// GET /api/users/last-visited-workspace/ - Get last visited workspace
userRoutes.get("/last-visited-workspace/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  // Find most recent workspace visit
  const visits = await db
    .select({
      workspace: workspaces,
    })
    .from(recentVisits)
    .innerJoin(workspaces, eq(recentVisits.workspaceId, workspaces.id))
    .where(eq(recentVisits.userId, contextUser.id))
    .orderBy(desc(recentVisits.visitedAt))
    .limit(1);

  if (visits.length > 0 && visits[0]) {
    const ws = visits[0].workspace;
    return c.json({
      id: ws.id,
      slug: ws.slug,
      name: ws.name,
    });
  }

  // Fallback: get first workspace user is member of
  const memberships = await db
    .select({
      workspace: workspaces,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, contextUser.id))
    .limit(1);

  if (memberships.length > 0 && memberships[0]) {
    const ws = memberships[0].workspace;
    return c.json({
      id: ws.id,
      slug: ws.slug,
      name: ws.name,
    });
  }

  return c.json({ detail: "No workspace found." }, 404);
});

// Email management endpoints

// GET /api/users/me/email/ - Get user emails
userRoutes.get("/me/email/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, contextUser.id),
  });

  if (!user) {
    return c.json({ detail: "User not found." }, 404);
  }

  // Currently we only support one email per user
  return c.json([
    {
      id: user.id,
      email: user.email,
      is_primary: true,
      is_verified: user.emailVerified ?? false,
    },
  ]);
});

// POST /api/users/me/email/ - Add email (not supported with single email)
userRoutes.post("/me/email/", zValidator("json", addEmailSchema), async (c) => {
  // Multiple emails not currently supported
  return c.json(
    { detail: "Multiple emails are not currently supported." },
    400
  );
});

// DELETE /api/users/me/email/:emailId/ - Remove email (not supported)
userRoutes.delete("/me/email/:emailId/", async (c) => {
  // Cannot delete primary email
  return c.json({ detail: "Cannot delete primary email." }, 400);
});

// POST /api/users/me/email/:emailId/set-primary/ - Set primary email (not needed with single email)
userRoutes.post("/me/email/:emailId/set-primary/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const emailId = c.req.param("emailId");

  // Verify this is the user's email
  if (emailId !== contextUser.id) {
    return c.json({ detail: "Email not found." }, 404);
  }

  return c.json({ detail: "Email is already primary." });
});

export { userRoutes };

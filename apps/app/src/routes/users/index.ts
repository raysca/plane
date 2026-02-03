import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc, and, inArray, sql, asc } from "drizzle-orm";
import { db } from "../../db";
import {
  users,
  accounts,
  userProfiles,
} from "../../db/schema/user";
import {
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  recentVisits,
} from "../../db/schema/workspace";
import { projects, projectMembers } from "../../db/schema/project";
import { issues, issueActivities } from "../../db/schema/issue";
import { notificationPreferences } from "../../db/schema/notification";
import { authMiddleware } from "../../middleware/auth";
import type { Variables } from "../../app";

const userRoutes = new Hono<{ Variables: Variables }>();

// Apply auth middleware to all user routes
userRoutes.use("*", authMiddleware);

// Helper to format user for API response (snake_case)
function formatUserResponse(
  user: typeof users.$inferSelect,
  profile?: typeof userProfiles.$inferSelect
) {
  return {
    id: user.id,
    email: user.email,
    first_name: user.firstName ?? "",
    last_name: user.lastName ?? "",
    username: user.username ?? "",
    display_name: user.displayName ?? user.name ?? "",
    avatar: user.avatar ?? user.image ?? "",
    avatar_url: user.avatar ?? user.image ?? "",
    cover_image: user.coverImage ?? "",
    cover_image_url: user.coverImage ?? "",
    date_joined: user.createdAt?.toISOString() ?? null,
    is_onboarded: profile?.isOnboarded ?? false,
    is_active: user.isActive ?? true,
    is_bot: false,
    is_email_verified: user.emailVerified ?? false,
    is_password_autoset: user.isPasswordAutoset ?? false,
    is_tour_completed: profile?.isTourCompleted ?? false,
    user_timezone: profile?.timezone ?? "UTC",
    mobile_number: null,
    last_login_medium: "",
    onboarding_step: profile?.onboardingStep ?? {},
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
    role: profile.role ?? "",
    use_case: profile.useCase ?? "",
    last_workspace_id: profile.lastWorkspaceId ?? null,
    onboarding_step: profile.onboardingStep ?? {
      profile_complete: false,
      workspace_create: false,
      workspace_invite: false,
      workspace_join: false,
    },
    is_onboarded: profile.isOnboarded ?? false,
    is_tour_completed: profile.isTourCompleted ?? false,
    billing_address_country: profile.billingAddressCountry ?? "INDIA",
    billing_address: profile.billingAddress ?? null,
    company_name: profile.companyName ?? "",
    has_marketing_email_consent: profile.hasMarketingEmailConsent ?? false,
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
  avatar_url: z.string().url().optional().nullable(),
  cover_image: z.string().url().optional().nullable(),
  is_onboarded: z.boolean().optional(),
  is_tour_completed: z.boolean().optional(),
  is_active: z.boolean().optional(),
  onboarding_step: z.object({
    profile_complete: z.boolean().optional(),
    workspace_create: z.boolean().optional(),
    workspace_invite: z.boolean().optional(),
    workspace_join: z.boolean().optional(),
  }).optional(),
});

const updateProfileSchema = z.object({
  timezone: z.string().max(50).optional(),
  date_format: z.string().max(20).optional(),
  time_format: z.enum(["12h", "24h"]).optional(),
  theme: z.string().max(50).optional(),
  language: z.string().max(10).optional(),
  // Onboarding fields
  role: z.string().max(300).optional(),
  use_case: z.string().optional(),
  last_workspace_id: z.string().optional().nullable(),
  onboarding_step: z.object({
    profile_complete: z.boolean().optional(),
    workspace_create: z.boolean().optional(),
    workspace_invite: z.boolean().optional(),
    workspace_join: z.boolean().optional(),
  }).optional(),
  is_onboarded: z.boolean().optional(),
  is_tour_completed: z.boolean().optional(),
  billing_address_country: z.string().max(100).optional(),
  billing_address: z.any().optional(),
  company_name: z.string().max(255).optional(),
  has_marketing_email_consent: z.boolean().optional(),
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
    with: {
      profile: true,
    },
  });

  if (!user) {
    return c.json({ detail: "User not found." }, 404);
  }

  return c.json(formatUserResponse(user, user.profile));
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
    ...((body.avatar !== undefined || body.avatar_url !== undefined) && { avatar: body.avatar_url ?? body.avatar }),
    ...(body.cover_image !== undefined && { coverImage: body.cover_image }),
    ...(body.is_active !== undefined && { isActive: body.is_active }),
    updatedAt: new Date(),
  };

  if (Object.keys(updateData).length > 1) { // > 1 because updatedAt is always there
    await db.update(users).set(updateData).where(eq(users.id, contextUser.id));
  }

  // Handle profile updates (onboarding fields)
  const profileUpdateData: Partial<typeof userProfiles.$inferInsert> = {
    ...(body.is_onboarded !== undefined && { isOnboarded: body.is_onboarded }),
    ...(body.is_tour_completed !== undefined && { isTourCompleted: body.is_tour_completed }),
  };

  if (body.onboarding_step || Object.keys(profileUpdateData).length > 0) {
    const profile = await getOrCreateProfile(contextUser.id);

    if (body.onboarding_step) {
      const currentStep = (profile.onboardingStep as any) || {
        profile_complete: false,
        workspace_create: false,
        workspace_invite: false,
        workspace_join: false
      };

      profileUpdateData.onboardingStep = {
        ...currentStep,
        ...body.onboarding_step
      };
    }

    await db.update(userProfiles).set({
      ...profileUpdateData,
      updatedAt: new Date(),
    }).where(eq(userProfiles.userId, contextUser.id));
  }

  const updatedUser = await db.query.users.findFirst({
    where: eq(users.id, contextUser.id),
    with: {
      profile: true,
    },
  });

  if (!updatedUser) {
    return c.json({ detail: "User not found." }, 404);
  }

  return c.json(formatUserResponse(updatedUser, updatedUser.profile));
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
  const existingProfile = await getOrCreateProfile(contextUser.id);

  const updateData: Record<string, unknown> = {
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    ...(body.date_format !== undefined && { dateFormat: body.date_format }),
    ...(body.time_format !== undefined && { timeFormat: body.time_format }),
    ...(body.theme !== undefined && { theme: body.theme }),
    ...(body.language !== undefined && { language: body.language }),
    ...(body.role !== undefined && { role: body.role }),
    ...(body.use_case !== undefined && { useCase: body.use_case }),
    ...(body.last_workspace_id !== undefined && { lastWorkspaceId: body.last_workspace_id }),
    ...(body.is_onboarded !== undefined && { isOnboarded: body.is_onboarded }),
    ...(body.is_tour_completed !== undefined && { isTourCompleted: body.is_tour_completed }),
    ...(body.billing_address_country !== undefined && { billingAddressCountry: body.billing_address_country }),
    ...(body.billing_address !== undefined && { billingAddress: body.billing_address }),
    ...(body.company_name !== undefined && { companyName: body.company_name }),
    ...(body.has_marketing_email_consent !== undefined && { hasMarketingEmailConsent: body.has_marketing_email_consent }),
    updatedAt: new Date(),
  };

  // Handle onboarding_step merge (partial update)
  if (body.onboarding_step) {
    const currentStep = (existingProfile.onboardingStep as Record<string, boolean>) || {
      profile_complete: false,
      workspace_create: false,
      workspace_invite: false,
      workspace_join: false,
    };
    updateData.onboardingStep = {
      ...currentStep,
      ...body.onboarding_step,
    };
  }

  await db.update(userProfiles).set(updateData).where(eq(userProfiles.userId, contextUser.id));

  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, contextUser.id),
  });

  return c.json(formatProfileResponse(profile!));
});

// GET /api/users/me/settings/ - Get user settings (matching Django's UserMeSettingsSerializer)
userRoutes.get("/me/settings/", async (c) => {
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

  const profile = await getOrCreateProfile(contextUser.id);

  // Count pending workspace invitations
  const inviteCount = await db.select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.email, user.email))
    .then((rows) => rows.length);

  // Get last workspace info
  const lastWorkspaceId = profile.lastWorkspaceId;
  let lastWorkspace = null;
  if (lastWorkspaceId) {
    // Verify user is still an active member of this workspace
    const membership = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, lastWorkspaceId),
        eq(workspaceMembers.userId, contextUser.id),
        eq(workspaceMembers.isActive, true)
      ),
    });
    if (membership) {
      lastWorkspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, lastWorkspaceId),
      });
    }
  }

  // Get fallback workspace (first workspace user is a member of)
  let fallbackWorkspace = null;
  if (!lastWorkspace) {
    const firstMembership = await db.select()
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(
        eq(workspaceMembers.userId, contextUser.id),
        eq(workspaceMembers.isActive, true)
      ))
      .orderBy(asc(workspaces.createdAt))
      .limit(1);

    if (firstMembership.length > 0) {
      fallbackWorkspace = firstMembership[0]!.workspaces;
    }
  }

  return c.json({
    id: user.id,
    email: user.email,
    workspace: {
      last_workspace_id: lastWorkspace?.id ?? null,
      last_workspace_slug: lastWorkspace?.slug ?? null,
      last_workspace_name: lastWorkspace?.name ?? null,
      last_workspace_logo: lastWorkspace?.logo ?? null,
      fallback_workspace_id: lastWorkspace?.id ?? fallbackWorkspace?.id ?? null,
      fallback_workspace_slug: lastWorkspace?.slug ?? fallbackWorkspace?.slug ?? null,
      invites: inviteCount,
    },
  });
});

// PATCH /api/users/me/settings/ - Update user settings (same as profile)
userRoutes.patch("/me/settings/", zValidator("json", updateProfileSchema), async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const body = c.req.valid("json");
  const existingProfile = await getOrCreateProfile(contextUser.id);

  const updateData: Record<string, unknown> = {
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    ...(body.date_format !== undefined && { dateFormat: body.date_format }),
    ...(body.time_format !== undefined && { timeFormat: body.time_format }),
    ...(body.theme !== undefined && { theme: body.theme }),
    ...(body.language !== undefined && { language: body.language }),
    ...(body.role !== undefined && { role: body.role }),
    ...(body.use_case !== undefined && { useCase: body.use_case }),
    ...(body.last_workspace_id !== undefined && { lastWorkspaceId: body.last_workspace_id }),
    ...(body.is_onboarded !== undefined && { isOnboarded: body.is_onboarded }),
    ...(body.is_tour_completed !== undefined && { isTourCompleted: body.is_tour_completed }),
    ...(body.billing_address_country !== undefined && { billingAddressCountry: body.billing_address_country }),
    ...(body.billing_address !== undefined && { billingAddress: body.billing_address }),
    ...(body.company_name !== undefined && { companyName: body.company_name }),
    ...(body.has_marketing_email_consent !== undefined && { hasMarketingEmailConsent: body.has_marketing_email_consent }),
    updatedAt: new Date(),
  };

  if (body.onboarding_step) {
    const currentStep = (existingProfile.onboardingStep as Record<string, boolean>) || {
      profile_complete: false,
      workspace_create: false,
      workspace_invite: false,
      workspace_join: false,
    };
    updateData.onboardingStep = {
      ...currentStep,
      ...body.onboarding_step,
    };
  }

  await db.update(userProfiles).set(updateData).where(eq(userProfiles.userId, contextUser.id));

  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, contextUser.id),
  });

  return c.json(formatProfileResponse(profile!));
});

// PATCH /api/users/me/onboard/ - Update onboarding status
userRoutes.patch(
  "/me/onboard/",
  zValidator("json", z.object({ is_onboarded: z.boolean().default(true) })),
  async (c) => {
    const contextUser = c.get("user");
    if (!contextUser) {
      return c.json({ detail: "Authentication required." }, 401);
    }

    const { is_onboarded } = c.req.valid("json");
    await getOrCreateProfile(contextUser.id);

    await db.update(userProfiles).set({
      isOnboarded: is_onboarded,
      updatedAt: new Date(),
    }).where(eq(userProfiles.userId, contextUser.id));

    return c.json({ message: "Updated successfully" }, 200);
  }
);

// PATCH /api/users/me/tour-completed/ - Update tour status
userRoutes.patch(
  "/me/tour-completed/",
  zValidator("json", z.object({ is_tour_completed: z.boolean().default(true) })),
  async (c) => {
    const contextUser = c.get("user");
    if (!contextUser) {
      return c.json({ detail: "Authentication required." }, 401);
    }

    const { is_tour_completed } = c.req.valid("json");
    await getOrCreateProfile(contextUser.id);

    await db.update(userProfiles).set({
      isTourCompleted: is_tour_completed,
      updatedAt: new Date(),
    }).where(eq(userProfiles.userId, contextUser.id));

    return c.json({ message: "Updated successfully" }, 200);
  }
);

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

// GET /api/users/me/workspaces/ - Get user's workspaces (matching Django's UserWorkSpacesEndpoint)
userRoutes.get("/me/workspaces/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  // Get memberships with workspace data and member count
  const memberships = await db
    .select({
      membership: workspaceMembers,
      workspace: workspaces,
      memberCount: sql<number>`(SELECT COUNT(*) FROM workspace_members wm WHERE wm.workspace_id = ${workspaces.id} AND wm.is_active = 1)`,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(
      eq(workspaceMembers.userId, contextUser.id),
      eq(workspaceMembers.isActive, true)
    ));

  const workspaceList = memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    logo: m.workspace.logo ?? "",
    logo_url: m.workspace.logo ?? null,
    owner: m.workspace.ownerId,
    organization_size: m.workspace.organizationSize ?? "",
    timezone: (m.workspace as any).timezone ?? "UTC",
    url: `/${m.workspace.slug}/`,
    role: m.membership.role,
    total_members: Number(m.memberCount),
    created_at: m.workspace.createdAt?.toISOString() ?? null,
    updated_at: m.workspace.updatedAt?.toISOString() ?? null,
    created_by: null,
    updated_by: null,
  }));

  return c.json(workspaceList);
});

// GET /api/users/me/activities/ - Get user issue activities (cursor-paginated)
userRoutes.get("/me/activities/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const perPage = Math.min(parseInt(c.req.query("per_page") || "100"), 1000);
  const cursor = c.req.query("cursor") || `${perPage}:0:0`;
  const [, offsetStr] = cursor.split(":");
  const offset = parseInt(offsetStr || "0");

  // Count total activities
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(issueActivities)
    .where(eq(issueActivities.actorId, contextUser.id));

  // Fetch activities with related data
  const activities = await db
    .select({
      activity: issueActivities,
      actor: users,
      project: projects,
      workspace: workspaces,
      issue: issues,
    })
    .from(issueActivities)
    .leftJoin(users, eq(issueActivities.actorId, users.id))
    .leftJoin(projects, eq(issueActivities.projectId, projects.id))
    .leftJoin(workspaces, eq(issueActivities.workspaceId, workspaces.id))
    .leftJoin(issues, eq(issueActivities.issueId, issues.id))
    .where(eq(issueActivities.actorId, contextUser.id))
    .orderBy(desc(issueActivities.createdAt))
    .limit(perPage)
    .offset(offset);

  const totalPages = Math.ceil(total / perPage);
  const hasNext = offset + perPage < total;
  const hasPrev = offset > 0;
  const nextOffset = offset + perPage;
  const prevOffset = Math.max(0, offset - perPage);

  const results = activities.map((a) => ({
    id: a.activity.id,
    issue: a.activity.issueId,
    field: a.activity.field ?? null,
    old_value: a.activity.oldValue ?? null,
    new_value: a.activity.newValue ?? null,
    verb: a.activity.verb,
    old_identifier: a.activity.oldIdentifier ?? null,
    new_identifier: a.activity.newIdentifier ?? null,
    epoch: a.activity.epochTimestamp ?? null,
    project: a.activity.projectId,
    workspace: a.activity.workspaceId,
    actor: a.activity.actorId,
    created_at: a.activity.createdAt?.toISOString() ?? null,
    updated_at: a.activity.createdAt?.toISOString() ?? null,
    actor_detail: a.actor
      ? {
          id: a.actor.id,
          display_name: a.actor.displayName ?? a.actor.name ?? "",
          first_name: a.actor.name ?? "",
          avatar: a.actor.avatar ?? "",
        }
      : null,
    issue_detail: a.issue
      ? {
          id: a.issue.id,
          name: a.issue.name,
          sequence_id: a.issue.sequenceId ?? null,
        }
      : null,
    project_detail: a.project
      ? {
          id: a.project.id,
          name: a.project.name,
          identifier: a.project.identifier,
          emoji: a.project.emoji ?? null,
          icon_prop: a.project.iconProp ?? null,
          logo_props: a.project.logoProps ?? {},
          cover_image: a.project.coverImage ?? null,
          description: a.project.description ?? "",
        }
      : null,
    workspace_detail: a.workspace
      ? {
          id: a.workspace.id,
          name: a.workspace.name,
          slug: a.workspace.slug,
        }
      : null,
  }));

  return c.json({
    grouped_by: null,
    sub_grouped_by: null,
    total_count: total,
    next_cursor: `${perPage}:${nextOffset}:0`,
    prev_cursor: `${perPage}:${prevOffset}:1`,
    next_page_results: hasNext,
    prev_page_results: hasPrev,
    count: results.length,
    total_pages: totalPages,
    total_results: total,
    extra_stats: null,
    results,
  });
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

// =====================================================
// User Workspace Invitations
// =====================================================

// GET /api/users/me/workspaces/invitations/ - List pending workspace invitations for the current user
userRoutes.get("/me/workspaces/invitations/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, contextUser.id),
  });

  if (!dbUser) {
    return c.json({ detail: "User not found." }, 404);
  }

  // Find all pending invitations for this user's email
  const invitations = await db
    .select({
      invitation: workspaceInvitations,
      workspace: workspaces,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
    .where(eq(workspaceInvitations.email, dbUser.email))
    .orderBy(desc(workspaceInvitations.createdAt));

  const results = invitations.map((row) => ({
    id: row.invitation.id,
    email: row.invitation.email,
    role: row.invitation.role,
    message: row.invitation.message ?? "",
    accepted: row.invitation.accepted,
    responded_at: row.invitation.respondedAt?.toISOString() ?? null,
    created_by_id: row.invitation.createdById,
    created_at: row.invitation.createdAt?.toISOString() ?? null,
    updated_at: row.invitation.updatedAt?.toISOString() ?? null,
    workspace: {
      id: row.workspace.id,
      name: row.workspace.name,
      slug: row.workspace.slug,
      logo: row.workspace.logo ?? "",
    },
  }));

  return c.json(results);
});

// POST /api/users/me/workspaces/invitations/ - Accept multiple workspace invitations
userRoutes.post(
  "/me/workspaces/invitations/",
  zValidator("json", z.object({
    invitations: z.array(z.string()).min(1),
  })),
  async (c) => {
    const contextUser = c.get("user");
    if (!contextUser) {
      return c.json({ detail: "Authentication required." }, 401);
    }

    const dbUser = await db.query.users.findFirst({
      where: eq(users.id, contextUser.id),
    });

    if (!dbUser) {
      return c.json({ detail: "User not found." }, 404);
    }

    const { invitations: invitationIds } = c.req.valid("json");

    // Find all matching invitations for this user's email
    const matchingInvitations = await db
      .select({
        invitation: workspaceInvitations,
        workspace: workspaces,
      })
      .from(workspaceInvitations)
      .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
      .where(and(
        inArray(workspaceInvitations.id, invitationIds),
        eq(workspaceInvitations.email, dbUser.email)
      ))
      .orderBy(desc(workspaceInvitations.createdAt));

    for (const row of matchingInvitations) {
      const invitation = row.invitation;

      // Check if already a member (possibly deactivated)
      const existingMember = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, invitation.workspaceId),
          eq(workspaceMembers.userId, contextUser.id)
        ),
      });

      if (existingMember) {
        // Reactivate existing membership with the invitation's role
        await db.update(workspaceMembers).set({
          isActive: true,
          role: invitation.role,
          updatedAt: new Date(),
        }).where(eq(workspaceMembers.id, existingMember.id));
      } else {
        // Create new membership
        await db.insert(workspaceMembers).values({
          workspaceId: invitation.workspaceId,
          userId: contextUser.id,
          role: invitation.role,
        });
      }
    }

    // Delete accepted invitations
    if (matchingInvitations.length > 0) {
      const idsToDelete = matchingInvitations.map((r) => r.invitation.id);
      await db.delete(workspaceInvitations).where(
        inArray(workspaceInvitations.id, idsToDelete)
      );
    }

    return new Response(null, { status: 204 });
  }
);

// GET /api/users/me/workspaces/:slug/project-roles/ - Get user's role in each project within a workspace
userRoutes.get("/me/workspaces/:slug/project-roles/", async (c) => {
  const contextUser = c.get("user");
  if (!contextUser) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const slug = c.req.param("slug");

  // Verify user is an active workspace member
  const workspaceMembership = await db
    .select({ workspaceId: workspaces.id })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.slug, slug),
        eq(workspaceMembers.userId, contextUser.id),
        eq(workspaceMembers.isActive, true)
      )
    )
    .limit(1);

  if (workspaceMembership.length === 0) {
    return c.json({ detail: "You are not a member of this workspace." }, 403);
  }

  const workspaceId = workspaceMembership[0]!.workspaceId;

  // Get all active project memberships for this user in this workspace
  const memberships = await db
    .select({
      projectId: projectMembers.projectId,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projectMembers.memberId, contextUser.id),
        eq(projectMembers.isActive, true),
        eq(projects.workspaceId, workspaceId)
      )
    );

  // Build {project_id: role} dictionary
  const projectRoles: Record<string, number> = {};
  for (const m of memberships) {
    projectRoles[m.projectId] = m.role;
  }

  return c.json(projectRoles);
});

export { userRoutes };

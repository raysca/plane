import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import {
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  workspaceLabels,
  quickLinks,
  recentVisits,
  stickies,
  favorites,
  workspaceUserPreferences,
} from "../../db/schema/workspace";
import { authMiddleware, ROLES } from "../../middleware/auth";
import {
  workspaceMiddleware,
  requireWorkspaceAdmin,
  requireWorkspaceMember,
  requireWorkspaceOwner,
} from "../../middleware/workspace";
import type { Variables } from "../../app";
import { generateSlug, isValidSlug } from "../../lib/utils";
import { seedWorkspace } from "../../lib/workspace-seeder";
import { userProfiles } from "../../db/schema/user";
import { notifications } from "../../db/schema/notification";
import { issues, issueAssignees, issueActivities, issueSubscribers, issueLabels, issueLinks, issueAttachments, issueReactions } from "../../db/schema/issue";
import { fileAssets } from "../../db/schema/asset";
import { projects, projectMembers, states, labels, estimates, estimatePoints } from "../../db/schema/project";
import { pages } from "../../db/schema/page";
import { cycles, cycleIssues, cycleFavorites } from "../../db/schema/cycle";
import { modules, moduleIssues, moduleMembers, moduleFavorites, moduleLinks } from "../../db/schema/module";
import { views, viewFavorites } from "../../db/schema/view";
import { intakeIssues } from "../../db/schema/intake";
import { webhooks } from "../../db/schema/webhook";
import { createId } from "@paralleldrive/cuid2";
import { sql, not, like, isNull, count, count as countFn, lt, gt, gte, lte, max, or, isNotNull } from "drizzle-orm";
import homePreferenceRoutes from "./home-preference";
import userPropertiesRoutes from "./user-properties";

const workspaceRoutes = new Hono<{ Variables: Variables }>();

// Apply auth middleware globally
workspaceRoutes.use("*", authMiddleware);

// --- Validation Schemas ---

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(3).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  organization_size: z.string().max(20).optional(),
  logo: z.string().url().optional().nullable(),
  timezone: z.string().max(255).optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  logo: z.string().url().optional().nullable(),
  organization_size: z.string().max(20).optional(),
  timezone: z.string().max(255).optional(),
});

const addMemberSchema = z.object({
  members: z.array(z.object({
    member_id: z.string().min(1),
    role: z.number().int().refine((v) => [5, 10, 15, 20].includes(v)),
  })).min(1),
});

const updateMemberSchema = z.object({
  role: z.number().int().refine((v) => [5, 10, 15, 20].includes(v)),
});

const createInvitationSchema = z.object({
  emails: z.array(z.object({
    email: z.email(),
    role: z.number().int().refine((v) => [5, 10, 15, 20].includes(v)),
  })).min(1),
  message: z.string().max(500).optional(),
});

const updateInvitationSchema = z.object({
  role: z.number().int().refine((v) => [5, 10, 15, 20].includes(v)).optional(),
});

const joinInvitationSchema = z.object({
  email: z.email(),
  accepted: z.boolean().default(false),
});

const createLabelSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: z.string().max(255).optional(),
  sort_order: z.number().optional(),
});

const updateLabelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: z.string().max(255).optional().nullable(),
  sort_order: z.number().optional(),
});

// --- Helper formatters ---

function formatWorkspace(ws: typeof workspaces.$inferSelect) {
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    logo: ws.logo ?? "",
    logo_url: ws.logo ?? null,
    owner: ws.ownerId,
    organization_size: ws.organizationSize ?? "",
    timezone: ws.timezone ?? "UTC",
    url: `/${ws.slug}/`,
    created_at: ws.createdAt?.toISOString() ?? null,
    updated_at: ws.updatedAt?.toISOString() ?? null,
    created_by: null,
    updated_by: null,
  };
}

function formatMember(
  m: typeof workspaceMembers.$inferSelect,
  user: typeof users.$inferSelect
) {
  return {
    id: m.id,
    member: {
      id: user.id,
      email: user.email,
      first_name: user.firstName ?? "",
      last_name: user.lastName ?? "",
      display_name: user.displayName ?? user.name ?? "",
      avatar: user.avatar ?? user.image ?? "",
      avatar_url: user.avatar ?? user.image ?? "",
      is_bot: false,
    },
    role: m.role,
    company_role: m.companyRole ?? null,
    view_props: m.viewProps ?? {},
    default_props: m.defaultProps ?? {},
    issue_props: m.issueProps ?? {},
    is_active: m.isActive ?? true,
    joining_date: m.createdAt?.toISOString() ?? null,
    created_at: m.createdAt?.toISOString() ?? null,
    updated_at: m.updatedAt?.toISOString() ?? null,
  };
}

// Format for the /workspace-members/me/ endpoint (IWorkspaceMemberMe)
function formatMemberMe(
  m: typeof workspaceMembers.$inferSelect,
  draftIssueCount: number = 0
) {
  return {
    id: m.id,
    member: m.userId,
    workspace: m.workspaceId,
    role: m.role,
    company_role: m.companyRole ?? null,
    view_props: m.viewProps ?? {},
    default_props: m.defaultProps ?? {},
    issue_props: m.issueProps ?? {},
    is_active: m.isActive ?? true,
    draft_issue_count: draftIssueCount,
    created_at: m.createdAt?.toISOString() ?? null,
    updated_at: m.updatedAt?.toISOString() ?? null,
    created_by: null,
    updated_by: null,
  };
}

function formatInvitation(inv: typeof workspaceInvitations.$inferSelect) {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    message: inv.message ?? "",
    accepted: inv.accepted,
    responded_at: inv.respondedAt?.toISOString() ?? null,
    created_by_id: inv.createdById,
    created_at: inv.createdAt?.toISOString() ?? null,
    updated_at: inv.updatedAt?.toISOString() ?? null,
  };
}

function formatLabel(label: typeof workspaceLabels.$inferSelect) {
  return {
    id: label.id,
    workspace_id: label.workspaceId,
    name: label.name,
    color: label.color,
    description: label.description ?? "",
    sort_order: label.sortOrder ?? 65535,
    created_by_id: label.createdById,
    created_at: label.createdAt?.toISOString() ?? null,
    updated_at: label.updatedAt?.toISOString() ?? null,
  };
}

// =====================================================
// 3.1 Workspace CRUD
// =====================================================

// GET /api/workspaces/ - List workspaces for current user
workspaceRoutes.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const memberships = await db
    .select({
      membership: workspaceMembers,
      workspace: workspaces,
      memberCount: sql<number>`(SELECT COUNT(*) FROM ${workspaceMembers} WHERE ${workspaceMembers.workspaceId} = ${workspaces.id} AND ${workspaceMembers.isActive} = 1)`,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true)
    ));

  const results = memberships.map((m) => ({
    ...formatWorkspace(m.workspace),
    role: m.membership.role,
    total_members: Number(m.memberCount),
  }));

  return c.json(results);
});

// POST /api/workspaces/ - Create workspace
workspaceRoutes.post("/", zValidator("json", createWorkspaceSchema), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const body = c.req.valid("json");

  // Generate or validate slug
  let slug = body.slug || generateSlug(body.name);

  if (!isValidSlug(slug)) {
    return c.json({ slug: ["Invalid slug format. Use lowercase letters, numbers, and hyphens."] }, 400);
  }

  // Validate name (no URLs)
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  if (urlRegex.test(body.name)) {
    return c.json({ name: ["Name cannot contain a URL"] }, 400);
  }

  // Check slug uniqueness
  const existing = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, slug),
  });

  if (existing) {
    return c.json({ slug: ["Workspace with this slug already exists."] }, 400);
  }

  // Create workspace
  const result = await db.insert(workspaces).values({
    name: body.name,
    slug,
    ownerId: user.id,
    organizationSize: body.organization_size,
    logo: body.logo,
    timezone: body.timezone,
  }).returning();

  const workspace = result[0];
  if (!workspace) throw new Error("Failed to create workspace");

  // Add creator as admin member
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: ROLES.ADMIN,
  });

  // Seed workspace
  await seedWorkspace(workspace.id, user.id);

  console.log(`[Workspace] Created workspace ${workspace.slug}`);

  return c.json(formatWorkspace(workspace), 201);
});

// =====================================================
// Invitation Join Routes (NO workspace membership required)
// These must be registered BEFORE workspaceMiddleware
// because the user may not be a workspace member yet.
// =====================================================

// GET /api/workspaces/:slug/invitations/:id/join/ - Get invitation details (for invitation page)
workspaceRoutes.get("/:slug/invitations/:id/join/", async (c) => {
  const slug = c.req.param("slug");
  const invitationId = c.req.param("id");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, slug),
  });

  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const invitation = await db.query.workspaceInvitations.findFirst({
    where: and(
      eq(workspaceInvitations.id, invitationId),
      eq(workspaceInvitations.workspaceId, workspace.id)
    ),
  });

  if (!invitation) {
    return c.json({ detail: "Invitation not found." }, 404);
  }

  return c.json({
    ...formatInvitation(invitation),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logo: workspace.logo ?? "",
    },
  });
});

// POST /api/workspaces/:slug/invitations/:id/join/ - Accept/reject invitation
workspaceRoutes.post("/:slug/invitations/:id/join/", zValidator("json", joinInvitationSchema), async (c) => {
  const slug = c.req.param("slug");
  const invitationId = c.req.param("id");
  const body = c.req.valid("json");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.slug, slug),
  });

  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const invitation = await db.query.workspaceInvitations.findFirst({
    where: and(
      eq(workspaceInvitations.id, invitationId),
      eq(workspaceInvitations.workspaceId, workspace.id)
    ),
  });

  if (!invitation) {
    return c.json({ detail: "Invitation not found." }, 404);
  }

  // Check the email matches the invitation
  if (!body.email || invitation.email !== body.email) {
    return c.json(
      { error: "You do not have permission to join the workspace" },
      403
    );
  }

  // Verify the authenticated user's email matches the invitation email
  const user = c.get("user");
  if (user && user.email !== invitation.email) {
    return c.json(
      { error: "You can only respond to invitations sent to your email address" },
      403
    );
  }

  // If already responded then return error
  if (invitation.respondedAt) {
    return c.json(
      { error: "You have already responded to the invitation request" },
      400
    );
  }

  // Mark invitation as responded
  await db.update(workspaceInvitations).set({
    accepted: body.accepted,
    respondedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(workspaceInvitations.id, invitationId));

  if (body.accepted) {
    // Check if the user has an account
    const invitedUser = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });

    if (invitedUser) {
      // Check if already a member (possibly deactivated)
      const existingMember = await db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.userId, invitedUser.id)
        ),
      });

      if (existingMember) {
        // Reactivate existing membership
        await db.update(workspaceMembers).set({
          isActive: true,
          role: invitation.role,
          updatedAt: new Date(),
        }).where(eq(workspaceMembers.id, existingMember.id));
      } else {
        // Create new membership
        await db.insert(workspaceMembers).values({
          workspaceId: workspace.id,
          userId: invitedUser.id,
          role: invitation.role,
        });
      }

      // Set the user's last workspace to the accepted workspace
      await db.update(userProfiles).set({
        lastWorkspaceId: workspace.id,
      }).where(eq(userProfiles.userId, invitedUser.id)).catch(() => {});

      // Delete the invitation after successful join
      await db.delete(workspaceInvitations).where(eq(workspaceInvitations.id, invitationId));
    }

    return c.json({ message: "Workspace Invitation Accepted" });
  }

  // Invitation rejected
  return c.json({ message: "Workspace Invitation was not accepted" });
});

// Apply workspace middleware for slug-based routes
workspaceRoutes.use("/:slug/*", workspaceMiddleware);
workspaceRoutes.use("/:slug", workspaceMiddleware);

// GET /api/workspaces/:slug/ - Get workspace
workspaceRoutes.get("/:slug/", async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  return c.json(formatWorkspace(workspace as typeof workspaces.$inferSelect));
});

// PATCH /api/workspaces/:slug/ - Update workspace
workspaceRoutes.patch("/:slug/", requireWorkspaceAdmin, zValidator("json", updateWorkspaceSchema), async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const body = c.req.valid("json");

  const updateData = {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.logo !== undefined && { logo: body.logo }),
    ...(body.organization_size !== undefined && { organizationSize: body.organization_size }),
    ...(body.timezone !== undefined && { timezone: body.timezone }),
    updatedAt: new Date(),
  };

  await db.update(workspaces).set(updateData).where(eq(workspaces.id, workspace.id));

  const updated = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspace.id),
  });

  return c.json(formatWorkspace(updated!));
});

// DELETE /api/workspaces/:slug/ - Delete workspace
workspaceRoutes.delete("/:slug/", requireWorkspaceOwner, async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  // Update lastWorkspaceId for users who have this as their last workspace
  await db.update(userProfiles)
    .set({ lastWorkspaceId: null })
    .where(eq(userProfiles.lastWorkspaceId, workspace.id));

  await db.delete(workspaces).where(eq(workspaces.id, workspace.id));

  console.log(`[Workspace] Deleted workspace ${workspace.slug}`);

  return new Response(null, { status: 204 });
});

// =====================================================
// 3.2 Workspace Members
// =====================================================

// GET /api/workspaces/:slug/members/ - List active members
workspaceRoutes.get("/:slug/members/", async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const members = await db
    .select({
      membership: workspaceMembers,
      user: users,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.isActive, true)
    ));

  const results = members.map((m) => formatMember(m.membership, m.user));

  return c.json(results);
});

// POST /api/workspaces/:slug/members/ - Add members
workspaceRoutes.post("/:slug/members/", requireWorkspaceAdmin, zValidator("json", addMemberSchema), async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const { members } = c.req.valid("json");
  const added = [];

  for (const member of members) {
    // Check if user exists
    const memberUser = await db.query.users.findFirst({
      where: eq(users.id, member.member_id),
    });

    if (!memberUser) continue;

    // Check if already a member
    const existing = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspace.id),
        eq(workspaceMembers.userId, member.member_id)
      ),
    });

    if (existing) continue;

    const memberResult = await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: member.member_id,
      role: member.role,
    }).returning();

    added.push(formatMember(memberResult[0]!, memberUser));
  }

  return c.json(added, 201);
});

// GET /api/workspaces/:slug/members/me/ - Current member info
workspaceRoutes.get("/:slug/members/me/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");

  if (!workspace || !user) {
    return c.json({ detail: "Not found." }, 404);
  }

  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  if (!dbUser) return c.json({ detail: "User not found." }, 404);

  const dbMembership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true)
    ),
  });

  if (!dbMembership) return c.json({ detail: "Member not found." }, 404);

  return c.json(formatMember(dbMembership, dbUser));
});

// PATCH /api/workspaces/:slug/members/:memberId/ - Update member role
workspaceRoutes.patch("/:slug/members/:memberId/", requireWorkspaceAdmin, zValidator("json", updateMemberSchema), async (c) => {
  const workspace = c.get("workspace");
  const requestingUser = c.get("user");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const memberId = c.req.param("memberId");
  const { role } = c.req.valid("json");

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.id, memberId),
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.isActive, true)
    ),
  });

  if (!membership) {
    return c.json({ detail: "Member not found." }, 404);
  }

  // Cannot update your own role
  if (requestingUser && membership.userId === requestingUser.id) {
    return c.json({ error: "You cannot update your own role" }, 400);
  }

  await db.update(workspaceMembers).set({
    role,
    updatedAt: new Date(),
  }).where(eq(workspaceMembers.id, memberId));

  const updated = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.id, memberId),
  });

  const memberUser = await db.query.users.findFirst({
    where: eq(users.id, updated!.userId),
  });

  return c.json(formatMember(updated!, memberUser!));
});

// DELETE /api/workspaces/:slug/members/:memberId/ - Remove member (soft-delete)
workspaceRoutes.delete("/:slug/members/:memberId/", requireWorkspaceAdmin, async (c) => {
  const workspace = c.get("workspace");
  const requestingUser = c.get("user");
  const requestingMembership = c.get("workspaceMembership");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const memberId = c.req.param("memberId");

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.id, memberId),
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.isActive, true)
    ),
  });

  if (!membership) {
    return c.json({ detail: "Member not found." }, 404);
  }

  // Cannot remove yourself (use leave endpoint)
  if (requestingUser && membership.userId === requestingUser.id) {
    return c.json(
      { error: "You cannot remove yourself from the workspace. Please use leave workspace" },
      400
    );
  }

  // Cannot remove someone with a higher role
  if (requestingMembership && requestingMembership.role < membership.role) {
    return c.json(
      { error: "You cannot remove a user having role higher than you" },
      400
    );
  }

  // Soft-delete: set isActive to false
  await db.update(workspaceMembers).set({
    isActive: false,
    updatedAt: new Date(),
  }).where(eq(workspaceMembers.id, memberId));

  return new Response(null, { status: 204 });
});

// POST /api/workspaces/:slug/members/leave/ - Leave workspace
workspaceRoutes.post("/:slug/members/leave/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true)
    ),
  });

  if (!membership) {
    return c.json({ detail: "Member not found." }, 404);
  }

  // If user is admin, check if they are the sole admin
  if (membership.role === ROLES.ADMIN) {
    const adminCount = await db.select()
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, workspace.id),
        eq(workspaceMembers.role, ROLES.ADMIN),
        eq(workspaceMembers.isActive, true)
      ))
      .then((rows) => rows.length);

    if (adminCount <= 1) {
      return c.json(
        {
          error: "You cannot leave the workspace as you are the only admin of the workspace you will have to either delete the workspace or promote another user to admin."
        },
        400
      );
    }
  }

  // Soft-delete: set isActive to false
  await db.update(workspaceMembers).set({
    isActive: false,
    updatedAt: new Date(),
  }).where(eq(workspaceMembers.id, membership.id));

  return new Response(null, { status: 204 });
});

// GET /api/workspaces/:slug/workspace-members/me/ - Current user's workspace membership (IWorkspaceMemberMe format)
workspaceRoutes.get("/:slug/workspace-members/me/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true)
    ),
  });

  if (!membership) {
    return c.json({ detail: "Workspace member not found." }, 404);
  }

  // Draft issue count - defaults to 0 since draft_issues table doesn't exist yet
  const draftIssueCount = 0;

  return c.json(formatMemberMe(membership, draftIssueCount));
});

// POST /api/workspaces/:slug/workspace-views/ - Update workspace member view props
workspaceRoutes.post("/:slug/workspace-views/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const membership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true)
    ),
  });

  if (!membership) {
    return c.json({ detail: "Workspace member not found." }, 404);
  }

  const body = await c.req.json() as { view_props?: unknown };

  await db.update(workspaceMembers).set({
    viewProps: body.view_props as any,
    updatedAt: new Date(),
  }).where(eq(workspaceMembers.id, membership.id));

  return new Response(null, { status: 204 });
});

// =====================================================
// 3.3 Workspace Invitations
// =====================================================

// GET /api/workspaces/:slug/invitations/ - List invitations
workspaceRoutes.get("/:slug/invitations/", requireWorkspaceAdmin, async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const invitations = await db.query.workspaceInvitations.findMany({
    where: eq(workspaceInvitations.workspaceId, workspace.id),
    orderBy: [desc(workspaceInvitations.createdAt)],
  });

  return c.json(invitations.map(formatInvitation));
});

// POST /api/workspaces/:slug/invitations/ - Create invitations (bulk email invite)
workspaceRoutes.post("/:slug/invitations/", requireWorkspaceAdmin, zValidator("json", createInvitationSchema), async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  const membership = c.get("workspaceMembership");
  if (!workspace || !user || !membership) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  // Check if any invited user has a higher role than the requesting user
  const higherRoleInvites = body.emails.filter((e) => e.role > membership.role);
  if (higherRoleInvites.length > 0) {
    return c.json(
      { error: "You cannot invite a user with higher role" },
      400
    );
  }

  // Check if any users are already members
  const emailList = body.emails.map((e) => e.email.trim().toLowerCase());
  const existingMembers = await db
    .select({ user: users, membership: workspaceMembers })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(and(
      eq(workspaceMembers.workspaceId, workspace.id),
      inArray(users.email, emailList),
      eq(workspaceMembers.isActive, true)
    ));

  if (existingMembers.length > 0) {
    return c.json(
      {
        error: "Some users are already member of workspace",
        workspace_users: existingMembers.map((m) => formatMember(m.membership, m.user)),
      },
      400
    );
  }

  const created = [];

  for (const invite of body.emails) {
    const normalizedEmail = invite.email.trim().toLowerCase();

    // Check if already invited (pending)
    const existingInvite = await db.query.workspaceInvitations.findFirst({
      where: and(
        eq(workspaceInvitations.workspaceId, workspace.id),
        eq(workspaceInvitations.email, normalizedEmail),
      ),
    });

    if (existingInvite && !existingInvite.respondedAt) continue;

    const token = crypto.randomUUID();

    const invResult = await db.insert(workspaceInvitations).values({
      workspaceId: workspace.id,
      email: normalizedEmail,
      role: invite.role,
      token,
      message: body.message,
      createdById: user.id,
    }).returning();

    created.push(formatInvitation(invResult[0]!));

    // TODO: Send invitation email
    // In Django this triggers workspace_invitation.delay() Celery task
    // For now, log the invitation for debugging
    console.log(`[Invitation] Workspace invite sent to ${normalizedEmail} for workspace ${workspace.slug}`);
  }

  return c.json(created, 201);
});

// PATCH /api/workspaces/:slug/invitations/:id/ - Update invitation (e.g., role)
workspaceRoutes.patch("/:slug/invitations/:id/", requireWorkspaceAdmin, zValidator("json", updateInvitationSchema), async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const invitationId = c.req.param("id");
  const body = c.req.valid("json");

  const invitation = await db.query.workspaceInvitations.findFirst({
    where: and(
      eq(workspaceInvitations.id, invitationId),
      eq(workspaceInvitations.workspaceId, workspace.id)
    ),
  });

  if (!invitation) {
    return c.json({ detail: "Invitation not found." }, 404);
  }

  // Cannot update if already accepted or responded
  if (invitation.accepted || invitation.respondedAt) {
    return c.json({ detail: "Cannot update an invitation that has already been responded to." }, 400);
  }

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (body.role !== undefined) {
    updateData.role = body.role;
  }

  await db.update(workspaceInvitations).set(updateData).where(eq(workspaceInvitations.id, invitationId));

  const updated = await db.query.workspaceInvitations.findFirst({
    where: eq(workspaceInvitations.id, invitationId),
  });

  return c.json(formatInvitation(updated!));
});

// DELETE /api/workspaces/:slug/invitations/:id/ - Cancel invitation
workspaceRoutes.delete("/:slug/invitations/:id/", requireWorkspaceAdmin, async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const invitationId = c.req.param("id");

  const invitation = await db.query.workspaceInvitations.findFirst({
    where: and(
      eq(workspaceInvitations.id, invitationId),
      eq(workspaceInvitations.workspaceId, workspace.id)
    ),
  });

  if (!invitation) {
    return c.json({ detail: "Invitation not found." }, 404);
  }

  await db.delete(workspaceInvitations).where(eq(workspaceInvitations.id, invitationId));

  return new Response(null, { status: 204 });
});

// =====================================================
// 3.4 Workspace Labels
// =====================================================

// GET /api/workspaces/:slug/labels/ - List all project labels across workspace
// Django: Returns labels from all projects the user is an active member of (excluding archived projects)
workspaceRoutes.get("/:slug/labels/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  // Get project IDs where user is an active member and project is not archived
  const memberProjects = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projects.workspaceId, workspace.id),
        eq(projectMembers.memberId, user.id),
        eq(projectMembers.isActive, true),
        isNull(projects.archivedAt)
      )
    );

  const projectIds = memberProjects.map((p) => p.projectId);

  if (projectIds.length === 0) {
    return c.json([]);
  }

  const projectLabels = await db.query.labels.findMany({
    where: and(
      eq(labels.workspaceId, workspace.id),
      inArray(labels.projectId, projectIds)
    ),
    orderBy: [asc(labels.sortOrder)],
  });

  return c.json(projectLabels.map((l) => ({
    id: l.id,
    project_id: l.projectId,
    workspace_id: l.workspaceId,
    parent: l.parentId ?? null,
    name: l.name,
    color: l.color,
    sort_order: l.sortOrder ?? 65535,
  })));
});

// POST /api/workspaces/:slug/labels/ - Create label
workspaceRoutes.post("/:slug/labels/", requireWorkspaceMember, zValidator("json", createLabelSchema), async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  const labelResult = await db.insert(workspaceLabels).values({
    workspaceId: workspace.id,
    name: body.name,
    color: body.color ?? "#000000",
    description: body.description,
    sortOrder: body.sort_order ?? 65535,
    createdById: user.id,
  }).returning();

  return c.json(formatLabel(labelResult[0]!), 201);
});

// PATCH /api/workspaces/:slug/labels/:id/ - Update label
workspaceRoutes.patch("/:slug/labels/:id/", requireWorkspaceMember, zValidator("json", updateLabelSchema), async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const labelId = c.req.param("id");
  const body = c.req.valid("json");

  const label = await db.query.workspaceLabels.findFirst({
    where: and(
      eq(workspaceLabels.id, labelId),
      eq(workspaceLabels.workspaceId, workspace.id)
    ),
  });

  if (!label) return c.json({ detail: "Label not found." }, 404);

  const updateData = {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.color !== undefined && { color: body.color }),
    ...(body.description !== undefined && { description: body.description }),
    ...(body.sort_order !== undefined && { sortOrder: body.sort_order }),
    updatedAt: new Date(),
  };

  await db.update(workspaceLabels).set(updateData).where(eq(workspaceLabels.id, labelId));

  const updated = await db.query.workspaceLabels.findFirst({
    where: eq(workspaceLabels.id, labelId),
  });

  return c.json(formatLabel(updated!));
});

// DELETE /api/workspaces/:slug/labels/:id/ - Delete label
workspaceRoutes.delete("/:slug/labels/:id/", requireWorkspaceMember, async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const labelId = c.req.param("id");

  const label = await db.query.workspaceLabels.findFirst({
    where: and(
      eq(workspaceLabels.id, labelId),
      eq(workspaceLabels.workspaceId, workspace.id)
    ),
  });

  if (!label) return c.json({ detail: "Label not found." }, 404);

  await db.delete(workspaceLabels).where(eq(workspaceLabels.id, labelId));

  return new Response(null, { status: 204 });
});

// GET /api/workspaces/:slug/states/ - List workspace states (aggregated from projects)
workspaceRoutes.get("/:slug/states/", async (c) => {
  // Workspace-level states are aggregated from project states
  // This will be implemented when project states are ready
  return c.json([]);
});

// =====================================================
// 3.5 Workspace Preferences (Sidebar)
// =====================================================

// GET /api/workspaces/:slug/sidebar-preferences/ - Get sidebar preferences
const SIDEBAR_PREF_KEYS = ["views", "active_cycles", "analytics", "drafts", "your_work", "archives", "stickies"];
const DEFAULT_PINNED_KEYS = ["drafts", "your_work", "stickies"];

workspaceRoutes.get("/:slug/sidebar-preferences/", async (c) => {
  const user = c.get("user");
  const workspace = c.get("workspace");
  if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

  // Find existing preferences
  const existingPrefs = await db.query.workspaceUserPreferences.findMany({
    where: and(
      eq(workspaceUserPreferences.workspaceId, workspace.id),
      eq(workspaceUserPreferences.userId, user.id)
    ),
  });

  const existingKeys = existingPrefs.map((p) => p.key);
  const missingKeys = SIDEBAR_PREF_KEYS.filter((key) => !existingKeys.includes(key));

  // Auto-create missing preferences
  if (missingKeys.length > 0) {
    const toCreate = missingKeys.map((key, i) => ({
      workspaceId: workspace.id,
      userId: user.id,
      key,
      isPinned: DEFAULT_PINNED_KEYS.includes(key),
      sortOrder: 65535 + (i * 10000),
    }));

    await db.insert(workspaceUserPreferences).values(toCreate);
  }

  // Re-fetch and return as dict
  const allPrefs = await db.query.workspaceUserPreferences.findMany({
    where: and(
      eq(workspaceUserPreferences.workspaceId, workspace.id),
      eq(workspaceUserPreferences.userId, user.id)
    ),
    orderBy: [asc(workspaceUserPreferences.sortOrder)],
  });

  const result: Record<string, { is_pinned: boolean; sort_order: number }> = {};
  for (const pref of allPrefs) {
    result[pref.key] = {
      is_pinned: pref.isPinned ?? false,
      sort_order: pref.sortOrder ?? 65535,
    };
  }

  return c.json(result);
});

// PATCH /api/workspaces/:slug/sidebar-preferences/ - Bulk update sidebar preferences
workspaceRoutes.patch("/:slug/sidebar-preferences/", async (c) => {
  const user = c.get("user");
  const workspace = c.get("workspace");
  if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

  const body = await c.req.json() as Array<{ key: string; is_pinned?: boolean; sort_order?: number }>;

  if (!Array.isArray(body)) {
    return c.json({ detail: "Expected an array of preferences." }, 400);
  }

  for (const data of body) {
    const key = data.key;
    if (!key) continue;

    const pref = await db.query.workspaceUserPreferences.findFirst({
      where: and(
        eq(workspaceUserPreferences.key, key),
        eq(workspaceUserPreferences.workspaceId, workspace.id),
        eq(workspaceUserPreferences.userId, user.id)
      ),
    });

    if (!pref) continue;

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.is_pinned !== undefined) updateData.isPinned = data.is_pinned;
    if (data.sort_order !== undefined) updateData.sortOrder = data.sort_order;

    await db.update(workspaceUserPreferences)
      .set(updateData)
      .where(eq(workspaceUserPreferences.id, pref.id));
  }

  return c.json({ message: "Successfully updated" });
});

// PATCH /api/workspaces/:slug/sidebar-preferences/:key/ - Update single sidebar preference
workspaceRoutes.patch("/:slug/sidebar-preferences/:key/", async (c) => {
  const user = c.get("user");
  const workspace = c.get("workspace");
  const key = c.req.param("key");
  if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

  const body = await c.req.json() as { is_pinned?: boolean; sort_order?: number };

  const pref = await db.query.workspaceUserPreferences.findFirst({
    where: and(
      eq(workspaceUserPreferences.key, key),
      eq(workspaceUserPreferences.workspaceId, workspace.id),
      eq(workspaceUserPreferences.userId, user.id)
    ),
  });

  if (!pref) return c.json({ detail: "Preference not found" }, 404);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.is_pinned !== undefined) updateData.isPinned = body.is_pinned;
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

  await db.update(workspaceUserPreferences)
    .set(updateData)
    .where(eq(workspaceUserPreferences.id, pref.id));

  const updated = await db.query.workspaceUserPreferences.findFirst({
    where: eq(workspaceUserPreferences.id, pref.id),
  });

  return c.json({
    key: updated!.key,
    is_pinned: updated!.isPinned ?? false,
    sort_order: updated!.sortOrder ?? 65535,
  });
});

// Home Preferences
workspaceRoutes.route("/:slug/home-preferences/", homePreferenceRoutes);

// User Properties
workspaceRoutes.route("/:slug/user-properties/", userPropertiesRoutes);


// Recent Visits
// GET /api/workspaces/:slug/recent-visits/ - List recent visits with entity data
workspaceRoutes.get("/:slug/recent-visits/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const entityNameParam = c.req.query("entity_name");

  // Build query conditions
  const conditions = [
    eq(recentVisits.workspaceId, workspace.id),
    eq(recentVisits.userId, user.id),
  ];

  // Filter by entity_name if provided, otherwise default to issue/page/project
  const allowedEntities = ["issue", "page", "project"];
  if (entityNameParam && allowedEntities.includes(entityNameParam)) {
    conditions.push(eq(recentVisits.entityType, entityNameParam));
  } else {
    conditions.push(inArray(recentVisits.entityType, allowedEntities));
  }

  const visits = await db
    .select()
    .from(recentVisits)
    .where(and(...conditions))
    .orderBy(desc(recentVisits.visitedAt))
    .limit(20);

  // Fetch entity data for each visit
  const results = await Promise.all(
    visits.map(async (visit) => {
      let entityData: Record<string, unknown> | null = null;

      try {
        if (visit.entityType === "issue") {
          const issue = await db.query.issues.findFirst({
            where: eq(issues.id, visit.entityId),
          });
          if (issue) {
            // Get project identifier
            const project = await db.query.projects.findFirst({
              where: eq(projects.id, issue.projectId),
            });
            // Get assignees (non-deleted)
            const assignees = await db
              .select({ assigneeId: issueAssignees.assigneeId })
              .from(issueAssignees)
              .where(eq(issueAssignees.issueId, issue.id));

            entityData = {
              id: issue.id,
              name: issue.name,
              state: issue.stateId,
              priority: issue.priority,
              assignees: assignees.map((a) => a.assigneeId),
              type: issue.isEpic ? "epic" : null,
              sequence_id: issue.sequenceId,
              project_id: issue.projectId,
              project_identifier: project?.identifier ?? null,
              is_epic: issue.isEpic ?? false,
            };
          }
        } else if (visit.entityType === "project") {
          const project = await db.query.projects.findFirst({
            where: eq(projects.id, visit.entityId),
          });
          if (project) {
            // Get active project members
            const members = await db
              .select({ memberId: projectMembers.memberId })
              .from(projectMembers)
              .where(
                and(
                  eq(projectMembers.projectId, project.id),
                  eq(projectMembers.isActive, true)
                )
              );

            entityData = {
              id: project.id,
              name: project.name,
              logo_props: project.iconProp ?? {},
              project_members: members.map((m) => m.memberId),
              identifier: project.identifier,
            };
          }
        } else if (visit.entityType === "page") {
          const page = await db.query.pages.findFirst({
            where: eq(pages.id, visit.entityId),
          });
          if (page) {
            // Get project identifier if page belongs to a project
            let projectIdentifier: string | null = null;
            if (page.projectId) {
              const project = await db.query.projects.findFirst({
                where: eq(projects.id, page.projectId),
              });
              projectIdentifier = project?.identifier ?? null;
            }

            entityData = {
              id: page.id,
              name: page.name,
              logo_props: page.iconProp ? JSON.parse(page.iconProp as string) : {},
              project_id: page.projectId ?? null,
              owned_by: page.ownedById,
              project_identifier: projectIdentifier,
            };
          }
        }
      } catch {
        entityData = null;
      }

      return {
        id: visit.id,
        entity_name: visit.entityType,
        entity_identifier: visit.entityId,
        entity_data: entityData,
        visited_at: visit.visitedAt?.toISOString() ?? null,
      };
    })
  );

  return c.json(results);
});

// =====================================================
// Placeholder routes (later phases)
// =====================================================

// Projects (Phase 4) - Handled by projectRoutes mounted at /api/workspaces/:slug/projects

// Cycles — GET /api/workspaces/:slug/cycles/
// Lists all non-archived cycles across the workspace with issue statistics
// Matches Django's WorkspaceCyclesEndpoint
workspaceRoutes.get("/:slug/cycles/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  // Fetch all non-archived cycles in this workspace
  const allCycles = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.workspaceId, workspace.id), isNull(cycles.archivedAt)))
    .orderBy(desc(cycles.createdAt));

  if (allCycles.length === 0) {
    return c.json([]);
  }

  const cycleIds = allCycles.map((c) => c.id);

  // Fetch favorites for current user
  const userFavorites = await db
    .select({ cycleId: cycleFavorites.cycleId })
    .from(cycleFavorites)
    .where(and(inArray(cycleFavorites.cycleId, cycleIds), eq(cycleFavorites.userId, user.id)));

  const favCycleIds = new Set(userFavorites.map((f) => f.cycleId));

  // Compute issue statistics per cycle
  // Join cycle_issues -> issues -> states to count by state group
  const issueStats = await db
    .select({
      cycleId: cycleIssues.cycleId,
      stateGroup: states.group,
      issueCount: count(),
    })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        inArray(cycleIssues.cycleId, cycleIds),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt)
      )
    )
    .groupBy(cycleIssues.cycleId, states.group);

  // Build stats map
  const statsMap = new Map<
    string,
    { total: number; completed: number; cancelled: number; started: number; unstarted: number; backlog: number }
  >();

  for (const row of issueStats) {
    const existing = statsMap.get(row.cycleId) || {
      total: 0,
      completed: 0,
      cancelled: 0,
      started: 0,
      unstarted: 0,
      backlog: 0,
    };
    const cnt = Number(row.issueCount);
    existing.total += cnt;
    switch (row.stateGroup) {
      case "completed":
        existing.completed += cnt;
        break;
      case "cancelled":
        existing.cancelled += cnt;
        break;
      case "started":
        existing.started += cnt;
        break;
      case "unstarted":
        existing.unstarted += cnt;
        break;
      case "backlog":
        existing.backlog += cnt;
        break;
    }
    statsMap.set(row.cycleId, existing);
  }

  // Compute cycle status based on dates
  const now = new Date();
  function getCycleStatus(startDate: Date | null, endDate: Date | null): string {
    if (!startDate || !endDate) return "draft";
    if (endDate < now) return "completed";
    if (startDate <= now && endDate >= now) return "current";
    return "upcoming";
  }

  // Format response matching Django's CycleSerializer
  const result = allCycles.map((cy) => {
    const stats = statsMap.get(cy.id) || {
      total: 0,
      completed: 0,
      cancelled: 0,
      started: 0,
      unstarted: 0,
      backlog: 0,
    };

    return {
      id: cy.id,
      workspace_id: cy.workspaceId,
      project_id: cy.projectId,
      name: cy.name,
      description: cy.description ?? "",
      start_date: cy.startDate?.toISOString().split("T")[0] ?? null,
      end_date: cy.endDate?.toISOString().split("T")[0] ?? null,
      owned_by_id: cy.ownedById ?? null,
      view_props: cy.viewProps ?? {},
      sort_order: cy.sortOrder ?? 65535,
      progress_snapshot: cy.progressSnapshot ?? {},
      is_favorite: favCycleIds.has(cy.id),
      status: getCycleStatus(cy.startDate, cy.endDate),
      total_issues: stats.total,
      completed_issues: stats.completed,
      cancelled_issues: stats.cancelled,
      started_issues: stats.started,
      unstarted_issues: stats.unstarted,
      backlog_issues: stats.backlog,
      created_at: cy.createdAt?.toISOString() ?? null,
      updated_at: cy.updatedAt?.toISOString() ?? null,
      archived_at: cy.archivedAt?.toISOString() ?? null,
    };
  });

  return c.json(result);
});

// Active Cycles — GET /api/workspaces/:slug/active-cycles/
// Lists currently active (current status) cycles with pagination
workspaceRoutes.get("/:slug/active-cycles/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cursor = c.req.query("cursor") || "0:0";
  const perPage = parseInt(c.req.query("per_page") || "10", 10);

  const now = new Date();

  // Fetch active (current) cycles: start_date <= now AND end_date >= now, not archived
  const activeCycles = await db
    .select()
    .from(cycles)
    .where(
      and(
        eq(cycles.workspaceId, workspace.id),
        isNull(cycles.archivedAt),
        sql`${cycles.startDate} IS NOT NULL`,
        sql`${cycles.endDate} IS NOT NULL`,
        sql`${cycles.startDate} <= ${Math.floor(now.getTime() / 1000)}`,
        sql`${cycles.endDate} >= ${Math.floor(now.getTime() / 1000)}`
      )
    )
    .orderBy(desc(cycles.createdAt));

  // Simple offset-based pagination from cursor
  const [cursorOffset] = cursor.split(":").map(Number);
  const offset = cursorOffset || 0;
  const paginatedCycles = activeCycles.slice(offset, offset + perPage);
  const hasNext = offset + perPage < activeCycles.length;
  const nextOffset = offset + perPage;

  if (paginatedCycles.length === 0) {
    return c.json({
      count: activeCycles.length,
      extra_stats: null,
      next_cursor: `${nextOffset}:0`,
      next_page_results: false,
      prev_cursor: `${Math.max(0, offset - perPage)}:0`,
      results: [],
      total_pages: Math.ceil(activeCycles.length / perPage),
    });
  }

  const cycleIds = paginatedCycles.map((cy) => cy.id);

  // Favorites
  const userFavorites = await db
    .select({ cycleId: cycleFavorites.cycleId })
    .from(cycleFavorites)
    .where(and(inArray(cycleFavorites.cycleId, cycleIds), eq(cycleFavorites.userId, user.id)));

  const favCycleIds = new Set(userFavorites.map((f) => f.cycleId));

  // Issue stats
  const issueStats = await db
    .select({
      cycleId: cycleIssues.cycleId,
      stateGroup: states.group,
      issueCount: count(),
    })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        inArray(cycleIssues.cycleId, cycleIds),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt)
      )
    )
    .groupBy(cycleIssues.cycleId, states.group);

  const statsMap = new Map<
    string,
    { total: number; completed: number; cancelled: number; started: number; unstarted: number; backlog: number }
  >();

  for (const row of issueStats) {
    const existing = statsMap.get(row.cycleId) || {
      total: 0,
      completed: 0,
      cancelled: 0,
      started: 0,
      unstarted: 0,
      backlog: 0,
    };
    const cnt = Number(row.issueCount);
    existing.total += cnt;
    switch (row.stateGroup) {
      case "completed":
        existing.completed += cnt;
        break;
      case "cancelled":
        existing.cancelled += cnt;
        break;
      case "started":
        existing.started += cnt;
        break;
      case "unstarted":
        existing.unstarted += cnt;
        break;
      case "backlog":
        existing.backlog += cnt;
        break;
    }
    statsMap.set(row.cycleId, existing);
  }

  const results = paginatedCycles.map((cy) => {
    const stats = statsMap.get(cy.id) || {
      total: 0,
      completed: 0,
      cancelled: 0,
      started: 0,
      unstarted: 0,
      backlog: 0,
    };

    return {
      id: cy.id,
      workspace_id: cy.workspaceId,
      project_id: cy.projectId,
      name: cy.name,
      description: cy.description ?? "",
      start_date: cy.startDate?.toISOString().split("T")[0] ?? null,
      end_date: cy.endDate?.toISOString().split("T")[0] ?? null,
      owned_by_id: cy.ownedById ?? null,
      view_props: cy.viewProps ?? {},
      sort_order: cy.sortOrder ?? 65535,
      progress_snapshot: cy.progressSnapshot ?? {},
      is_favorite: favCycleIds.has(cy.id),
      status: "current" as const,
      total_issues: stats.total,
      completed_issues: stats.completed,
      cancelled_issues: stats.cancelled,
      started_issues: stats.started,
      unstarted_issues: stats.unstarted,
      backlog_issues: stats.backlog,
      created_at: cy.createdAt?.toISOString() ?? null,
      updated_at: cy.updatedAt?.toISOString() ?? null,
      archived_at: cy.archivedAt?.toISOString() ?? null,
    };
  });

  return c.json({
    count: activeCycles.length,
    extra_stats: null,
    next_cursor: `${nextOffset}:0`,
    next_page_results: hasNext,
    prev_cursor: `${Math.max(0, offset - perPage)}:0`,
    results,
    total_pages: Math.ceil(activeCycles.length / perPage),
  });
});

// Modules — GET /api/workspaces/:slug/modules/
// Lists all non-archived modules across the workspace with issue statistics
// Matches Django's WorkspaceModulesEndpoint
workspaceRoutes.get("/:slug/modules/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  // Fetch all non-archived modules in this workspace
  const allModules = await db
    .select()
    .from(modules)
    .where(and(eq(modules.workspaceId, workspace.id), isNull(modules.archivedAt)))
    .orderBy(desc(modules.createdAt));

  if (allModules.length === 0) {
    return c.json([]);
  }

  const moduleIds = allModules.map((m) => m.id);

  // Fetch members for all modules
  const allMembers = await db
    .select({ moduleId: moduleMembers.moduleId, memberId: moduleMembers.memberId })
    .from(moduleMembers)
    .where(inArray(moduleMembers.moduleId, moduleIds));

  const membersByModule = new Map<string, string[]>();
  for (const mm of allMembers) {
    const existing = membersByModule.get(mm.moduleId) || [];
    existing.push(mm.memberId);
    membersByModule.set(mm.moduleId, existing);
  }

  // Fetch favorites for current user
  const userFavorites = await db
    .select({ moduleId: moduleFavorites.moduleId })
    .from(moduleFavorites)
    .where(and(inArray(moduleFavorites.moduleId, moduleIds), eq(moduleFavorites.userId, user.id)));

  const favModuleIds = new Set(userFavorites.map((f) => f.moduleId));

  // Fetch links for all modules
  const allLinks = await db.select().from(moduleLinks).where(inArray(moduleLinks.moduleId, moduleIds));

  const linksByModule = new Map<string, typeof allLinks>();
  for (const link of allLinks) {
    const existing = linksByModule.get(link.moduleId) || [];
    existing.push(link);
    linksByModule.set(link.moduleId, existing);
  }

  // Compute issue statistics per module
  // Join module_issues -> issues -> states to count by state group
  const issueStats = await db
    .select({
      moduleId: moduleIssues.moduleId,
      stateGroup: states.group,
      issueCount: count(),
    })
    .from(moduleIssues)
    .innerJoin(issues, eq(moduleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        inArray(moduleIssues.moduleId, moduleIds),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt)
      )
    )
    .groupBy(moduleIssues.moduleId, states.group);

  // Build stats map: moduleId -> { total, completed, cancelled, started, unstarted, backlog }
  const statsMap = new Map<
    string,
    { total: number; completed: number; cancelled: number; started: number; unstarted: number; backlog: number }
  >();

  for (const row of issueStats) {
    const existing = statsMap.get(row.moduleId) || {
      total: 0,
      completed: 0,
      cancelled: 0,
      started: 0,
      unstarted: 0,
      backlog: 0,
    };
    const cnt = Number(row.issueCount);
    existing.total += cnt;
    switch (row.stateGroup) {
      case "completed":
        existing.completed += cnt;
        break;
      case "cancelled":
        existing.cancelled += cnt;
        break;
      case "started":
        existing.started += cnt;
        break;
      case "unstarted":
        existing.unstarted += cnt;
        break;
      case "backlog":
        existing.backlog += cnt;
        break;
    }
    statsMap.set(row.moduleId, existing);
  }

  // Format response matching Django's ModuleSerializer
  const result = allModules.map((m) => {
    const stats = statsMap.get(m.id) || {
      total: 0,
      completed: 0,
      cancelled: 0,
      started: 0,
      unstarted: 0,
      backlog: 0,
    };

    return {
      id: m.id,
      workspace_id: m.workspaceId,
      project_id: m.projectId,
      name: m.name,
      description: m.description ?? "",
      description_text: m.descriptionText ?? null,
      description_html: m.descriptionHtml ?? null,
      start_date: m.startDate?.toISOString().split("T")[0] ?? null,
      target_date: m.targetDate?.toISOString().split("T")[0] ?? null,
      status: m.status ?? "backlog",
      lead_id: m.leadId ?? null,
      member_ids: membersByModule.get(m.id) || [],
      view_props: m.viewProps ?? {},
      sort_order: m.sortOrder ?? 65535,
      is_favorite: favModuleIds.has(m.id),
      total_issues: stats.total,
      completed_issues: stats.completed,
      cancelled_issues: stats.cancelled,
      started_issues: stats.started,
      unstarted_issues: stats.unstarted,
      backlog_issues: stats.backlog,
      created_at: m.createdAt?.toISOString() ?? null,
      updated_at: m.updatedAt?.toISOString() ?? null,
      archived_at: m.archivedAt?.toISOString() ?? null,
      link_module: (linksByModule.get(m.id) || []).map((link) => ({
        id: link.id,
        module_id: link.moduleId,
        title: link.title ?? "",
        url: link.url,
        metadata: link.metadata ?? {},
        created_by_id: link.createdById ?? null,
        created_at: link.createdAt?.toISOString() ?? null,
      })),
    };
  });

  return c.json(result);
});

// Views - LIST
workspaceRoutes.get("/:slug/views/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  const membership = c.get("workspaceMembership");
  if (!workspace || !user || !membership) return c.json({ detail: "Not found." }, 404);

  // Get workspace-level views (project is null)
  // Guests only see their own views; others see own + public (accessLevel=1)
  const isGuest = membership.role === ROLES.GUEST;

  // Support order_by query param (default: -created_at)
  const orderByParam = c.req.query("order_by") ?? "-created_at";
  const isDescending = orderByParam.startsWith("-");
  const orderField = orderByParam.replace(/^-/, "");
  const orderMap: Record<string, any> = {
    created_at: views.createdAt,
    updated_at: views.updatedAt,
    name: views.name,
    sort_order: views.sortOrder,
  };
  const orderCol = orderMap[orderField] ?? views.createdAt;
  const orderDir = isDescending ? desc(orderCol) : asc(orderCol);

  const allViews = await db.query.views.findMany({
    where: and(
      eq(views.workspaceId, workspace.id),
      isNull(views.projectId)
    ),
    orderBy: [orderDir],
  });

  const filtered = isGuest
    ? allViews.filter((v) => v.ownedById === user.id)
    : allViews.filter((v) => v.ownedById === user.id || v.accessLevel === 1);

  // Get favorites for current user
  const userFavorites = await db
    .select({ viewId: viewFavorites.viewId })
    .from(viewFavorites)
    .where(eq(viewFavorites.userId, user.id));
  const favSet = new Set(userFavorites.map((f) => f.viewId));

  const result = filtered.map((v) => ({
    id: v.id,
    workspace: workspace.id,
    project: v.projectId,
    name: v.name,
    description: v.description ?? "",
    query: v.query ?? {},
    query_data: v.queryData ?? {},
    filters: v.filtersData ?? {},
    display_filters: v.displayFilters ?? {},
    display_properties: v.displayProperties ?? {},
    access: v.accessLevel ?? 1,
    sort_order: v.sortOrder ?? 65535,
    is_locked: v.isLocked ?? false,
    is_favorite: favSet.has(v.id),
    owned_by: v.ownedById,
    created_at: v.createdAt?.toISOString() ?? null,
    updated_at: v.updatedAt?.toISOString() ?? null,
  }));

  return c.json(result);
});

// Views - CREATE
workspaceRoutes.post(
  "/:slug/views/",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1),
      description: z.string().optional().default(""),
      query: z.any().optional().default({}),
      query_data: z.any().optional().default({}),
      filters: z.any().optional().default({}),
      display_filters: z.any().optional().default({}),
      display_properties: z.any().optional().default({}),
      access: z.number().int().min(0).max(2).optional().default(1),
      sort_order: z.number().optional(),
      is_locked: z.boolean().optional().default(false),
    })
  ),
  async (c) => {
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");

    // Auto-calculate sort_order if not provided (Django: max + 10000)
    let sortOrder = body.sort_order;
    if (sortOrder === undefined) {
      const maxResult = await db
        .select({ largest: max(views.sortOrder) })
        .from(views)
        .where(
          and(
            eq(views.workspaceId, workspace.id),
            isNull(views.projectId)
          )
        );
      const largest = maxResult[0]?.largest;
      sortOrder = largest != null ? largest + 10000 : 65535;
    }

    const [created] = await db
      .insert(views)
      .values({
        workspaceId: workspace.id,
        name: body.name,
        description: body.description,
        query: body.query,
        queryData: body.query_data,
        filtersData: body.filters,
        displayFilters: body.display_filters,
        displayProperties: body.display_properties,
        accessLevel: body.access,
        sortOrder,
        isLocked: body.is_locked,
        ownedById: user.id,
      })
      .returning();

    return c.json(
      {
        id: created.id,
        workspace: workspace.id,
        project: null,
        name: created.name,
        description: created.description ?? "",
        query: created.query ?? {},
        query_data: created.queryData ?? {},
        filters: created.filtersData ?? {},
        display_filters: created.displayFilters ?? {},
        display_properties: created.displayProperties ?? {},
        access: created.accessLevel ?? 1,
        sort_order: created.sortOrder ?? 65535,
        is_locked: created.isLocked ?? false,
        is_favorite: false,
        owned_by: created.ownedById,
        created_at: created.createdAt?.toISOString() ?? null,
        updated_at: created.updatedAt?.toISOString() ?? null,
      },
      201
    );
  }
);

// Views - RETRIEVE
workspaceRoutes.get("/:slug/views/:viewId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const viewId = c.req.param("viewId");

  const view = await db.query.views.findFirst({
    where: and(
      eq(views.id, viewId),
      eq(views.workspaceId, workspace.id),
      isNull(views.projectId)
    ),
  });

  if (!view) return c.json({ detail: "Not found." }, 404);

  // Check if user favorited this view
  const fav = await db.query.viewFavorites.findFirst({
    where: and(
      eq(viewFavorites.viewId, view.id),
      eq(viewFavorites.userId, user.id)
    ),
  });

  return c.json({
    id: view.id,
    workspace: workspace.id,
    project: view.projectId,
    name: view.name,
    description: view.description ?? "",
    query: view.query ?? {},
    query_data: view.queryData ?? {},
    filters: view.filtersData ?? {},
    display_filters: view.displayFilters ?? {},
    display_properties: view.displayProperties ?? {},
    access: view.accessLevel ?? 1,
    sort_order: view.sortOrder ?? 65535,
    is_locked: view.isLocked ?? false,
    is_favorite: !!fav,
    owned_by: view.ownedById,
    created_at: view.createdAt?.toISOString() ?? null,
    updated_at: view.updatedAt?.toISOString() ?? null,
  });
});

// Views - PARTIAL UPDATE
workspaceRoutes.patch(
  "/:slug/views/:viewId/",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      query: z.any().optional(),
      query_data: z.any().optional(),
      filters: z.any().optional(),
      display_filters: z.any().optional(),
      display_properties: z.any().optional(),
      access: z.number().int().min(0).max(2).optional(),
      sort_order: z.number().optional(),
      is_locked: z.boolean().optional(),
    })
  ),
  async (c) => {
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

    const viewId = c.req.param("viewId");

    const view = await db.query.views.findFirst({
      where: and(
        eq(views.id, viewId),
        eq(views.workspaceId, workspace.id),
        isNull(views.projectId)
      ),
    });

    if (!view) return c.json({ detail: "Not found." }, 404);

    // Only owner can update
    if (view.ownedById !== user.id) {
      return c.json({ detail: "Only the owner can update this view." }, 403);
    }

    // Locked views cannot be updated (except to unlock)
    const body = c.req.valid("json");
    if (view.isLocked && body.is_locked !== false) {
      return c.json({ detail: "View is locked." }, 400);
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.query !== undefined) updateData.query = body.query;
    if (body.query_data !== undefined) updateData.queryData = body.query_data;
    if (body.filters !== undefined) updateData.filtersData = body.filters;
    if (body.display_filters !== undefined) updateData.displayFilters = body.display_filters;
    if (body.display_properties !== undefined) updateData.displayProperties = body.display_properties;
    if (body.access !== undefined) updateData.accessLevel = body.access;
    if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;
    if (body.is_locked !== undefined) updateData.isLocked = body.is_locked;

    const [updated] = await db
      .update(views)
      .set(updateData)
      .where(eq(views.id, viewId))
      .returning();

    const fav = await db.query.viewFavorites.findFirst({
      where: and(
        eq(viewFavorites.viewId, updated.id),
        eq(viewFavorites.userId, user.id)
      ),
    });

    return c.json({
      id: updated.id,
      workspace: workspace.id,
      project: updated.projectId,
      name: updated.name,
      description: updated.description ?? "",
      query: updated.query ?? {},
      query_data: updated.queryData ?? {},
      filters: updated.filtersData ?? {},
      display_filters: updated.displayFilters ?? {},
      display_properties: updated.displayProperties ?? {},
      access: updated.accessLevel ?? 1,
      sort_order: updated.sortOrder ?? 65535,
      is_locked: updated.isLocked ?? false,
      is_favorite: !!fav,
      owned_by: updated.ownedById,
      created_at: updated.createdAt?.toISOString() ?? null,
      updated_at: updated.updatedAt?.toISOString() ?? null,
    });
  }
);

// Views - DELETE
workspaceRoutes.delete("/:slug/views/:viewId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  const membership = c.get("workspaceMembership");
  if (!workspace || !user || !membership) return c.json({ detail: "Not found." }, 404);

  const viewId = c.req.param("viewId");

  const view = await db.query.views.findFirst({
    where: and(
      eq(views.id, viewId),
      eq(views.workspaceId, workspace.id),
      isNull(views.projectId)
    ),
  });

  if (!view) return c.json({ detail: "Not found." }, 404);

  // Only admin or owner can delete
  const isAdmin = membership.role === ROLES.ADMIN;
  const isOwner = view.ownedById === user.id;
  if (!isAdmin && !isOwner) {
    return c.json({ detail: "Only the owner or admin can delete this view." }, 403);
  }

  // Delete favorites first, then the view
  await db.delete(viewFavorites).where(eq(viewFavorites.viewId, viewId));
  await db.delete(views).where(eq(views.id, viewId));

  return c.body(null, 204);
});

// My Issues
workspaceRoutes.get("/:slug/my-issues/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const { issueAssignees, issues } = await import("../../db/schema/issue");
  const { isNull, and: andOp, eq: eqOp, asc: ascOp, inArray: inArrayOp } = await import("drizzle-orm");

  // Get all issues assigned to user in this workspace
  const assignedIssueIds = await db
    .select({ issueId: issueAssignees.issueId })
    .from(issueAssignees)
    .where(eqOp(issueAssignees.assigneeId, user.id));

  if (assignedIssueIds.length === 0) return c.json([]);

  const myIssues = await db
    .select()
    .from(issues)
    .where(
      andOp(
        inArrayOp(issues.id, assignedIssueIds.map((a) => a.issueId)),
        eqOp(issues.workspaceId, workspace.id),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )!
    )
    .orderBy(ascOp(issues.sortOrder));

  return c.json(myIssues.map((i) => ({
    id: i.id,
    project_id: i.projectId,
    workspace_id: i.workspaceId,
    name: i.name,
    state_id: i.stateId ?? null,
    priority: i.priority ?? 0,
    sort_order: i.sortOrder ?? 65535,
    start_date: i.startDate?.toISOString()?.split("T")[0] ?? null,
    target_date: i.targetDate?.toISOString()?.split("T")[0] ?? null,
    sequence_id: i.sequenceId ?? null,
    created_at: i.createdAt?.toISOString() ?? null,
    updated_at: i.updatedAt?.toISOString() ?? null,
  })));
});

// Search - implemented at end of file

// =====================================================
// Notifications
// =====================================================

function formatNotification(
  n: typeof notifications.$inferSelect,
  extra?: {
    triggeredByDetails?: {
      id: string;
      display_name: string;
      first_name: string;
      last_name: string;
      avatar_url: string | null;
      is_bot: boolean;
    } | null;
    isMentionedNotification?: boolean;
  }
) {
  return {
    id: n.id,
    workspace: n.workspaceId,
    project: n.projectId ?? null,
    entity_identifier: n.entityId ?? null,
    entity_name: n.entityName ?? null,
    title: n.title,
    data: n.data ?? null,
    message: n.message ?? null,
    message_html: n.messageHtml ?? null,
    message_stripped: n.messageStripped ?? null,
    sender: n.sender ?? "",
    triggered_by: n.triggeredById ?? null,
    receiver: n.receiverId,
    read_at: n.readAt?.toISOString() ?? null,
    archived_at: n.archivedAt?.toISOString() ?? null,
    snoozed_till: n.snoozedTill?.toISOString() ?? null,
    triggered_by_details: extra?.triggeredByDetails ?? null,
    is_inbox_issue: false,
    is_intake_issue: false,
    is_mentioned_notification: extra?.isMentionedNotification ?? (n.sender?.includes("mentioned") ?? false),
    created_by: n.createdById ?? null,
    updated_by: n.updatedById ?? null,
    created_at: n.createdAt?.toISOString() ?? null,
    updated_at: n.updatedAt?.toISOString() ?? null,
  };
}

// GET /api/workspaces/:slug/users/notifications/ - List notifications with filtering
workspaceRoutes.get("/:slug/users/notifications/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const query = c.req.query();

  // Parse pagination
  const cursorParam = query.cursor || `${query.per_page || "30"}:0:0`;
  const cursorParts = cursorParam.split(":");
  const perPage = Math.min(parseInt(cursorParts[0] || "30") || 30, 1000);
  const pageNumber = parseInt(cursorParts[1] || "0") || 0;
  const offset = pageNumber * perPage;

  // Parse order_by
  const orderByParam = query.order_by || "-created_at";
  const isDescOrder = orderByParam.startsWith("-");
  const sortField = isDescOrder ? orderByParam.slice(1) : orderByParam;
  const sortFn = isDescOrder ? desc : asc;

  let sortColumn: ReturnType<typeof asc>;
  switch (sortField) {
    case "created_at":
      sortColumn = sortFn(notifications.createdAt);
      break;
    case "read_at":
      sortColumn = sortFn(notifications.readAt);
      break;
    default:
      sortColumn = sortFn(notifications.createdAt);
  }

  // Build conditions
  const conditions: ReturnType<typeof eq>[] = [
    eq(notifications.workspaceId, workspace.id),
    eq(notifications.receiverId, user.id),
  ];

  // Snoozed filter
  if (query.snoozed === "true") {
    conditions.push(isNotNull(notifications.snoozedTill));
  } else if (query.snoozed === "false" || !query.snoozed) {
    // By default exclude snoozed (snoozed_till is null or in the past)
    conditions.push(
      or(
        isNull(notifications.snoozedTill),
        lte(notifications.snoozedTill, new Date())
      )!
    );
  }

  // Archived filter
  if (query.archived === "true") {
    conditions.push(isNotNull(notifications.archivedAt));
  } else {
    conditions.push(isNull(notifications.archivedAt));
  }

  // Read filter
  if (query.read === "true") {
    conditions.push(isNotNull(notifications.readAt));
  } else if (query.read === "false") {
    conditions.push(isNull(notifications.readAt));
  }
  // If read not specified, return both

  // Mentioned filter
  if (query.mentioned === "true") {
    conditions.push(like(notifications.sender, "%mentioned%"));
  }

  // Type filter (assigned, created, subscribed)
  const typeParam = query.type;
  if (typeParam && typeParam !== "all") {
    const types = typeParam.split(",").map((t) => t.trim());
    const typeConditions: ReturnType<typeof eq>[] = [];

    for (const t of types) {
      if (t === "assigned") {
        typeConditions.push(like(notifications.sender, "%assigned%"));
      } else if (t === "created") {
        typeConditions.push(like(notifications.sender, "%created%"));
      } else if (t === "subscribed" || t === "watching") {
        typeConditions.push(like(notifications.sender, "%subscribed%"));
      }
    }

    if (typeConditions.length > 0) {
      conditions.push(or(...typeConditions)!);
    }
  }

  // Fetch total count
  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(...conditions));
  const totalCount = Number(totalResult[0]?.count ?? 0);

  // Fetch paginated results
  const results = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(sortColumn)
    .limit(perPage)
    .offset(offset);

  // Batch fetch triggered_by details
  const triggeredByIds = [...new Set(results.map((n) => n.triggeredById).filter(Boolean))];
  const triggeredByRows =
    triggeredByIds.length > 0
      ? await db
          .select({
            id: users.id,
            displayName: users.displayName,
            firstName: users.name,
            avatar: users.avatar,
          })
          .from(users)
          .where(inArray(users.id, triggeredByIds as string[]))
      : [];
  const triggeredByMap = new Map(
    triggeredByRows.map((u) => [
      u.id,
      {
        id: u.id,
        display_name: u.displayName ?? u.firstName ?? "",
        first_name: u.firstName ?? "",
        last_name: "",
        avatar_url: u.avatar ?? null,
        is_bot: false,
      },
    ])
  );

  // Pagination
  const totalPages = Math.ceil(totalCount / perPage);
  const nextPageExists = pageNumber + 1 < totalPages;
  const prevPageExists = pageNumber > 0;
  const nextCursor = `${perPage}:${pageNumber + 1}:0`;
  const prevCursor = `${perPage}:${pageNumber > 0 ? pageNumber - 1 : 0}:0`;

  return c.json({
    grouped_by: null,
    sub_grouped_by: null,
    next_cursor: nextCursor,
    prev_cursor: prevCursor,
    next_page_results: nextPageExists,
    prev_page_results: prevPageExists,
    total_count: totalCount,
    count: results.length,
    total_pages: totalPages,
    total_results: totalCount,
    extra_stats: null,
    results: results.map((n) =>
      formatNotification(n, {
        triggeredByDetails: n.triggeredById ? triggeredByMap.get(n.triggeredById) ?? null : null,
      })
    ),
  });
});

// GET /api/workspaces/:slug/users/notifications/unread/ - Get unread notification counts
workspaceRoutes.get("/:slug/users/notifications/unread/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  // Count unread notifications excluding mentions
  const unreadResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspace.id),
        eq(notifications.receiverId, user.id),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
        or(
          isNull(notifications.snoozedTill),
          lte(notifications.snoozedTill, new Date())
        ),
        not(like(notifications.sender, "%mentioned%"))
      )
    );

  // Count unread mention notifications
  const mentionResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspace.id),
        eq(notifications.receiverId, user.id),
        isNull(notifications.readAt),
        isNull(notifications.archivedAt),
        or(
          isNull(notifications.snoozedTill),
          lte(notifications.snoozedTill, new Date())
        ),
        like(notifications.sender, "%mentioned%")
      )
    );

  return c.json({
    total_unread_notifications_count: Number(unreadResult[0]?.count ?? 0),
    mention_unread_notifications_count: Number(mentionResult[0]?.count ?? 0),
  });
});

// POST /api/workspaces/:slug/users/notifications/mark-all-read/ - Mark all notifications as read
workspaceRoutes.post("/:slug/users/notifications/mark-all-read/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty body is fine
  }

  const conditions: ReturnType<typeof eq>[] = [
    eq(notifications.workspaceId, workspace.id),
    eq(notifications.receiverId, user.id),
    isNull(notifications.readAt),
  ];

  // Apply same filters as list endpoint
  if (body.snoozed === true) {
    conditions.push(isNotNull(notifications.snoozedTill));
  } else {
    conditions.push(
      or(
        isNull(notifications.snoozedTill),
        lte(notifications.snoozedTill, new Date())
      )!
    );
  }

  if (body.archived === true) {
    conditions.push(isNotNull(notifications.archivedAt));
  } else {
    conditions.push(isNull(notifications.archivedAt));
  }

  const typeParam = body.type as string | undefined;
  if (typeParam && typeParam !== "all") {
    const types = typeParam.split(",").map((t) => t.trim());
    const typeConditions: ReturnType<typeof eq>[] = [];

    for (const t of types) {
      if (t === "assigned") typeConditions.push(like(notifications.sender, "%assigned%"));
      else if (t === "created") typeConditions.push(like(notifications.sender, "%created%"));
      else if (t === "subscribed" || t === "watching") typeConditions.push(like(notifications.sender, "%subscribed%"));
    }

    if (typeConditions.length > 0) {
      conditions.push(or(...typeConditions)!);
    }
  }

  await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(and(...conditions));

  return c.json({ message: "All notifications marked as read." });
});

// GET /api/workspaces/:slug/users/notifications/:notificationId/ - Get single notification
workspaceRoutes.get("/:slug/users/notifications/:notificationId/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const notificationId = c.req.param("notificationId");

  const notification = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.id, notificationId),
      eq(notifications.workspaceId, workspace.id),
      eq(notifications.receiverId, user.id)
    ),
  });

  if (!notification) return c.json({ detail: "Notification not found." }, 404);

  let triggeredByDetails = null;
  if (notification.triggeredById) {
    const trigUser = await db.query.users.findFirst({
      where: eq(users.id, notification.triggeredById),
    });
    if (trigUser) {
      triggeredByDetails = {
        id: trigUser.id,
        display_name: trigUser.displayName ?? trigUser.name ?? "",
        first_name: trigUser.name ?? "",
        last_name: "",
        avatar_url: trigUser.avatar ?? null,
        is_bot: false,
      };
    }
  }

  return c.json(formatNotification(notification, { triggeredByDetails }));
});

// PATCH /api/workspaces/:slug/users/notifications/:notificationId/ - Update notification (snooze)
workspaceRoutes.patch("/:slug/users/notifications/:notificationId/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const notificationId = c.req.param("notificationId");

  const notification = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.id, notificationId),
      eq(notifications.workspaceId, workspace.id),
      eq(notifications.receiverId, user.id)
    ),
  });

  if (!notification) return c.json({ detail: "Notification not found." }, 404);

  const body = await c.req.json();
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.snoozed_till !== undefined) {
    updateData.snoozedTill = body.snoozed_till ? new Date(body.snoozed_till) : null;
  }

  await db.update(notifications).set(updateData).where(eq(notifications.id, notificationId));

  const updated = await db.query.notifications.findFirst({
    where: eq(notifications.id, notificationId),
  });

  return c.json(formatNotification(updated!));
});

// POST /api/workspaces/:slug/users/notifications/:notificationId/read/ - Mark as read
workspaceRoutes.post("/:slug/users/notifications/:notificationId/read/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const notificationId = c.req.param("notificationId");

  const notification = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.id, notificationId),
      eq(notifications.workspaceId, workspace.id),
      eq(notifications.receiverId, user.id)
    ),
  });

  if (!notification) return c.json({ detail: "Notification not found." }, 404);

  await db
    .update(notifications)
    .set({ readAt: new Date(), updatedAt: new Date() })
    .where(eq(notifications.id, notificationId));

  return c.json({ message: "Notification marked as read." });
});

// DELETE /api/workspaces/:slug/users/notifications/:notificationId/read/ - Mark as unread
workspaceRoutes.delete("/:slug/users/notifications/:notificationId/read/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const notificationId = c.req.param("notificationId");

  const notification = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.id, notificationId),
      eq(notifications.workspaceId, workspace.id),
      eq(notifications.receiverId, user.id)
    ),
  });

  if (!notification) return c.json({ detail: "Notification not found." }, 404);

  await db
    .update(notifications)
    .set({ readAt: null, updatedAt: new Date() })
    .where(eq(notifications.id, notificationId));

  return c.json({ message: "Notification marked as unread." });
});

// POST /api/workspaces/:slug/users/notifications/:notificationId/archive/ - Archive
workspaceRoutes.post("/:slug/users/notifications/:notificationId/archive/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const notificationId = c.req.param("notificationId");

  const notification = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.id, notificationId),
      eq(notifications.workspaceId, workspace.id),
      eq(notifications.receiverId, user.id)
    ),
  });

  if (!notification) return c.json({ detail: "Notification not found." }, 404);

  await db
    .update(notifications)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(notifications.id, notificationId));

  return c.json({ message: "Notification archived." });
});

// DELETE /api/workspaces/:slug/users/notifications/:notificationId/archive/ - Unarchive
workspaceRoutes.delete("/:slug/users/notifications/:notificationId/archive/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const notificationId = c.req.param("notificationId");

  const notification = await db.query.notifications.findFirst({
    where: and(
      eq(notifications.id, notificationId),
      eq(notifications.workspaceId, workspace.id),
      eq(notifications.receiverId, user.id)
    ),
  });

  if (!notification) return c.json({ detail: "Notification not found." }, 404);

  await db
    .update(notifications)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(eq(notifications.id, notificationId));

  return c.json({ message: "Notification unarchived." });
});

// Favorites

// Validation schemas for favorites
const createFavoriteSchema = z.object({
  entity_type: z.string().min(1),
  entity_identifier: z.string().optional().nullable(),
  name: z.string().max(255).optional().nullable(),
  is_folder: z.boolean().optional(),
  parent: z.string().optional().nullable(),
  project_id: z.string().optional().nullable(),
  sequence: z.number().optional(),
});

const updateFavoriteSchema = z.object({
  name: z.string().max(255).optional().nullable(),
  parent: z.string().optional().nullable(),
  sequence: z.number().optional(),
  is_folder: z.boolean().optional(),
  sort_order: z.number().optional(),
});

// Helper to fetch entity data for a favorite
async function fetchFavoriteEntityData(
  entityType: string,
  entityId: string | null
): Promise<Record<string, unknown> | null> {
  if (!entityId) return null;

  try {
    if (entityType === "project") {
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, entityId),
      });
      if (!project) return null;
      return {
        id: project.id,
        name: project.name,
        logo_props: project.iconProp ?? {},
      };
    } else if (entityType === "cycle") {
      const cycle = await db.query.cycles.findFirst({
        where: eq(cycles.id, entityId),
      });
      if (!cycle) return null;
      return {
        id: cycle.id,
        name: cycle.name,
        logo_props: {},
        project_id: cycle.projectId,
      };
    } else if (entityType === "module") {
      const mod = await db.query.modules.findFirst({
        where: eq(modules.id, entityId),
      });
      if (!mod) return null;
      return {
        id: mod.id,
        name: mod.name,
        logo_props: {},
        project_id: mod.projectId,
      };
    } else if (entityType === "view") {
      const view = await db.query.views.findFirst({
        where: eq(views.id, entityId),
      });
      if (!view) return null;
      return {
        id: view.id,
        name: view.name,
        logo_props: {},
        project_id: view.projectId,
      };
    } else if (entityType === "page") {
      const page = await db.query.pages.findFirst({
        where: eq(pages.id, entityId),
      });
      if (!page) return null;
      return {
        id: page.id,
        name: page.name,
        logo_props: page.iconProp ? JSON.parse(page.iconProp as string) : {},
        project_id: page.projectId ?? null,
      };
    }
  } catch {
    return null;
  }

  return null;
}

// Helper to format favorite for API response
async function formatFavoriteResponse(fav: typeof favorites.$inferSelect) {
  const entityData = await fetchFavoriteEntityData(
    fav.entityType,
    fav.entityId
  );

  return {
    id: fav.id,
    entity_type: fav.entityType,
    entity_identifier: fav.entityId ?? null,
    entity_data: entityData,
    name: fav.name ?? "",
    is_folder: fav.isFolder ?? false,
    sequence: fav.sequence ?? 65535,
    parent: fav.parentId ?? null,
    workspace_id: fav.workspaceId,
    project_id: fav.projectId ?? null,
  };
}

// GET /api/workspaces/:slug/user-favorites/ - List user's favorites (top-level only)
workspaceRoutes.get("/:slug/user-favorites/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  // Fetch top-level favorites (no parent) for the current user
  const userFavorites = await db
    .select()
    .from(favorites)
    .where(
      and(
        eq(favorites.userId, user.id),
        eq(favorites.workspaceId, workspace.id),
        isNull(favorites.parentId)
      )
    )
    .orderBy(desc(favorites.createdAt));

  const results = await Promise.all(
    userFavorites.map((fav) => formatFavoriteResponse(fav))
  );

  return c.json(results);
});

// POST /api/workspaces/:slug/user-favorites/ - Create a favorite
workspaceRoutes.post(
  "/:slug/user-favorites/",
  zValidator("json", createFavoriteSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "Authentication required." }, 401);

    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const body = c.req.valid("json");

    // If entity_identifier is provided, check if it already exists
    if (body.entity_identifier) {
      const existing = await db.query.favorites.findFirst({
        where: and(
          eq(favorites.workspaceId, workspace.id),
          eq(favorites.userId, user.id),
          eq(favorites.entityType, body.entity_type),
          eq(favorites.entityId, body.entity_identifier)
        ),
      });

      if (existing) {
        const result = await formatFavoriteResponse(existing);
        return c.json(result);
      }
    }

    // Calculate sequence: max sequence in workspace + 10000
    const maxSeqResult = await db
      .select({ maxSeq: max(favorites.sequence) })
      .from(favorites)
      .where(eq(favorites.workspaceId, workspace.id));
    const maxSeq = maxSeqResult[0]?.maxSeq ?? 65535;
    const newSequence = body.sequence ?? (typeof maxSeq === "number" ? maxSeq + 10000 : 75535);

    const result = await db
      .insert(favorites)
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        projectId: body.project_id ?? null,
        entityType: body.entity_type,
        entityId: body.entity_identifier ?? null,
        name: body.name ?? null,
        isFolder: body.is_folder ?? false,
        sequence: newSequence,
        parentId: body.parent ?? null,
      })
      .returning();

    const formatted = await formatFavoriteResponse(result[0]!);
    return c.json(formatted);
  }
);

// PATCH /api/workspaces/:slug/user-favorites/:id/ - Update a favorite
workspaceRoutes.patch(
  "/:slug/user-favorites/:id/",
  zValidator("json", updateFavoriteSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "Authentication required." }, 401);

    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const favoriteId = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.favorites.findFirst({
      where: and(
        eq(favorites.id, favoriteId),
        eq(favorites.userId, user.id),
        eq(favorites.workspaceId, workspace.id)
      ),
    });

    if (!existing) return c.json({ detail: "Favorite not found." }, 404);

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.parent !== undefined) updateData.parentId = body.parent;
    if (body.sequence !== undefined) updateData.sequence = body.sequence;
    if (body.is_folder !== undefined) updateData.isFolder = body.is_folder;
    if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

    if (Object.keys(updateData).length > 0) {
      await db
        .update(favorites)
        .set(updateData)
        .where(eq(favorites.id, favoriteId));
    }

    const updated = await db.query.favorites.findFirst({
      where: eq(favorites.id, favoriteId),
    });

    const formatted = await formatFavoriteResponse(updated!);
    return c.json(formatted);
  }
);

// DELETE /api/workspaces/:slug/user-favorites/:id/ - Delete a favorite
workspaceRoutes.delete("/:slug/user-favorites/:id/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const favoriteId = c.req.param("id");

  const existing = await db.query.favorites.findFirst({
    where: and(
      eq(favorites.id, favoriteId),
      eq(favorites.userId, user.id),
      eq(favorites.workspaceId, workspace.id)
    ),
  });

  if (!existing) return c.json({ detail: "Favorite not found." }, 404);

  // Delete the favorite and its children (if it's a folder)
  await db.delete(favorites).where(eq(favorites.parentId, favoriteId));
  await db.delete(favorites).where(eq(favorites.id, favoriteId));

  return new Response(null, { status: 204 });
});

// GET /api/workspaces/:slug/user-favorites/:id/group/ - Get favorites in a folder
workspaceRoutes.get("/:slug/user-favorites/:id/group/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const favoriteId = c.req.param("id");

  const children = await db
    .select()
    .from(favorites)
    .where(
      and(
        eq(favorites.userId, user.id),
        eq(favorites.workspaceId, workspace.id),
        eq(favorites.parentId, favoriteId)
      )
    )
    .orderBy(desc(favorites.createdAt));

  const results = await Promise.all(
    children.map((fav) => formatFavoriteResponse(fav))
  );

  return c.json(results);
});

// Quick links

// Validation schemas for quick links
const createQuickLinkSchema = z.object({
  title: z.string().max(255).optional().nullable(),
  url: z.string().min(1),
  metadata: z.any().optional(),
});

const updateQuickLinkSchema = z.object({
  title: z.string().max(255).optional().nullable(),
  url: z.string().min(1).optional(),
  metadata: z.any().optional(),
});

// Helper to normalize URL (auto-prefix http:// if no protocol)
function normalizeUrl(url: string): string {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    return "http://" + url;
  }
  return url;
}

// Helper to validate URL format
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Helper to format quick link for API response (matching Django's serializer output)
function formatQuickLinkResponse(
  link: typeof quickLinks.$inferSelect,
  workspaceSlug: string
) {
  return {
    id: link.id,
    title: link.name ?? "",
    url: link.url,
    metadata: link.description ? { description: link.description } : {},
    created_by_id: link.userId,
    workspace_slug: workspaceSlug,
    created_at: link.createdAt?.toISOString() ?? null,
    sort_order: link.sortOrder ?? 65535,
  };
}

// GET /api/workspaces/:slug/quick-links/ - List quick links for current user
workspaceRoutes.get("/:slug/quick-links/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const links = await db
    .select()
    .from(quickLinks)
    .where(
      and(
        eq(quickLinks.workspaceId, workspace.id),
        eq(quickLinks.userId, user.id)
      )
    )
    .orderBy(desc(quickLinks.createdAt));

  return c.json(links.map((link) => formatQuickLinkResponse(link, workspace.slug)));
});

// POST /api/workspaces/:slug/quick-links/ - Create a quick link
workspaceRoutes.post(
  "/:slug/quick-links/",
  zValidator("json", createQuickLinkSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "Authentication required." }, 401);

    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const body = c.req.valid("json");

    // Normalize URL
    const url = normalizeUrl(body.url);

    // Validate URL format
    if (!isValidUrl(url)) {
      return c.json({ url: ["Invalid URL format."] }, 400);
    }

    // Check for duplicate URL for the same user and workspace
    const existing = await db.query.quickLinks.findFirst({
      where: and(
        eq(quickLinks.url, url),
        eq(quickLinks.workspaceId, workspace.id),
        eq(quickLinks.userId, user.id)
      ),
    });

    if (existing) {
      return c.json(
        { error: "URL already exists for this workspace and owner" },
        400
      );
    }

    const result = await db
      .insert(quickLinks)
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        name: body.title ?? "",
        url,
        description: body.metadata
          ? JSON.stringify(body.metadata)
          : null,
      })
      .returning();

    return c.json(
      formatQuickLinkResponse(result[0]!, workspace.slug),
      201
    );
  }
);

// GET /api/workspaces/:slug/quick-links/:id/ - Retrieve a specific quick link
workspaceRoutes.get("/:slug/quick-links/:id/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const linkId = c.req.param("id");

  const link = await db.query.quickLinks.findFirst({
    where: and(
      eq(quickLinks.id, linkId),
      eq(quickLinks.workspaceId, workspace.id),
      eq(quickLinks.userId, user.id)
    ),
  });

  if (!link) {
    return c.json({ error: "Quick link not found." }, 404);
  }

  return c.json(formatQuickLinkResponse(link, workspace.slug));
});

// PATCH /api/workspaces/:slug/quick-links/:id/ - Update a quick link
workspaceRoutes.patch(
  "/:slug/quick-links/:id/",
  zValidator("json", updateQuickLinkSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "Authentication required." }, 401);

    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const linkId = c.req.param("id");
    const body = c.req.valid("json");

    // Find the existing link (must belong to current user)
    const existing = await db.query.quickLinks.findFirst({
      where: and(
        eq(quickLinks.id, linkId),
        eq(quickLinks.workspaceId, workspace.id),
        eq(quickLinks.userId, user.id)
      ),
    });

    if (!existing) {
      return c.json({ detail: "Quick link not found." }, 404);
    }

    // If URL is being updated, normalize and validate
    let url = body.url;
    if (url !== undefined) {
      url = normalizeUrl(url);
      if (!isValidUrl(url)) {
        return c.json({ url: ["Invalid URL format."] }, 400);
      }

      // Check for duplicate URL (excluding current link)
      const duplicate = await db.query.quickLinks.findFirst({
        where: and(
          eq(quickLinks.url, url),
          eq(quickLinks.workspaceId, workspace.id),
          eq(quickLinks.userId, user.id),
          not(eq(quickLinks.id, linkId))
        ),
      });

      if (duplicate) {
        return c.json(
          { error: "URL already exists for this workspace and owner" },
          400
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (body.title !== undefined) updateData.name = body.title ?? "";
    if (url !== undefined) updateData.url = url;
    if (body.metadata !== undefined) {
      updateData.description = body.metadata
        ? JSON.stringify(body.metadata)
        : null;
    }

    if (Object.keys(updateData).length === 0) {
      return c.json(formatQuickLinkResponse(existing, workspace.slug));
    }

    await db
      .update(quickLinks)
      .set(updateData)
      .where(eq(quickLinks.id, linkId));

    const updated = await db.query.quickLinks.findFirst({
      where: eq(quickLinks.id, linkId),
    });

    return c.json(formatQuickLinkResponse(updated!, workspace.slug));
  }
);

// DELETE /api/workspaces/:slug/quick-links/:id/ - Delete a quick link
workspaceRoutes.delete("/:slug/quick-links/:id/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const linkId = c.req.param("id");

  const link = await db.query.quickLinks.findFirst({
    where: and(
      eq(quickLinks.id, linkId),
      eq(quickLinks.workspaceId, workspace.id),
      eq(quickLinks.userId, user.id)
    ),
  });

  if (!link) {
    return c.json({ detail: "Quick link not found." }, 404);
  }

  await db.delete(quickLinks).where(eq(quickLinks.id, linkId));

  return new Response(null, { status: 204 });
});

// Stickies

// Validation schemas
const createStickySchema = z.object({
  name: z.string().optional().nullable(),
  description: z.any().optional(),
  description_html: z.string().optional(),
  description_binary: z.string().optional().nullable(),
  logo_props: z.any().optional(),
  color: z.string().max(255).optional().nullable(),
  background_color: z.string().max(255).optional().nullable(),
  sort_order: z.number().optional(),
});

const updateStickySchema = createStickySchema;

// Helper to format sticky for API response
function formatStickyResponse(sticky: typeof stickies.$inferSelect) {
  return {
    id: sticky.id,
    name: sticky.name ?? "",
    description: sticky.description ?? {},
    description_html: sticky.descriptionHtml ?? "<p></p>",
    description_stripped: sticky.descriptionStripped ?? "",
    description_binary: sticky.descriptionBinary ?? null,
    logo_props: sticky.logoProps ?? {},
    color: sticky.color ?? null,
    background_color: sticky.backgroundColor ?? null,
    sort_order: sticky.sortOrder ?? 65535,
    workspace: sticky.workspaceId,
    created_by: sticky.userId,
    updated_by: sticky.userId,
    created_at: sticky.createdAt?.toISOString() ?? null,
    updated_at: sticky.updatedAt?.toISOString() ?? null,
  };
}

// GET /api/workspaces/:slug/stickies/ - List stickies with offset-based pagination
// Cursor format: "perPage:pageOffset:isPrev" (e.g., "20:0:0" for first page of 20 items)
workspaceRoutes.get("/:slug/stickies/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const query = c.req.query("query");
  const perPageParam = c.req.query("per_page");
  const cursor = c.req.query("cursor");

  // Parse cursor format: "perPage:pageOffset:isPrev"
  let perPage = Math.min(Math.max(parseInt(perPageParam || "20", 10) || 20, 1), 100);
  let pageOffset = 0;

  if (cursor) {
    const parts = cursor.split(":");
    if (parts.length === 3) {
      const cursorPerPage = parseInt(parts[0]!, 10);
      const cursorOffset = parseInt(parts[1]!, 10);
      if (!isNaN(cursorPerPage) && cursorPerPage > 0) {
        perPage = Math.min(cursorPerPage, 100);
      }
      if (!isNaN(cursorOffset) && cursorOffset >= 0) {
        pageOffset = cursorOffset;
      }
    }
  }

  // Base conditions: user's stickies in this workspace
  const conditions: ReturnType<typeof eq>[] = [
    eq(stickies.workspaceId, workspace.id),
    eq(stickies.userId, user.id),
  ];

  // Search filter
  if (query) {
    conditions.push(like(stickies.descriptionStripped, `%${query}%`));
  }

  // Get total count
  const totalResult = await db
    .select({ total: count() })
    .from(stickies)
    .where(and(...conditions));
  const totalCount = Number(totalResult[0]?.total ?? 0);

  // Calculate offset
  const offset = pageOffset * perPage;

  // Fetch page + 1 to determine if there's a next page
  const results = await db
    .select()
    .from(stickies)
    .where(and(...conditions))
    .orderBy(desc(stickies.sortOrder))
    .offset(offset)
    .limit(perPage + 1);

  const hasNext = results.length > perPage;
  const pageResults = results.slice(0, perPage);
  const hasPrev = pageOffset > 0;

  // Build cursor strings in Django format
  const nextCursor = `${perPage}:${pageOffset + 1}:0`;
  const prevCursor = `${perPage}:${pageOffset - 1}:1`;

  // Return paginated response matching Django's paginate() format
  return c.json({
    next_cursor: nextCursor,
    prev_cursor: prevCursor,
    next_page_results: hasNext,
    prev_page_results: hasPrev,
    total_pages: Math.ceil(totalCount / perPage),
    total_count: totalCount,
    results: pageResults.map(formatStickyResponse),
  });
});

// POST /api/workspaces/:slug/stickies/ - Create a sticky
workspaceRoutes.post(
  "/:slug/stickies/",
  zValidator("json", createStickySchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "Authentication required." }, 401);

    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const body = c.req.valid("json");

    const result = await db
      .insert(stickies)
      .values({
        workspaceId: workspace.id,
        userId: user.id,
        name: body.name ?? null,
        description: body.description ?? {},
        descriptionHtml: body.description_html ?? "<p></p>",
        descriptionStripped: typeof body.description_html === "string"
          ? body.description_html.replace(/<[^>]*>/g, "").trim()
          : null,
        descriptionBinary: body.description_binary ?? null,
        logoProps: body.logo_props ?? {},
        color: body.color ?? null,
        backgroundColor: body.background_color ?? null,
        sortOrder: body.sort_order ?? 65535,
      })
      .returning();

    return c.json(formatStickyResponse(result[0]!), 201);
  }
);

// GET /api/workspaces/:slug/stickies/:id/ - Retrieve a sticky
workspaceRoutes.get("/:slug/stickies/:id/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const stickyId = c.req.param("id");

  const sticky = await db.query.stickies.findFirst({
    where: and(
      eq(stickies.id, stickyId),
      eq(stickies.workspaceId, workspace.id),
      eq(stickies.userId, user.id)
    ),
  });

  if (!sticky) return c.json({ detail: "Sticky not found." }, 404);

  return c.json(formatStickyResponse(sticky));
});

// PATCH /api/workspaces/:slug/stickies/:id/ - Update a sticky (owner only)
workspaceRoutes.patch(
  "/:slug/stickies/:id/",
  zValidator("json", updateStickySchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "Authentication required." }, 401);

    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const stickyId = c.req.param("id");
    const body = c.req.valid("json");

    // Only the owner can update their sticky
    const existing = await db.query.stickies.findFirst({
      where: and(
        eq(stickies.id, stickyId),
        eq(stickies.workspaceId, workspace.id),
        eq(stickies.userId, user.id)
      ),
    });

    if (!existing) return c.json({ detail: "Sticky not found." }, 404);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.description_html !== undefined) {
      updateData.descriptionHtml = body.description_html;
      updateData.descriptionStripped = body.description_html
        .replace(/<[^>]*>/g, "")
        .trim();
    }
    if (body.description_binary !== undefined) updateData.descriptionBinary = body.description_binary;
    if (body.logo_props !== undefined) updateData.logoProps = body.logo_props;
    if (body.color !== undefined) updateData.color = body.color;
    if (body.background_color !== undefined) updateData.backgroundColor = body.background_color;
    if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

    await db
      .update(stickies)
      .set(updateData)
      .where(eq(stickies.id, stickyId));

    const updated = await db.query.stickies.findFirst({
      where: eq(stickies.id, stickyId),
    });

    return c.json(formatStickyResponse(updated!));
  }
);

// DELETE /api/workspaces/:slug/stickies/:id/ - Delete a sticky (owner only)
workspaceRoutes.delete("/:slug/stickies/:id/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ detail: "Authentication required." }, 401);

  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const stickyId = c.req.param("id");

  // Only the owner can delete their sticky
  const sticky = await db.query.stickies.findFirst({
    where: and(
      eq(stickies.id, stickyId),
      eq(stickies.workspaceId, workspace.id),
      eq(stickies.userId, user.id)
    ),
  });

  if (!sticky) return c.json({ detail: "Sticky not found." }, 404);

  await db.delete(stickies).where(eq(stickies.id, stickyId));

  return new Response(null, { status: 204 });
});

// Dashboard
// The dashboard widget system was deprecated in Django but the frontend service layer still references it.
// We provide virtual dashboard/widget objects for compatibility.

const DASHBOARD_WIDGET_KEYS = [
  "overview_stats",
  "assigned_issues",
  "created_issues",
  "issues_by_state_groups",
  "issues_by_priority",
  "recent_activity",
  "recent_projects",
  "recent_collaborators",
] as const;

const DEFAULT_WIDGET_FILTERS: Record<string, Record<string, unknown>> = {
  assigned_issues: { duration: "this_week", tab: "pending" },
  created_issues: { duration: "this_week", tab: "pending" },
  issues_by_state_groups: {},
  issues_by_priority: {},
  overview_stats: {},
  recent_activity: {},
  recent_projects: {},
  recent_collaborators: {},
};

// GET /api/workspaces/:slug/dashboard/?dashboard_type=home
// Returns a virtual dashboard with default widgets for the current user
workspaceRoutes.get("/:slug/dashboard/", async (c) => {
  const user = c.get("user");
  const workspace = c.get("workspace");
  if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

  const dashboardType = c.req.query("dashboard_type") || "home";

  // Generate a deterministic dashboard ID from workspace + user
  const dashboardId = `dashboard-${workspace.id}-${user.id}`;

  const dashboard = {
    id: dashboardId,
    name: "Home",
    description_html: "<p></p>",
    identifier: null,
    is_default: true,
    type: dashboardType,
    owned_by: user.id,
    created_by: user.id,
    updated_by: user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const widgets = DASHBOARD_WIDGET_KEYS.map((key, i) => ({
    id: `widget-${dashboardId}-${key}`,
    key,
    is_visible: true,
    sort_order: 65535 + i * 1000,
    widget_filters: DEFAULT_WIDGET_FILTERS[key] ?? {},
    filters: DEFAULT_WIDGET_FILTERS[key] ?? {},
  }));

  return c.json({ dashboard, widgets });
});

// GET /api/workspaces/:slug/dashboard/:dashboardId/ - Widget stats
workspaceRoutes.get("/:slug/dashboard/:dashboardId/", async (c) => {
  const user = c.get("user");
  const workspace = c.get("workspace");
  if (!user || !workspace) return c.json({ detail: "Not found." }, 404);

  const widgetKey = c.req.query("widget_key");
  if (!widgetKey) return c.json({ detail: "widget_key is required" }, 400);

  const now = new Date();
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  switch (widgetKey) {
    case "overview_stats": {
      // Count assigned, completed, created, pending issues
      const assignedIssueIds = await db
        .select({ issueId: issueAssignees.issueId })
        .from(issueAssignees)
        .innerJoin(issues, eq(issues.id, issueAssignees.issueId))
        .where(and(eq(issueAssignees.assigneeId, user.id), eq(issues.workspaceId, workspace.id), isNull(issues.archivedAt)));

      const assignedIds = assignedIssueIds.map((r) => r.issueId);

      if (assignedIds.length === 0) {
        return c.json({
          assigned_issues_count: 0,
          completed_issues_count: 0,
          created_issues_count: 0,
          pending_issues_count: 0,
        });
      }

      const completedCount = await db
        .select({ count: count() })
        .from(issues)
        .innerJoin(states, eq(states.id, issues.stateId))
        .where(and(inArray(issues.id, assignedIds), eq(states.group, "completed")));

      const pendingCount = await db
        .select({ count: count() })
        .from(issues)
        .innerJoin(states, eq(states.id, issues.stateId))
        .where(and(inArray(issues.id, assignedIds), not(inArray(states.group, ["completed", "cancelled"]))));

      const createdCount = await db
        .select({ count: count() })
        .from(issues)
        .where(and(eq(issues.workspaceId, workspace.id), eq(issues.createdById, user.id), isNull(issues.archivedAt)));

      return c.json({
        assigned_issues_count: assignedIds.length,
        completed_issues_count: completedCount[0]?.count ?? 0,
        created_issues_count: createdCount[0]?.count ?? 0,
        pending_issues_count: pendingCount[0]?.count ?? 0,
      });
    }

    case "assigned_issues":
    case "created_issues": {
      const issueType = c.req.query("issue_type") || "pending";
      const targetDate = c.req.query("target_date");

      let baseQuery;
      if (widgetKey === "assigned_issues") {
        // Get issues assigned to user
        const assignedIssueIds = await db
          .select({ issueId: issueAssignees.issueId })
          .from(issueAssignees)
          .innerJoin(issues, eq(issues.id, issueAssignees.issueId))
          .where(and(eq(issueAssignees.assigneeId, user.id), eq(issues.workspaceId, workspace.id), isNull(issues.archivedAt)));
        const assignedIds = assignedIssueIds.map((r) => r.issueId);
        if (assignedIds.length === 0) return c.json({ issues: [], count: 0 });
        baseQuery = and(inArray(issues.id, assignedIds));
      } else {
        baseQuery = and(eq(issues.workspaceId, workspace.id), eq(issues.createdById, user.id), isNull(issues.archivedAt));
      }

      let stateFilter;
      switch (issueType) {
        case "completed":
          stateFilter = eq(states.group, "completed");
          break;
        case "overdue":
          stateFilter = and(not(inArray(states.group, ["completed", "cancelled"])), lt(issues.targetDate, now), isNull(issues.completedAt));
          break;
        case "upcoming":
          stateFilter = and(not(inArray(states.group, ["completed", "cancelled"])), gte(issues.startDate, now), isNull(issues.completedAt));
          break;
        default: // pending
          stateFilter = not(inArray(states.group, ["completed", "cancelled"]));
          break;
      }

      const matchingIssues = await db
        .select({
          id: issues.id,
          name: issues.name,
          priority: issues.priority,
          projectId: issues.projectId,
          stateId: issues.stateId,
          targetDate: issues.targetDate,
          startDate: issues.startDate,
          sequenceId: issues.sequenceId,
          sortOrder: issues.sortOrder,
          completedAt: issues.completedAt,
          createdAt: issues.createdAt,
        })
        .from(issues)
        .innerJoin(states, eq(states.id, issues.stateId))
        .where(and(baseQuery!, stateFilter))
        .orderBy(desc(issues.createdAt))
        .limit(20);

      return c.json({
        issues: matchingIssues.map((issue) => ({
          id: issue.id,
          name: issue.name,
          priority: issue.priority,
          project_id: issue.projectId,
          state_id: issue.stateId,
          target_date: issue.targetDate ? new Date(issue.targetDate as unknown as number * 1000).toISOString().split("T")[0] : null,
          start_date: issue.startDate ? new Date(issue.startDate as unknown as number * 1000).toISOString().split("T")[0] : null,
          sequence_id: issue.sequenceId,
          sort_order: issue.sortOrder,
          completed_at: issue.completedAt ? new Date(issue.completedAt as unknown as number * 1000).toISOString() : null,
          created_at: issue.createdAt ? new Date(issue.createdAt as unknown as number * 1000).toISOString() : null,
        })),
        count: matchingIssues.length,
      });
    }

    case "issues_by_state_groups": {
      const stateGroups = await db
        .select({
          group: states.group,
          count: count(),
        })
        .from(issues)
        .innerJoin(issueAssignees, eq(issueAssignees.issueId, issues.id))
        .innerJoin(states, eq(states.id, issues.stateId))
        .where(and(eq(issueAssignees.assigneeId, user.id), eq(issues.workspaceId, workspace.id), isNull(issues.archivedAt)))
        .groupBy(states.group);

      return c.json(
        stateGroups.map((sg) => ({
          state: sg.group,
          count: sg.count,
        }))
      );
    }

    case "issues_by_priority": {
      const priorityGroups = await db
        .select({
          priority: issues.priority,
          count: count(),
        })
        .from(issues)
        .innerJoin(issueAssignees, eq(issueAssignees.issueId, issues.id))
        .where(and(eq(issueAssignees.assigneeId, user.id), eq(issues.workspaceId, workspace.id), isNull(issues.archivedAt)))
        .groupBy(issues.priority);

      const priorityMap: Record<number, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" };
      return c.json(
        priorityGroups.map((pg) => ({
          priority: priorityMap[pg.priority ?? 0] ?? "none",
          count: pg.count,
        }))
      );
    }

    case "recent_activity": {
      const activities = await db.query.issueActivities.findMany({
        where: and(eq(issueActivities.actorId, user.id), eq(issueActivities.workspaceId, workspace.id)),
        orderBy: [desc(issueActivities.createdAt)],
        limit: 20,
      });

      return c.json(
        activities.map((a) => ({
          id: a.id,
          issue_id: a.issueId,
          project_id: a.projectId,
          workspace_id: a.workspaceId,
          actor_id: a.actorId,
          field: a.field,
          old_value: a.oldValue,
          new_value: a.newValue,
          verb: a.verb,
          created_at: a.createdAt ? new Date(a.createdAt as unknown as number * 1000).toISOString() : null,
        }))
      );
    }

    case "recent_projects": {
      // Return project IDs from recent visits
      const recentProjectVisits = await db.query.recentVisits.findMany({
        where: and(
          eq(recentVisits.userId, user.id),
          eq(recentVisits.workspaceId, workspace.id),
          eq(recentVisits.entityType, "project")
        ),
        orderBy: [desc(recentVisits.visitedAt)],
        limit: 5,
      });

      return c.json(recentProjectVisits.map((v) => v.entityId));
    }

    case "recent_collaborators": {
      const perPage = parseInt(c.req.query("per_page") || "10");
      const cursor = c.req.query("cursor") || `${perPage}:0:0`;
      const [, offsetStr] = cursor.split(":");
      const offset = parseInt(offsetStr || "0");

      // Find unique collaborators from issues assigned to user
      const collaborators = await db
        .select({
          userId: issueAssignees.assigneeId,
          count: count(),
        })
        .from(issueAssignees)
        .innerJoin(issues, eq(issues.id, issueAssignees.issueId))
        .where(and(eq(issues.workspaceId, workspace.id), isNull(issues.archivedAt)))
        .groupBy(issueAssignees.assigneeId)
        .orderBy(desc(count()))
        .limit(perPage)
        .offset(offset);

      return c.json(
        collaborators.map((c) => ({
          user_id: c.userId,
          active_issue_count: c.count,
        }))
      );
    }

    default:
      return c.json({ detail: `Unknown widget_key: ${widgetKey}` }, 400);
  }
});

// Analytics
workspaceRoutes.get("/:slug/analytics/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// Integrations
workspaceRoutes.get("/:slug/workspace-integrations/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.post("/:slug/workspace-integrations/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.delete("/:slug/workspace-integrations/:id/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// Webhooks

// Webhook validation schemas
const createWebhookSchema = z.object({
  url: z.string().url(),
  is_active: z.boolean().optional().default(true),
  project_event: z.boolean().optional().default(true),
  issue_event: z.boolean().optional().default(true),
  module_event: z.boolean().optional().default(false),
  cycle_event: z.boolean().optional().default(false),
  issue_comment_event: z.boolean().optional().default(false),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  is_active: z.boolean().optional(),
  project_event: z.boolean().optional(),
  issue_event: z.boolean().optional(),
  module_event: z.boolean().optional(),
  cycle_event: z.boolean().optional(),
  issue_comment_event: z.boolean().optional(),
});

// Helper to format webhook for API response
function formatWebhookResponse(webhook: typeof webhooks.$inferSelect) {
  return {
    id: webhook.id,
    url: webhook.url,
    is_active: webhook.isActive,
    secret_key: webhook.secretKey,
    project_event: webhook.projectEvent,
    issue_event: webhook.issueEvent,
    module_event: webhook.moduleEvent,
    cycle_event: webhook.cycleEvent,
    issue_comment_event: webhook.issueCommentEvent,
    workspace_id: webhook.workspaceId,
    created_by_id: webhook.createdById,
    created_at: webhook.createdAt?.toISOString(),
    updated_at: webhook.updatedAt?.toISOString(),
  };
}

// Helper to generate a secure secret key
function generateSecretKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// GET /api/workspaces/:slug/webhooks/ - List all webhooks
workspaceRoutes.get(
  "/:slug/webhooks/",
  workspaceMiddleware,
  requireWorkspaceAdmin,
  async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const webhookList = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.workspaceId, workspace.id))
      .orderBy(desc(webhooks.createdAt));

    return c.json(webhookList.map(formatWebhookResponse));
  }
);

// POST /api/workspaces/:slug/webhooks/ - Create a webhook
workspaceRoutes.post(
  "/:slug/webhooks/",
  workspaceMiddleware,
  requireWorkspaceAdmin,
  zValidator("json", createWebhookSchema),
  async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const body = c.req.valid("json");

    // Check for duplicate URL in the same workspace
    const existing = await db.query.webhooks.findFirst({
      where: and(
        eq(webhooks.url, body.url),
        eq(webhooks.workspaceId, workspace.id)
      ),
    });

    if (existing) {
      return c.json({ url: ["A webhook with this URL already exists."] }, 400);
    }

    const secretKey = generateSecretKey();

    const result = await db
      .insert(webhooks)
      .values({
        id: createId(),
        workspaceId: workspace.id,
        url: body.url,
        secretKey,
        isActive: body.is_active ?? true,
        projectEvent: body.project_event ?? true,
        issueEvent: body.issue_event ?? true,
        moduleEvent: body.module_event ?? false,
        cycleEvent: body.cycle_event ?? false,
        issueCommentEvent: body.issue_comment_event ?? false,
        createdById: user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return c.json(formatWebhookResponse(result[0]!), 201);
  }
);

// GET /api/workspaces/:slug/webhooks/:webhookId/ - Get a single webhook
workspaceRoutes.get(
  "/:slug/webhooks/:webhookId/",
  workspaceMiddleware,
  requireWorkspaceAdmin,
  async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const webhookId = c.req.param("webhookId");

    const webhook = await db.query.webhooks.findFirst({
      where: and(
        eq(webhooks.id, webhookId),
        eq(webhooks.workspaceId, workspace.id)
      ),
    });

    if (!webhook) {
      return c.json({ detail: "Webhook not found." }, 404);
    }

    return c.json(formatWebhookResponse(webhook));
  }
);

// PATCH /api/workspaces/:slug/webhooks/:webhookId/ - Update a webhook
workspaceRoutes.patch(
  "/:slug/webhooks/:webhookId/",
  workspaceMiddleware,
  requireWorkspaceAdmin,
  zValidator("json", updateWebhookSchema),
  async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const webhookId = c.req.param("webhookId");
    const body = c.req.valid("json");

    const existing = await db.query.webhooks.findFirst({
      where: and(
        eq(webhooks.id, webhookId),
        eq(webhooks.workspaceId, workspace.id)
      ),
    });

    if (!existing) {
      return c.json({ detail: "Webhook not found." }, 404);
    }

    // Check for duplicate URL if updating
    if (body.url && body.url !== existing.url) {
      const duplicate = await db.query.webhooks.findFirst({
        where: and(
          eq(webhooks.url, body.url),
          eq(webhooks.workspaceId, workspace.id),
          not(eq(webhooks.id, webhookId))
        ),
      });

      if (duplicate) {
        return c.json({ url: ["A webhook with this URL already exists."] }, 400);
      }
    }

    const updateData: Partial<typeof webhooks.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.url !== undefined) updateData.url = body.url;
    if (body.is_active !== undefined) updateData.isActive = body.is_active;
    if (body.project_event !== undefined) updateData.projectEvent = body.project_event;
    if (body.issue_event !== undefined) updateData.issueEvent = body.issue_event;
    if (body.module_event !== undefined) updateData.moduleEvent = body.module_event;
    if (body.cycle_event !== undefined) updateData.cycleEvent = body.cycle_event;
    if (body.issue_comment_event !== undefined) updateData.issueCommentEvent = body.issue_comment_event;

    await db
      .update(webhooks)
      .set(updateData)
      .where(eq(webhooks.id, webhookId));

    const updated = await db.query.webhooks.findFirst({
      where: eq(webhooks.id, webhookId),
    });

    return c.json(formatWebhookResponse(updated!));
  }
);

// DELETE /api/workspaces/:slug/webhooks/:webhookId/ - Delete a webhook
workspaceRoutes.delete(
  "/:slug/webhooks/:webhookId/",
  workspaceMiddleware,
  requireWorkspaceAdmin,
  async (c) => {
    const workspace = c.get("workspace");
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const webhookId = c.req.param("webhookId");

    const webhook = await db.query.webhooks.findFirst({
      where: and(
        eq(webhooks.id, webhookId),
        eq(webhooks.workspaceId, workspace.id)
      ),
    });

    if (!webhook) {
      return c.json({ detail: "Webhook not found." }, 404);
    }

    await db.delete(webhooks).where(eq(webhooks.id, webhookId));

    return new Response(null, { status: 204 });
  }
);

// Import/Export
workspaceRoutes.get("/:slug/importers/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.post("/:slug/importers/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.get("/:slug/export-issues/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// AI
workspaceRoutes.post("/:slug/ai-assistant/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.post("/:slug/rephrase-grammar/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// ===========================
// Section: User Activity
// ===========================

workspaceRoutes.get("/:slug/user-activity/:userId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const targetUserId = c.req.param("userId");

  // Pagination params
  const perPage = Math.min(parseInt(c.req.query("per_page") || "10", 10) || 10, 1000);
  const cursorParam = c.req.query("cursor") || "0:0:0";
  const [cursorLimit, cursorOffsetStr] = cursorParam.split(":");
  const offset = parseInt(cursorOffsetStr || "0", 10) || 0;

  // Optional project filter
  const projectFilter = c.req.queries("project") ?? [];

  // Get projects the requesting user is a member of (active, non-archived)
  const memberProjects = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(
      and(
        eq(projectMembers.memberId, user.id),
        eq(projectMembers.isActive, true),
        isNull(projects.archivedAt)
      )
    );

  const memberProjectIds = memberProjects.map((p) => p.projectId);
  if (memberProjectIds.length === 0) {
    return c.json({
      grouped_by: null,
      sub_grouped_by: null,
      total_count: 0,
      next_cursor: `${perPage}:${perPage}:0`,
      prev_cursor: `${perPage}:0:0`,
      next_page_results: false,
      prev_page_results: false,
      count: 0,
      total_pages: 0,
      total_results: 0,
      extra_stats: null,
      results: [],
    });
  }

  // Apply project filter if provided
  const filteredProjectIds =
    projectFilter.length > 0
      ? memberProjectIds.filter((id) => projectFilter.includes(id))
      : memberProjectIds;

  if (filteredProjectIds.length === 0) {
    return c.json({
      grouped_by: null,
      sub_grouped_by: null,
      total_count: 0,
      next_cursor: `${perPage}:${perPage}:0`,
      prev_cursor: `${perPage}:0:0`,
      next_page_results: false,
      prev_page_results: false,
      count: 0,
      total_pages: 0,
      total_results: 0,
      extra_stats: null,
      results: [],
    });
  }

  // Excluded fields (matching Django: comment, vote, reaction, draft)
  const excludedFields = ["comment", "vote", "reaction", "draft"];

  // Count total
  const [totalRow] = await db
    .select({ count: count() })
    .from(issueActivities)
    .where(
      and(
        eq(issueActivities.workspaceId, workspace.id),
        eq(issueActivities.actorId, targetUserId),
        inArray(issueActivities.projectId, filteredProjectIds),
        not(inArray(issueActivities.field, excludedFields))
      )
    );
  const totalCount = totalRow?.count ?? 0;

  // Fetch paginated activities
  const activities = await db.query.issueActivities.findMany({
    where: and(
      eq(issueActivities.workspaceId, workspace.id),
      eq(issueActivities.actorId, targetUserId),
      inArray(issueActivities.projectId, filteredProjectIds),
      not(inArray(issueActivities.field, excludedFields))
    ),
    orderBy: [desc(issueActivities.createdAt)],
    limit: perPage,
    offset,
    with: {
      actor: true,
      issue: true,
      project: true,
      workspace: true,
    },
  });

  const hasNext = offset + perPage < totalCount;
  const hasPrev = offset > 0;
  const nextOffset = offset + perPage;
  const prevOffset = Math.max(0, offset - perPage);
  const totalPages = Math.ceil(totalCount / perPage);

  const results = activities.map((a: any) => ({
    id: a.id,
    issue: a.issueId,
    verb: a.verb,
    field: a.field ?? null,
    old_value: a.oldValue ?? null,
    new_value: a.newValue ?? null,
    old_identifier: a.oldIdentifier ?? null,
    new_identifier: a.newIdentifier ?? null,
    epoch: a.epochTimestamp ?? null,
    actor: a.actorId,
    project: a.projectId,
    workspace: a.workspaceId,
    created_at: a.createdAt?.toISOString() ?? null,
    updated_at: a.createdAt?.toISOString() ?? null,
    actor_detail: a.actor
      ? {
          id: a.actor.id,
          first_name: a.actor.firstName ?? a.actor.name?.split(" ")[0] ?? "",
          last_name: a.actor.lastName ?? a.actor.name?.split(" ").slice(1).join(" ") ?? "",
          avatar: a.actor.avatar ?? a.actor.image ?? "",
          avatar_url: a.actor.avatar ?? a.actor.image ?? "",
          display_name: a.actor.displayName ?? a.actor.name ?? "",
          is_bot: false,
        }
      : null,
    issue_detail: a.issue
      ? {
          id: a.issue.id,
          name: a.issue.name,
          description_html: a.issue.descriptionHtml ?? "",
          priority: a.issue.priority ?? 0,
          sequence_id: a.issue.sequenceId ?? null,
          sort_order: a.issue.sortOrder ?? 65535,
          is_draft: false,
        }
      : null,
    project_detail: a.project
      ? {
          id: a.project.id,
          identifier: a.project.identifier,
          name: a.project.name,
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
    total_count: totalCount,
    next_cursor: `${perPage}:${nextOffset}:0`,
    prev_cursor: `${perPage}:${prevOffset}:0`,
    next_page_results: hasNext,
    prev_page_results: hasPrev,
    count: results.length,
    total_pages: totalPages,
    total_results: totalCount,
    extra_stats: null,
    results,
  });
});

// ===========================
// Section: User Profile Stats
// ===========================

workspaceRoutes.get("/:slug/user-stats/:userId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const targetUserId = c.req.param("userId");

  // Get projects the requesting user is an active member of (non-archived)
  const memberProjects = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projectMembers.memberId, user.id),
        eq(projectMembers.isActive, true),
        eq(projects.workspaceId, workspace.id),
        isNull(projects.archivedAt)
      )
    );

  const memberProjectIds = memberProjects.map((p) => p.projectId);

  if (memberProjectIds.length === 0) {
    return c.json({
      state_distribution: [],
      priority_distribution: [],
      created_issues: 0,
      assigned_issues: 0,
      completed_issues: 0,
      pending_issues: 0,
      subscribed_issues: 0,
      present_cycles: [],
      upcoming_cycles: [],
    });
  }

  // Priority integer-to-string mapping (matching Django's string priority values)
  const priorityNames: Record<number, string> = {
    0: "none",
    1: "urgent",
    2: "high",
    3: "medium",
    4: "low",
  };

  const priorityOrder: Record<string, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
    none: 4,
  };

  // Base condition: issues assigned to target user in workspace projects the requesting user can see
  // Issues must not be deleted and assignee must not be soft-deleted
  const assignedIssuesBase = db
    .select({ issueId: issues.id, stateId: issues.stateId, priority: issues.priority })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(issueAssignees.assigneeId, targetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  // State distribution: count issues grouped by state group
  const stateDistribution = await db
    .select({
      state_group: states.group,
      state_count: count(),
    })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        eq(issueAssignees.assigneeId, targetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    )
    .groupBy(states.group)
    .orderBy(states.group);

  // Priority distribution: count issues grouped by priority
  const priorityDistributionRaw = await db
    .select({
      priority: issues.priority,
      priority_count: count(),
    })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(issueAssignees.assigneeId, targetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    )
    .groupBy(issues.priority);

  // Map integer priorities to string names and sort by priority order
  const priorityDistribution = priorityDistributionRaw
    .filter((p) => p.priority_count >= 1)
    .map((p) => ({
      priority: priorityNames[p.priority ?? 0] ?? "none",
      priority_count: p.priority_count,
    }))
    .sort((a, b) => (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99));

  // Created issues count
  const [createdResult] = await db
    .select({ count: count() })
    .from(issues)
    .where(
      and(
        eq(issues.createdById, targetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  // Assigned issues count
  const [assignedResult] = await db
    .select({ count: count() })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(issueAssignees.assigneeId, targetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  // Completed issues count (state group = 'completed')
  const [completedResult] = await db
    .select({ count: count() })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        eq(issueAssignees.assigneeId, targetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        eq(states.group, "completed"),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  // Pending issues count (state group NOT in 'completed', 'cancelled')
  const [pendingResult] = await db
    .select({ count: count() })
    .from(issues)
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        eq(issueAssignees.assigneeId, targetUserId),
        eq(issues.workspaceId, workspace.id),
        inArray(issues.projectId, memberProjectIds),
        not(inArray(states.group, ["completed", "cancelled"])),
        isNull(issues.deletedAt),
        isNull(issues.archivedAt)
      )
    );

  // Subscribed issues count
  const [subscribedResult] = await db
    .select({ count: count() })
    .from(issueSubscribers)
    .innerJoin(projects, eq(issueSubscribers.projectId, projects.id))
    .where(
      and(
        eq(issueSubscribers.subscriberId, targetUserId),
        eq(issueSubscribers.workspaceId, workspace.id),
        inArray(issueSubscribers.projectId, memberProjectIds),
        isNull(projects.archivedAt)
      )
    );

  const now = new Date();

  // Present cycles: cycles where start_date < now < end_date, with issues assigned to target user
  const presentCyclesRaw = await db
    .select({
      cycle__name: cycles.name,
      cycle__id: cycles.id,
      cycle__project_id: cycles.projectId,
    })
    .from(cycleIssues)
    .innerJoin(cycles, eq(cycleIssues.cycleId, cycles.id))
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(cycles.workspaceId, workspace.id),
        lt(cycles.startDate, now),
        gt(cycles.endDate, now),
        eq(issueAssignees.assigneeId, targetUserId)
      )
    )
    .groupBy(cycles.id, cycles.name, cycles.projectId);

  // Upcoming cycles: cycles where start_date > now, with issues assigned to target user
  const upcomingCyclesRaw = await db
    .select({
      cycle__name: cycles.name,
      cycle__id: cycles.id,
      cycle__project_id: cycles.projectId,
    })
    .from(cycleIssues)
    .innerJoin(cycles, eq(cycleIssues.cycleId, cycles.id))
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        eq(cycles.workspaceId, workspace.id),
        gt(cycles.startDate, now),
        eq(issueAssignees.assigneeId, targetUserId)
      )
    )
    .groupBy(cycles.id, cycles.name, cycles.projectId);

  return c.json({
    state_distribution: stateDistribution,
    priority_distribution: priorityDistribution,
    created_issues: createdResult?.count ?? 0,
    assigned_issues: assignedResult?.count ?? 0,
    completed_issues: completedResult?.count ?? 0,
    pending_issues: pendingResult?.count ?? 0,
    subscribed_issues: subscribedResult?.count ?? 0,
    present_cycles: presentCyclesRaw,
    upcoming_cycles: upcomingCyclesRaw,
  });
});

// ===========================
// Section: User Profile (project segregation)
// ===========================

workspaceRoutes.get("/:slug/user-profile/:userId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const targetUserId = c.req.param("userId");

  // Fetch the target user
  const userData = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
  });
  if (!userData) return c.json({ detail: "User not found." }, 404);

  // Fetch user profile for timezone
  const profile = await db.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, targetUserId),
  });

  // Check requesting user's workspace membership role
  const membership = c.get("workspaceMembership");
  let projectData: any[] = [];

  if (membership && membership.role >= 15) {
    // Get projects the requesting user is an active member of (non-archived)
    const memberProjects = await db
      .select()
      .from(projects)
      .innerJoin(projectMembers, eq(projects.id, projectMembers.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspace.id),
          eq(projectMembers.memberId, user.id),
          eq(projectMembers.isActive, true),
          isNull(projects.archivedAt)
        )
      );

    if (memberProjects.length > 0) {
      const projectIds = memberProjects.map((p) => p.projects.id);

      // For each project, compute issue stats for the target user
      // Get all issues in these projects
      const allProjectIssues = await db
        .select({
          id: issues.id,
          projectId: issues.projectId,
          createdById: issues.createdById,
          completedAt: issues.completedAt,
          stateId: issues.stateId,
        })
        .from(issues)
        .where(
          and(
            inArray(issues.projectId, projectIds),
            isNull(issues.archivedAt),
            isNull(issues.deletedAt)
          )
        );

      // Get all assignees for these issues
      const issueIds = allProjectIssues.map((i) => i.id);
      const allAssigneeRows = issueIds.length > 0
        ? await db.select().from(issueAssignees).where(inArray(issueAssignees.issueId, issueIds))
        : [];

      // Build assignee map: issueId -> Set of assigneeIds
      const assigneeMap = new Map<string, Set<string>>();
      for (const a of allAssigneeRows) {
        if (!assigneeMap.has(a.issueId)) assigneeMap.set(a.issueId, new Set());
        assigneeMap.get(a.issueId)!.add(a.assigneeId);
      }

      // Get all state groups
      const allStates = await db
        .select({ id: states.id, group: states.group })
        .from(states)
        .where(inArray(states.projectId, projectIds));

      const stateGroupMap = new Map<string, string>();
      for (const s of allStates) {
        stateGroupMap.set(s.id, s.group);
      }

      // Compute per-project stats
      const statsMap = new Map<string, { created: number; assigned: number; completed: number; pending: number }>();
      for (const pid of projectIds) {
        statsMap.set(pid, { created: 0, assigned: 0, completed: 0, pending: 0 });
      }

      for (const issue of allProjectIssues) {
        const stats = statsMap.get(issue.projectId);
        if (!stats) continue;

        // Created by target user
        if (issue.createdById === targetUserId) {
          stats.created++;
        }

        // Assigned to target user
        const assignees = assigneeMap.get(issue.id);
        if (assignees?.has(targetUserId)) {
          stats.assigned++;

          // Completed (assigned to target user and completed)
          if (issue.completedAt) {
            stats.completed++;
          }

          // Pending (assigned to target user with state in backlog/unstarted/started)
          const stateGroup = issue.stateId ? stateGroupMap.get(issue.stateId) : null;
          if (stateGroup && ["backlog", "unstarted", "started"].includes(stateGroup)) {
            stats.pending++;
          }
        }
      }

      projectData = projectIds.map((pid) => {
        const proj = memberProjects.find((p) => p.projects.id === pid)?.projects;
        const stats = statsMap.get(pid)!;
        return {
          id: pid,
          logo_props: proj?.logoProps ?? null,
          created_issues: stats.created,
          assigned_issues: stats.assigned,
          completed_issues: stats.completed,
          pending_issues: stats.pending,
        };
      });
    }
  }

  return c.json({
    project_data: projectData,
    user_data: {
      email: userData.email,
      first_name: userData.firstName ?? "",
      last_name: userData.lastName ?? "",
      avatar_url: userData.avatar ?? "",
      cover_image_url: userData.coverImage ?? "",
      date_joined: userData.createdAt?.toISOString() ?? null,
      user_timezone: profile?.timezone ?? "UTC",
      display_name: userData.displayName ?? userData.name ?? "",
    },
  });
});

// ===========================
// Section: User Issues (profile issues)
// ===========================

// Helper: format an issue for the profile issues response (same as issues route)
interface IssueExtra {
  assigneeIds: string[];
  labelIds: string[];
  moduleIds: string[];
  cycleId: string | null;
  subIssuesCount: number;
  attachmentCount: number;
  linkCount: number;
  stateGroup: string | null;
}

function formatIssueForProfile(
  issue: typeof issues.$inferSelect,
  extra: IssueExtra
) {
  return {
    id: issue.id,
    project_id: issue.projectId,
    workspace_id: issue.workspaceId,
    parent_id: issue.parentId ?? null,
    state_id: issue.stateId ?? null,
    state__group: extra.stateGroup ?? "backlog",
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
    assignee_ids: extra.assigneeIds,
    label_ids: extra.labelIds,
    module_ids: extra.moduleIds,
    cycle_id: extra.cycleId,
    sub_issues_count: extra.subIssuesCount,
    attachment_count: extra.attachmentCount,
    link_count: extra.linkCount,
    created_by: issue.createdById ?? null,
    updated_by: issue.updatedById ?? null,
    created_at: issue.createdAt?.toISOString() ?? null,
    updated_at: issue.updatedAt?.toISOString() ?? null,
  };
}

workspaceRoutes.get("/:slug/user-issues/:userId/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const targetUserId = c.req.param("userId");
  const query = c.req.query();

  // Pagination
  const cursorParam = query.cursor || `${query.per_page || "100"}:0:0`;
  const orderBy = query.order_by || "-created_at";
  const groupBy = query.group_by || null;
  const subGroupBy = query.sub_group_by || null;
  const subIssue = query.sub_issue !== "false";

  const cursorParts = cursorParam.split(":");
  const perPage = Math.min(parseInt(cursorParts[0] || "100") || 100, 1000);
  const pageNumber = parseInt(cursorParts[1] || "0") || 0;
  const offset = pageNumber * perPage;

  // Parse filters
  let filters: Record<string, any> = {};
  try {
    if (query.filters) filters = JSON.parse(query.filters);
  } catch {}

  // Get projects the requesting user is an active member of
  const memberProjects = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projectMembers.memberId, user.id),
        eq(projectMembers.isActive, true),
        eq(projects.workspaceId, workspace.id),
        isNull(projects.archivedAt)
      )
    );

  const memberProjectIds = memberProjects.map((p) => p.projectId);

  if (memberProjectIds.length === 0) {
    return c.json({
      grouped_by: groupBy,
      sub_grouped_by: subGroupBy ?? null,
      total_count: 0,
      next_cursor: `${perPage}:1:0`,
      prev_cursor: `${perPage}:0:0`,
      next_page_results: false,
      prev_page_results: false,
      count: 0,
      total_pages: 0,
      extra_stats: null,
      results: groupBy ? {} : [],
    });
  }

  // Step 1: Find issue IDs where target user is assigned, created, or subscribed
  const [assignedIssueIds, createdIssueIds, subscribedIssueIds] = await Promise.all([
    db.select({ issueId: issueAssignees.issueId }).from(issueAssignees)
      .innerJoin(issues, eq(issueAssignees.issueId, issues.id))
      .where(
        and(
          eq(issueAssignees.assigneeId, targetUserId),
          eq(issues.workspaceId, workspace.id),
          isNull(issues.deletedAt)
        )
      ),
    db.select({ id: issues.id }).from(issues)
      .where(
        and(
          eq(issues.createdById, targetUserId),
          eq(issues.workspaceId, workspace.id),
          isNull(issues.deletedAt)
        )
      ),
    db.select({ issueId: issueSubscribers.issueId }).from(issueSubscribers)
      .where(
        and(
          eq(issueSubscribers.subscriberId, targetUserId),
          eq(issueSubscribers.workspaceId, workspace.id)
        )
      ),
  ]);

  const relevantIssueIdSet = new Set<string>();
  for (const r of assignedIssueIds) relevantIssueIdSet.add(r.issueId);
  for (const r of createdIssueIds) relevantIssueIdSet.add(r.id);
  for (const r of subscribedIssueIds) relevantIssueIdSet.add(r.issueId);

  const relevantIssueIds = [...relevantIssueIdSet];

  if (relevantIssueIds.length === 0) {
    return c.json({
      grouped_by: groupBy,
      sub_grouped_by: subGroupBy ?? null,
      total_count: 0,
      next_cursor: `${perPage}:1:0`,
      prev_cursor: `${perPage}:0:0`,
      next_page_results: false,
      prev_page_results: false,
      count: 0,
      total_pages: 0,
      extra_stats: null,
      results: groupBy ? {} : [],
    });
  }

  // Step 2: Build conditions for filtering
  const conditions: ReturnType<typeof eq>[] = [
    inArray(issues.id, relevantIssueIds),
    inArray(issues.projectId, memberProjectIds),
    isNull(issues.deletedAt),
    isNull(issues.archivedAt),
  ];

  if (!subIssue) {
    conditions.push(isNull(issues.parentId));
  }

  // Legacy query param filters
  if (query.state) {
    conditions.push(inArray(issues.stateId, query.state.split(",")));
  }
  if (query.priority) {
    conditions.push(inArray(issues.priority, query.priority.split(",").map(Number)));
  }
  if (query.created_by) {
    conditions.push(inArray(issues.createdById, query.created_by.split(",")));
  }
  if (query.start_date) {
    conditions.push(gte(issues.startDate, new Date(query.start_date)));
  }
  if (query.target_date) {
    conditions.push(lte(issues.targetDate, new Date(query.target_date)));
  }
  if (query.search) {
    conditions.push(like(issues.name, `%${query.search}%`));
  }

  // JSON filters
  if (filters.state) {
    conditions.push(inArray(issues.stateId, filters.state));
  }
  if (filters.priority) {
    conditions.push(inArray(issues.priority, filters.priority.map(Number)));
  }

  // Sort
  const isDescOrder = orderBy.startsWith("-");
  const sortField = isDescOrder ? orderBy.slice(1) : orderBy;
  const sortFn = isDescOrder ? desc : asc;

  let sortColumn: ReturnType<typeof asc>;
  switch (sortField) {
    case "created_at": sortColumn = sortFn(issues.createdAt); break;
    case "updated_at": sortColumn = sortFn(issues.updatedAt); break;
    case "priority": sortColumn = sortFn(issues.priority); break;
    case "sort_order": sortColumn = sortFn(issues.sortOrder); break;
    case "sequence_id": sortColumn = sortFn(issues.sequenceId); break;
    case "name": sortColumn = sortFn(issues.name); break;
    case "start_date": sortColumn = sortFn(issues.startDate); break;
    case "target_date": sortColumn = sortFn(issues.targetDate); break;
    default: sortColumn = sortFn(issues.createdAt);
  }

  // Fetch matching issues
  const allIssues = await db
    .select()
    .from(issues)
    .where(and(...conditions))
    .orderBy(sortColumn);

  // Post-filter by assignees/labels (junction tables)
  let filteredIssues = allIssues;
  if (query.assignees || filters.assignees) {
    const filterAssigneeIds = (query.assignees || "").split(",").filter(Boolean);
    if (filters.assignees) filterAssigneeIds.push(...filters.assignees);
    if (filterAssigneeIds.length > 0) {
      const matchingIssueIds = await db
        .select({ issueId: issueAssignees.issueId })
        .from(issueAssignees)
        .where(
          and(
            inArray(issueAssignees.issueId, allIssues.map((i) => i.id)),
            inArray(issueAssignees.assigneeId, filterAssigneeIds)
          )
        );
      const matchSet = new Set(matchingIssueIds.map((m) => m.issueId));
      filteredIssues = filteredIssues.filter((i) => matchSet.has(i.id));
    }
  }
  if (query.labels || filters.labels) {
    const filterLabelIds = (query.labels || "").split(",").filter(Boolean);
    if (filters.labels) filterLabelIds.push(...filters.labels);
    if (filterLabelIds.length > 0) {
      const matchingIssueIds = await db
        .select({ issueId: issueLabels.issueId })
        .from(issueLabels)
        .where(
          and(
            inArray(issueLabels.issueId, filteredIssues.map((i) => i.id)),
            inArray(issueLabels.labelId, filterLabelIds)
          )
        );
      const matchSet = new Set(matchingIssueIds.map((m) => m.issueId));
      filteredIssues = filteredIssues.filter((i) => matchSet.has(i.id));
    }
  }

  const totalCount = filteredIssues.length;
  const allIds = filteredIssues.map((i) => i.id);

  // Batch fetch extra data
  const [allAssigneeRows, allLabelRows, allModuleRows, allCycleRows, allStateRows, subIssueCounts, attachmentCounts, linkCounts] = await Promise.all([
    allIds.length > 0
      ? db.select().from(issueAssignees).where(inArray(issueAssignees.issueId, allIds))
      : [],
    allIds.length > 0
      ? db.select().from(issueLabels).where(inArray(issueLabels.issueId, allIds))
      : [],
    allIds.length > 0
      ? db.select().from(moduleIssues).where(inArray(moduleIssues.issueId, allIds))
      : [],
    allIds.length > 0
      ? db.select().from(cycleIssues).where(inArray(cycleIssues.issueId, allIds))
      : [],
    // All state groups across workspace projects
    db.select({ id: states.id, group: states.group }).from(states)
      .where(eq(states.workspaceId, workspace.id)),
    allIds.length > 0
      ? db.select({ parentId: issues.parentId, count: countFn() }).from(issues)
          .where(and(inArray(issues.parentId, allIds), isNull(issues.deletedAt)))
          .groupBy(issues.parentId)
      : [],
    allIds.length > 0
      ? db.select({ issueId: issueAttachments.issueId, count: countFn() }).from(issueAttachments)
          .where(inArray(issueAttachments.issueId, allIds))
          .groupBy(issueAttachments.issueId)
      : [],
    allIds.length > 0
      ? db.select({ issueId: issueLinks.issueId, count: countFn() }).from(issueLinks)
          .where(inArray(issueLinks.issueId, allIds))
          .groupBy(issueLinks.issueId)
      : [],
  ]);

  // Build lookup maps
  const assigneeMap = new Map<string, string[]>();
  for (const a of allAssigneeRows) {
    const arr = assigneeMap.get(a.issueId) ?? [];
    arr.push(a.assigneeId);
    assigneeMap.set(a.issueId, arr);
  }

  const labelMap = new Map<string, string[]>();
  for (const l of allLabelRows) {
    const arr = labelMap.get(l.issueId) ?? [];
    arr.push(l.labelId);
    labelMap.set(l.issueId, arr);
  }

  const mModuleMap = new Map<string, string[]>();
  for (const m of allModuleRows) {
    const arr = mModuleMap.get(m.issueId) ?? [];
    arr.push(m.moduleId);
    mModuleMap.set(m.issueId, arr);
  }

  const cycleMap = new Map<string, string>();
  for (const cy of allCycleRows) {
    cycleMap.set(cy.issueId, cy.cycleId);
  }

  const stateGroupMap = new Map<string, string>();
  for (const s of allStateRows) {
    stateGroupMap.set(s.id, s.group);
  }

  const subIssueCountMap = new Map<string, number>();
  for (const s of subIssueCounts) {
    if (s.parentId) subIssueCountMap.set(s.parentId, s.count);
  }

  const attachmentCountMap = new Map<string, number>();
  for (const a of attachmentCounts) {
    attachmentCountMap.set(a.issueId, a.count);
  }

  const linkCountMap = new Map<string, number>();
  for (const l of linkCounts) {
    linkCountMap.set(l.issueId, l.count);
  }

  // Format all issues
  const formattedIssues = filteredIssues.map((i) =>
    formatIssueForProfile(i, {
      assigneeIds: assigneeMap.get(i.id) ?? [],
      labelIds: labelMap.get(i.id) ?? [],
      moduleIds: mModuleMap.get(i.id) ?? [],
      cycleId: cycleMap.get(i.id) ?? null,
      subIssuesCount: subIssueCountMap.get(i.id) ?? 0,
      attachmentCount: attachmentCountMap.get(i.id) ?? 0,
      linkCount: linkCountMap.get(i.id) ?? 0,
      stateGroup: i.stateId ? stateGroupMap.get(i.stateId) ?? null : null,
    })
  );

  // Pagination
  const totalPages = Math.ceil(totalCount / perPage);
  const nextPageExists = pageNumber + 1 < totalPages;
  const prevPageExists = pageNumber > 0;
  const nextCursor = `${perPage}:${pageNumber + 1}:0`;
  const prevCursor = `${perPage}:${pageNumber > 0 ? pageNumber - 1 : 0}:0`;

  // Grouping helper
  function getGroupKey(issue: ReturnType<typeof formatIssueForProfile>, field: string): string[] {
    switch (field) {
      case "state_id": return [issue.state_id ?? "None"];
      case "state__group": return [issue.state__group ?? "backlog"];
      case "priority": return [String(issue.priority)];
      case "created_by": return [issue.created_by ?? "None"];
      case "assignees__id": return issue.assignee_ids.length > 0 ? issue.assignee_ids : ["None"];
      case "labels__id": return issue.label_ids.length > 0 ? issue.label_ids : ["None"];
      case "issue_module__module_id": return issue.module_ids.length > 0 ? issue.module_ids : ["None"];
      case "cycle_id": return [issue.cycle_id ?? "None"];
      case "project_id": return [issue.project_id];
      case "target_date": return [issue.target_date ?? "None"];
      case "start_date": return [issue.start_date ?? "None"];
      default: return ["None"];
    }
  }

  if (groupBy) {
    const grouped: Record<string, { results: ReturnType<typeof formatIssueForProfile>[]; total_results: number }> = {};

    for (const issue of formattedIssues) {
      const keys = getGroupKey(issue, groupBy);
      for (const key of keys) {
        if (!grouped[key]) grouped[key] = { results: [], total_results: 0 };
        grouped[key].results.push(issue);
        grouped[key].total_results++;
      }
    }

    for (const key of Object.keys(grouped)) {
      grouped[key].results = grouped[key].results.slice(offset, offset + perPage);
    }

    if (subGroupBy) {
      if (groupBy === subGroupBy) {
        return c.json({ error: "Group by and sub group by cannot have same parameters" }, 400);
      }

      const nestedGrouped: Record<string, { results: Record<string, { results: ReturnType<typeof formatIssueForProfile>[]; total_results: number }>; total_results: number }> = {};

      for (const [groupKey, groupData] of Object.entries(grouped)) {
        const subGroups: Record<string, { results: ReturnType<typeof formatIssueForProfile>[]; total_results: number }> = {};
        for (const issue of groupData.results) {
          const subKeys = getGroupKey(issue, subGroupBy);
          for (const subKey of subKeys) {
            if (!subGroups[subKey]) subGroups[subKey] = { results: [], total_results: 0 };
            subGroups[subKey].results.push(issue);
            subGroups[subKey].total_results++;
          }
        }
        nestedGrouped[groupKey] = { results: subGroups, total_results: groupData.total_results };
      }

      return c.json({
        grouped_by: groupBy,
        sub_grouped_by: subGroupBy,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        next_page_results: nextPageExists,
        prev_page_results: prevPageExists,
        total_count: totalCount,
        count: formattedIssues.length,
        total_pages: totalPages,
        extra_stats: null,
        results: nestedGrouped,
      });
    }

    return c.json({
      grouped_by: groupBy,
      next_cursor: nextCursor,
      prev_cursor: prevCursor,
      next_page_results: nextPageExists,
      prev_page_results: prevPageExists,
      total_count: totalCount,
      count: formattedIssues.length,
      total_pages: totalPages,
      extra_stats: null,
      results: grouped,
    });
  }

  // Ungrouped: apply pagination
  const paginatedIssues = formattedIssues.slice(offset, offset + perPage);

  return c.json({
    grouped_by: null,
    sub_grouped_by: null,
    total_count: totalCount,
    next_cursor: nextCursor,
    prev_cursor: prevCursor,
    next_page_results: nextPageExists,
    prev_page_results: prevPageExists,
    count: paginatedIssues.length,
    total_pages: totalPages,
    extra_stats: null,
    results: paginatedIssues,
  });
});

// GET /:slug/estimates/ - Get all workspace estimates (estimates linked to projects in this workspace)
workspaceRoutes.get("/:slug/estimates/", workspaceMiddleware, async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Not found." }, 404);

  // Get all project estimate IDs in this workspace
  const projectEstimates = await db
    .select({ estimateId: projects.estimateId })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspace.id),
        isNotNull(projects.estimateId)
      )
    );

  const estimateIds = projectEstimates
    .map((p) => p.estimateId)
    .filter((id): id is string => id !== null);

  if (estimateIds.length === 0) {
    return c.json([]);
  }

  const estimateList = await db.query.estimates.findMany({
    where: and(
      inArray(estimates.id, estimateIds),
      eq(estimates.workspaceId, workspace.id)
    ),
    orderBy: [asc(estimates.name)],
  });

  const allPoints = await db.query.estimatePoints.findMany({
    where: inArray(estimatePoints.estimateId, estimateIds),
    orderBy: [asc(estimatePoints.key)],
  });

  const pointsByEstimate = new Map<string, (typeof allPoints)[number][]>();
  for (const point of allPoints) {
    const existing = pointsByEstimate.get(point.estimateId) ?? [];
    existing.push(point);
    pointsByEstimate.set(point.estimateId, existing);
  }

  const results = estimateList.map((e) => ({
    id: e.id,
    project_id: e.projectId,
    workspace_id: e.workspaceId,
    name: e.name,
    description: e.description ?? "",
    type: e.type ?? "categories",
    created_by_id: e.createdById ?? null,
    created_at: e.createdAt?.toISOString() ?? null,
    updated_at: e.updatedAt?.toISOString() ?? null,
    points: (pointsByEstimate.get(e.id) ?? []).map((p) => ({
      id: p.id,
      estimate_id: p.estimateId,
      key: p.key,
      value: p.value,
      description: p.description ?? "",
      created_at: p.createdAt?.toISOString() ?? null,
      updated_at: p.updatedAt?.toISOString() ?? null,
    })),
  }));

  return c.json(results);
});

// GET /:slug/work-items/:identifier/ - Get issue by project identifier + sequence (e.g. APPLE-1)
workspaceRoutes.get("/:slug/work-items/:identifier/", workspaceMiddleware, async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const identifier = c.req.param("identifier");

  // Parse "PROJECT-123" into project identifier and sequence number
  const dashIndex = identifier.lastIndexOf("-");
  if (dashIndex === -1) {
    return c.json({ error: "Invalid issue identifier" }, 400);
  }
  const projectIdentifier = identifier.substring(0, dashIndex);
  const sequenceStr = identifier.substring(dashIndex + 1);

  // Validate sequence is a valid integer
  if (!/^\d+$/.test(sequenceStr)) {
    return c.json({ error: "Invalid issue identifier" }, 400);
  }
  const sequenceId = parseInt(sequenceStr, 10);

  // Fetch the project by identifier (case-insensitive)
  const project = await db.query.projects.findFirst({
    where: and(
      sql`LOWER(${projects.identifier}) = LOWER(${projectIdentifier})`,
      eq(projects.workspaceId, workspace.id)
    ),
  });

  if (!project) {
    return c.json({ error: "The required object does not exist." }, 404);
  }

  // Check if user is an active project member
  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.memberId, user.id),
      eq(projectMembers.isActive, true)
    ),
  });

  if (!membership) {
    return c.json({ error: "You are not allowed to view this issue" }, 403);
  }

  // Fetch the issue by sequence_id
  const issue = await db.query.issues.findFirst({
    where: and(
      eq(issues.projectId, project.id),
      eq(issues.workspaceId, workspace.id),
      eq(issues.sequenceId, sequenceId),
      isNull(issues.deletedAt)
    ),
  });

  if (!issue) {
    return c.json({ error: "The required object does not exist." }, 404);
  }

  // Guest permission check
  if (
    membership.role === 5 &&
    !project.guestViewAllFeatures &&
    issue.createdById !== user.id
  ) {
    return c.json({ error: "You are not allowed to view this issue" }, 403);
  }

  // Fetch all related data in parallel
  const [
    assigneeRows,
    labelRows,
    moduleRows,
    cycleRow,
    subIssuesCountResult,
    linkCountResult,
    attachmentCountResult,
    subscriberRow,
  ] = await Promise.all([
    // Assignee IDs
    db
      .select({ assigneeId: issueAssignees.assigneeId })
      .from(issueAssignees)
      .where(eq(issueAssignees.issueId, issue.id)),
    // Label IDs
    db
      .select({ labelId: issueLabels.labelId })
      .from(issueLabels)
      .where(eq(issueLabels.issueId, issue.id)),
    // Module IDs (only non-archived, non-deleted)
    db
      .select({ moduleId: moduleIssues.moduleId })
      .from(moduleIssues)
      .innerJoin(modules, eq(modules.id, moduleIssues.moduleId))
      .where(
        and(
          eq(moduleIssues.issueId, issue.id),
          isNull(modules.archivedAt)
        )
      ),
    // Cycle ID
    db
      .select({ cycleId: cycleIssues.cycleId })
      .from(cycleIssues)
      .where(eq(cycleIssues.issueId, issue.id))
      .limit(1),
    // Sub-issues count
    db
      .select({ count: count() })
      .from(issues)
      .where(
        and(
          eq(issues.parentId, issue.id),
          isNull(issues.deletedAt)
        )
      ),
    // Link count
    db
      .select({ count: count() })
      .from(issueLinks)
      .where(eq(issueLinks.issueId, issue.id)),
    // Attachment count
    db
      .select({ count: count() })
      .from(fileAssets)
      .where(
        and(
          eq(fileAssets.entityIdentifier, issue.id),
          eq(fileAssets.entityType, "issue_attachment"),
          eq(fileAssets.isDeleted, false)
        )
      ),
    // Is subscribed
    db.query.issueSubscribers.findFirst({
      where: and(
        eq(issueSubscribers.issueId, issue.id),
        eq(issueSubscribers.subscriberId, user.id)
      ),
    }),
  ]);

  const assigneeIds = assigneeRows.map((r) => r.assigneeId);
  const labelIds = labelRows.map((r) => r.labelId);
  const moduleIds = moduleRows.map((r) => r.moduleId);
  const cycleId = cycleRow[0]?.cycleId ?? null;
  const subIssuesCount = subIssuesCountResult[0]?.count ?? 0;
  const linkCount = linkCountResult[0]?.count ?? 0;
  const attachmentCount = attachmentCountResult[0]?.count ?? 0;
  const isSubscribed = !!subscriberRow;

  // Build the base response (matching IssueDetailSerializer)
  const result: Record<string, unknown> = {
    id: issue.id,
    project_id: issue.projectId,
    workspace_id: issue.workspaceId,
    parent_id: issue.parentId ?? null,
    state_id: issue.stateId ?? null,
    name: issue.name,
    description_html: issue.descriptionHtml ?? "",
    priority: issue.priority ?? 0,
    sort_order: issue.sortOrder ?? 65535,
    start_date: issue.startDate?.toISOString()?.split("T")[0] ?? null,
    target_date: issue.targetDate?.toISOString()?.split("T")[0] ?? null,
    completed_at: issue.completedAt?.toISOString() ?? null,
    archived_at: issue.archivedAt?.toISOString() ?? null,
    sequence_id: issue.sequenceId ?? null,
    estimate_point: issue.estimatePoint ?? null,
    is_draft: false,
    is_epic: issue.isEpic ?? false,
    assignee_ids: assigneeIds,
    label_ids: labelIds,
    module_ids: moduleIds,
    cycle_id: cycleId,
    sub_issues_count: subIssuesCount,
    attachment_count: attachmentCount,
    link_count: linkCount,
    is_subscribed: isSubscribed,
    is_intake: false,
    created_by: issue.createdById ?? null,
    updated_by: issue.updatedById ?? null,
    created_at: issue.createdAt?.toISOString() ?? null,
    updated_at: issue.updatedAt?.toISOString() ?? null,
  };

  // Handle expand parameter
  const expandParam = c.req.query("expand") ?? "";
  const expandFields = expandParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (expandFields.includes("issue_reactions")) {
    const reactions = await db
      .select()
      .from(issueReactions)
      .where(eq(issueReactions.issueId, issue.id));
    result.issue_reactions = reactions.map((r) => ({
      id: r.id,
      issue: r.issueId,
      actor: r.actorId,
      reaction: r.reaction,
      created_at: r.createdAt?.toISOString() ?? null,
    }));
  }

  if (expandFields.includes("issue_link")) {
    const links = await db
      .select()
      .from(issueLinks)
      .where(eq(issueLinks.issueId, issue.id));
    result.issue_link = links.map((l) => ({
      id: l.id,
      issue: l.issueId,
      title: l.title ?? "",
      url: l.url,
      metadata: l.metadata ?? {},
      created_by: l.createdById ?? null,
      created_at: l.createdAt?.toISOString() ?? null,
    }));
  }

  if (expandFields.includes("issue_attachments")) {
    const attachments = await db
      .select()
      .from(fileAssets)
      .where(
        and(
          eq(fileAssets.entityIdentifier, issue.id),
          eq(fileAssets.entityType, "issue_attachment"),
          eq(fileAssets.isDeleted, false)
        )
      );
    result.issue_attachments = attachments.map((a) => ({
      id: a.id,
      asset: a.asset,
      attributes: a.attributes ?? {},
      size: a.size ?? 0,
      is_uploaded: a.isUploaded ?? false,
      created_by: a.createdById ?? null,
      created_at: a.createdAt?.toISOString() ?? null,
      updated_at: a.updatedAt?.toISOString() ?? null,
    }));
  }

  if (expandFields.includes("parent") && issue.parentId) {
    const parent = await db.query.issues.findFirst({
      where: and(
        eq(issues.id, issue.parentId),
        isNull(issues.deletedAt)
      ),
    });
    if (parent) {
      const parentAssignees = await db
        .select({ assigneeId: issueAssignees.assigneeId })
        .from(issueAssignees)
        .where(eq(issueAssignees.issueId, parent.id));
      const parentLabels = await db
        .select({ labelId: issueLabels.labelId })
        .from(issueLabels)
        .where(eq(issueLabels.issueId, parent.id));

      result.parent = {
        id: parent.id,
        project_id: parent.projectId,
        workspace_id: parent.workspaceId,
        parent_id: parent.parentId ?? null,
        state_id: parent.stateId ?? null,
        name: parent.name,
        priority: parent.priority ?? 0,
        sort_order: parent.sortOrder ?? 65535,
        start_date: parent.startDate?.toISOString()?.split("T")[0] ?? null,
        target_date: parent.targetDate?.toISOString()?.split("T")[0] ?? null,
        completed_at: parent.completedAt?.toISOString() ?? null,
        archived_at: parent.archivedAt?.toISOString() ?? null,
        sequence_id: parent.sequenceId ?? null,
        estimate_point: parent.estimatePoint ?? null,
        is_epic: parent.isEpic ?? false,
        assignee_ids: parentAssignees.map((r) => r.assigneeId),
        label_ids: parentLabels.map((r) => r.labelId),
        created_by: parent.createdById ?? null,
        updated_by: parent.updatedById ?? null,
        created_at: parent.createdAt?.toISOString() ?? null,
        updated_at: parent.updatedAt?.toISOString() ?? null,
      };
    } else {
      result.parent = null;
    }
  }

  // Track recent visit (fire and forget)
  db.insert(recentVisits).values({
    workspaceId: workspace.id,
    entityType: "issue",
    entityId: issue.id,
    userId: user.id,
    visitedAt: new Date(),
  }).catch(() => {});

  return c.json(result);
});

// ==================== SEARCH ENDPOINTS ====================

// Helper: compute cycle status from dates
function computeCycleStatus(startDate: Date | null, endDate: Date | null): string {
  const now = new Date();
  if (startDate && endDate && startDate <= now && endDate >= now) return "CURRENT";
  if (startDate && startDate > now) return "UPCOMING";
  if (endDate && endDate < now) return "COMPLETED";
  if (!startDate && !endDate) return "DRAFT";
  return "DRAFT";
}

// GET /:slug/search/ - Global search (command palette)
workspaceRoutes.get("/:slug/search/", workspaceMiddleware, requireWorkspaceMember, async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  const query = c.req.query("search") || "";
  const entitiesParam = c.req.query("entities") || "";
  const workspaceSearch = c.req.query("workspace_search") || "false";
  const projectIdParam = c.req.query("project_id") || "";

  const allEntities = ["workspace", "project", "issue", "cycle", "module", "issue_view", "page", "intake"];
  let requestedEntities: string[];
  if (entitiesParam) {
    requestedEntities = entitiesParam.split(",").map((e) => e.trim()).filter((e) => allEntities.includes(e));
  } else {
    requestedEntities = allEntities;
  }

  // Get user's project memberships for filtering
  const userProjectMemberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(
      eq(projectMembers.memberId, user.id),
      eq(projects.workspaceId, workspace.id),
      isNull(projects.archivedAt),
    ));
  const userProjectIds = userProjectMemberships.map((m) => m.projectId);

  const results: Record<string, unknown[]> = {};

  for (const entity of requestedEntities) {
    if (entity === "workspace") {
      if (query) {
        const ws = await db
          .select({ name: workspaces.name, id: workspaces.id, slug: workspaces.slug })
          .from(workspaces)
          .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
          .where(and(
            eq(workspaceMembers.userId, user.id),
            like(workspaces.name, `%${query}%`),
          ))
          .orderBy(desc(workspaces.createdAt));
        results.workspace = ws;
      } else {
        const ws = await db
          .select({ name: workspaces.name, id: workspaces.id, slug: workspaces.slug })
          .from(workspaces)
          .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
          .where(eq(workspaceMembers.userId, user.id))
          .orderBy(desc(workspaces.createdAt));
        results.workspace = ws;
      }
    }

    if (entity === "project") {
      if (userProjectIds.length === 0) { results.project = []; continue; }
      let projectQuery = db
        .select({
          name: projects.name,
          id: projects.id,
          identifier: projects.identifier,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(projects)
        .where(and(
          inArray(projects.id, userProjectIds),
          eq(projects.workspaceId, workspace.id),
          isNull(projects.archivedAt),
          query ? or(like(projects.name, `%${query}%`), like(projects.identifier, `%${query}%`)) : undefined,
        ))
        .orderBy(desc(projects.createdAt));
      results.project = await projectQuery;
    }

    if (entity === "issue") {
      if (userProjectIds.length === 0) { results.issue = []; continue; }
      const conditions: any[] = [
        eq(issues.workspaceId, workspace.id),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt),
        inArray(issues.projectId, userProjectIds),
      ];
      if (workspaceSearch === "false" && projectIdParam) {
        conditions.push(eq(issues.projectId, projectIdParam));
      }
      if (query) {
        const orConditions: any[] = [like(issues.name, `%${query}%`)];
        // Check for sequence_id (numeric match)
        const sequences = query.match(/\b\d+\b/g);
        if (sequences) {
          for (const seq of sequences) {
            orConditions.push(eq(issues.sequenceId, parseInt(seq, 10)));
          }
        }
        // Check for project identifier match
        orConditions.push(sql`EXISTS (SELECT 1 FROM projects WHERE projects.id = ${issues.projectId} AND projects.identifier LIKE ${'%' + query + '%'})`);
        conditions.push(or(...orConditions));
      }
      const issueRows = await db
        .select({
          name: issues.name,
          id: issues.id,
          sequence_id: issues.sequenceId,
          project_id: issues.projectId,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(issues)
        .where(and(...conditions))
        .orderBy(desc(issues.createdAt))
        .limit(100);

      // Add project__identifier via lookup
      const issueProjectIds = [...new Set(issueRows.map((i) => i.project_id))];
      const projectLookup = new Map<string, string>();
      if (issueProjectIds.length > 0) {
        const projRows = await db
          .select({ id: projects.id, identifier: projects.identifier })
          .from(projects)
          .where(inArray(projects.id, issueProjectIds));
        for (const p of projRows) projectLookup.set(p.id, p.identifier);
      }
      results.issue = issueRows.map((i) => ({
        ...i,
        project__identifier: projectLookup.get(i.project_id) ?? "",
      }));
    }

    if (entity === "cycle") {
      if (userProjectIds.length === 0) { results.cycle = []; continue; }
      const conditions: any[] = [
        eq(cycles.workspaceId, workspace.id),
        inArray(cycles.projectId, userProjectIds),
      ];
      if (workspaceSearch === "false" && projectIdParam) {
        conditions.push(eq(cycles.projectId, projectIdParam));
      }
      if (query) {
        conditions.push(like(cycles.name, `%${query}%`));
      }
      const cycleRows = await db
        .select({
          name: cycles.name,
          id: cycles.id,
          project_id: cycles.projectId,
          startDate: cycles.startDate,
          endDate: cycles.endDate,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(cycles)
        .where(and(...conditions))
        .orderBy(desc(cycles.createdAt));

      const cycleProjectIds = [...new Set(cycleRows.map((c) => c.project_id))];
      const cycleProjLookup = new Map<string, string>();
      if (cycleProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, cycleProjectIds));
        for (const p of projRows) cycleProjLookup.set(p.id, p.identifier);
      }
      results.cycle = cycleRows.map((c) => ({
        name: c.name,
        id: c.id,
        project_id: c.project_id,
        project__identifier: cycleProjLookup.get(c.project_id) ?? "",
        status: computeCycleStatus(c.startDate, c.endDate),
        workspace__slug: c.workspace__slug,
      }));
    }

    if (entity === "module") {
      if (userProjectIds.length === 0) { results.module = []; continue; }
      const conditions: any[] = [
        eq(modules.workspaceId, workspace.id),
        inArray(modules.projectId, userProjectIds),
      ];
      if (workspaceSearch === "false" && projectIdParam) {
        conditions.push(eq(modules.projectId, projectIdParam));
      }
      if (query) {
        conditions.push(like(modules.name, `%${query}%`));
      }
      const moduleRows = await db
        .select({
          name: modules.name,
          id: modules.id,
          project_id: modules.projectId,
          status: modules.status,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(modules)
        .where(and(...conditions))
        .orderBy(desc(modules.createdAt));

      const moduleProjectIds = [...new Set(moduleRows.map((m) => m.project_id))];
      const moduleProjLookup = new Map<string, string>();
      if (moduleProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, moduleProjectIds));
        for (const p of projRows) moduleProjLookup.set(p.id, p.identifier);
      }
      results.module = moduleRows.map((m) => ({
        ...m,
        project__identifier: moduleProjLookup.get(m.project_id) ?? "",
      }));
    }

    if (entity === "issue_view") {
      if (userProjectIds.length === 0) { results.issue_view = []; continue; }
      const conditions: any[] = [
        eq(views.workspaceId, workspace.id),
        inArray(views.projectId, userProjectIds),
      ];
      if (workspaceSearch === "false" && projectIdParam) {
        conditions.push(eq(views.projectId, projectIdParam));
      }
      if (query) {
        conditions.push(like(views.name, `%${query}%`));
      }
      const viewRows = await db
        .select({
          name: views.name,
          id: views.id,
          project_id: views.projectId,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(views)
        .where(and(...conditions))
        .orderBy(desc(views.createdAt));

      const viewProjectIds = [...new Set(viewRows.filter((v) => v.project_id).map((v) => v.project_id!))];
      const viewProjLookup = new Map<string, string>();
      if (viewProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, viewProjectIds));
        for (const p of projRows) viewProjLookup.set(p.id, p.identifier);
      }
      results.issue_view = viewRows.map((v) => ({
        ...v,
        project__identifier: v.project_id ? viewProjLookup.get(v.project_id) ?? "" : "",
      }));
    }

    if (entity === "page") {
      if (userProjectIds.length === 0) { results.page = []; continue; }
      const conditions: any[] = [
        eq(pages.workspaceId, workspace.id),
      ];
      if (workspaceSearch === "false" && projectIdParam) {
        conditions.push(eq(pages.projectId, projectIdParam));
      }
      if (query) {
        conditions.push(like(pages.name, `%${query}%`));
      }
      const pageRows = await db
        .select({
          name: pages.name,
          id: pages.id,
          project_ids: pages.projectId,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(pages)
        .where(and(...conditions))
        .orderBy(desc(pages.createdAt));

      results.page = pageRows.map((p) => ({
        name: p.name,
        id: p.id,
        project_ids: p.project_ids ? [p.project_ids] : [],
        workspace__slug: p.workspace__slug,
      }));
    }

    if (entity === "intake") {
      if (userProjectIds.length === 0) { results.intake = []; continue; }
      const conditions: any[] = [
        eq(issues.workspaceId, workspace.id),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt),
        inArray(issues.projectId, userProjectIds),
        or(eq(intakeIssues.status, 0), eq(intakeIssues.status, -2)),
      ];
      if (workspaceSearch === "false" && projectIdParam) {
        conditions.push(eq(issues.projectId, projectIdParam));
      }
      if (query) {
        const orConditions: any[] = [like(issues.name, `%${query}%`)];
        const sequences = query.match(/\b\d+\b/g);
        if (sequences) {
          for (const seq of sequences) {
            orConditions.push(eq(issues.sequenceId, parseInt(seq, 10)));
          }
        }
        orConditions.push(sql`EXISTS (SELECT 1 FROM projects WHERE projects.id = ${issues.projectId} AND projects.identifier LIKE ${'%' + query + '%'})`);
        conditions.push(or(...orConditions));
      }
      const intakeRows = await db
        .select({
          name: issues.name,
          id: issues.id,
          sequence_id: issues.sequenceId,
          project_id: issues.projectId,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(issues)
        .innerJoin(intakeIssues, eq(intakeIssues.issueId, issues.id))
        .where(and(...conditions))
        .orderBy(desc(issues.createdAt))
        .limit(100);

      const intakeProjectIds = [...new Set(intakeRows.map((i) => i.project_id))];
      const intakeProjLookup = new Map<string, string>();
      if (intakeProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, intakeProjectIds));
        for (const p of projRows) intakeProjLookup.set(p.id, p.identifier);
      }
      results.intake = intakeRows.map((i) => ({
        ...i,
        project__identifier: intakeProjLookup.get(i.project_id) ?? "",
      }));
    }
  }

  return c.json({ results });
});

// GET /:slug/entity-search/ - Entity-specific search (for mentions, work item pickers, etc.)
workspaceRoutes.get("/:slug/entity-search/", workspaceMiddleware, requireWorkspaceMember, async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  const query = c.req.query("query") || "";
  const queryTypesParam = c.req.query("query_type") || "user_mention";
  const queryTypes = queryTypesParam.split(",").map((t) => t.trim());
  const countLimit = Math.min(parseInt(c.req.query("count") || "5", 10) || 5, 100);
  const projectIdParam = c.req.query("project_id") || "";

  // Get user's project memberships
  const userProjectMemberships = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(
      eq(projectMembers.memberId, user.id),
      eq(projects.workspaceId, workspace.id),
      isNull(projects.archivedAt),
    ));
  const userProjectIds = userProjectMemberships.map((m) => m.projectId);

  const responseData: Record<string, unknown[]> = {};

  for (const queryType of queryTypes) {
    if (queryType === "user_mention") {
      if (projectIdParam) {
        // Search project members
        const conditions: any[] = [
          eq(projectMembers.projectId, projectIdParam),
        ];
        if (query) {
          conditions.push(
            sql`EXISTS (SELECT 1 FROM users WHERE users.id = ${projectMembers.memberId} AND (users.display_name LIKE ${'%' + query + '%'} OR users.name LIKE ${'%' + query + '%'}))`
          );
        }
        const members = await db
          .select({
            member__id: projectMembers.memberId,
          })
          .from(projectMembers)
          .where(and(...conditions))
          .orderBy(desc(projectMembers.createdAt))
          .limit(countLimit);

        // Fetch user details
        const memberIds = members.map((m) => m.member__id);
        if (memberIds.length > 0) {
          const userRows = await db
            .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
            .from(users)
            .where(inArray(users.id, memberIds));
          const userMap = new Map(userRows.map((u) => [u.id, u]));
          responseData.user_mention = members.map((m) => {
            const u = userMap.get(m.member__id);
            return {
              member__id: m.member__id,
              member__display_name: u?.displayName ?? "",
              member__avatar_url: u?.avatar ?? null,
            };
          });
        } else {
          responseData.user_mention = [];
        }
      } else {
        // Search workspace members
        const conditions: any[] = [
          eq(workspaceMembers.workspaceId, workspace.id),
        ];
        if (query) {
          conditions.push(
            sql`EXISTS (SELECT 1 FROM users WHERE users.id = ${workspaceMembers.userId} AND (users.display_name LIKE ${'%' + query + '%'} OR users.name LIKE ${'%' + query + '%'}))`
          );
        }
        const members = await db
          .select({
            member__id: workspaceMembers.userId,
          })
          .from(workspaceMembers)
          .where(and(...conditions))
          .orderBy(desc(workspaceMembers.createdAt))
          .limit(countLimit);

        const memberIds = members.map((m) => m.member__id);
        if (memberIds.length > 0) {
          const userRows = await db
            .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
            .from(users)
            .where(inArray(users.id, memberIds));
          const userMap = new Map(userRows.map((u) => [u.id, u]));
          responseData.user_mention = members.map((m) => {
            const u = userMap.get(m.member__id);
            return {
              member__id: m.member__id,
              member__display_name: u?.displayName ?? "",
              member__avatar_url: u?.avatar ?? null,
            };
          });
        } else {
          responseData.user_mention = [];
        }
      }
    }

    if (queryType === "project") {
      const conditions: any[] = [
        eq(projects.workspaceId, workspace.id),
      ];
      if (query) {
        conditions.push(or(like(projects.name, `%${query}%`), like(projects.identifier, `%${query}%`)));
      }
      // User must be member OR project is public (network=2)
      if (userProjectIds.length > 0) {
        conditions.push(or(inArray(projects.id, userProjectIds), eq(projects.network, 2)));
      } else {
        conditions.push(eq(projects.network, 2));
      }
      const projectRows = await db
        .select({
          name: projects.name,
          id: projects.id,
          identifier: projects.identifier,
          logo_props: projects.logoProps,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(projects)
        .where(and(...conditions))
        .orderBy(desc(projects.createdAt))
        .limit(countLimit);
      responseData.project = projectRows;
    }

    if (queryType === "issue") {
      if (userProjectIds.length === 0) { responseData.issue = []; continue; }
      const conditions: any[] = [
        eq(issues.workspaceId, workspace.id),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt),
      ];
      if (projectIdParam) {
        conditions.push(eq(issues.projectId, projectIdParam));
      } else {
        conditions.push(inArray(issues.projectId, userProjectIds));
      }
      if (query) {
        const orConditions: any[] = [like(issues.name, `%${query}%`)];
        const sequences = query.match(/\b\d+\b/g);
        if (sequences) {
          for (const seq of sequences) {
            orConditions.push(eq(issues.sequenceId, parseInt(seq, 10)));
          }
        }
        orConditions.push(sql`EXISTS (SELECT 1 FROM projects WHERE projects.id = ${issues.projectId} AND projects.identifier LIKE ${'%' + query + '%'})`);
        conditions.push(or(...orConditions));
      }
      const issueRows = await db
        .select({
          name: issues.name,
          id: issues.id,
          sequence_id: issues.sequenceId,
          project_id: issues.projectId,
          priority: issues.priority,
          state_id: issues.stateId,
        })
        .from(issues)
        .where(and(...conditions))
        .orderBy(desc(issues.createdAt))
        .limit(countLimit);

      // Add project__identifier
      const issueProjectIds = [...new Set(issueRows.map((i) => i.project_id))];
      const projLookup = new Map<string, string>();
      if (issueProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, issueProjectIds));
        for (const p of projRows) projLookup.set(p.id, p.identifier);
      }
      responseData.issue = issueRows.map((i) => ({
        ...i,
        type_id: null,
        project__identifier: projLookup.get(i.project_id) ?? "",
      }));
    }

    if (queryType === "cycle") {
      if (userProjectIds.length === 0) { responseData.cycle = []; continue; }
      const conditions: any[] = [
        eq(cycles.workspaceId, workspace.id),
      ];
      if (projectIdParam) {
        conditions.push(eq(cycles.projectId, projectIdParam));
      } else {
        conditions.push(inArray(cycles.projectId, userProjectIds));
      }
      if (query) {
        conditions.push(like(cycles.name, `%${query}%`));
      }
      const cycleRows = await db
        .select({
          name: cycles.name,
          id: cycles.id,
          project_id: cycles.projectId,
          startDate: cycles.startDate,
          endDate: cycles.endDate,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(cycles)
        .where(and(...conditions))
        .orderBy(desc(cycles.createdAt))
        .limit(countLimit);

      const cycleProjectIds = [...new Set(cycleRows.map((c) => c.project_id))];
      const cycleProjLookup = new Map<string, string>();
      if (cycleProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, cycleProjectIds));
        for (const p of projRows) cycleProjLookup.set(p.id, p.identifier);
      }
      responseData.cycle = cycleRows.map((c) => ({
        name: c.name,
        id: c.id,
        project_id: c.project_id,
        project__identifier: cycleProjLookup.get(c.project_id) ?? "",
        status: computeCycleStatus(c.startDate, c.endDate),
        workspace__slug: c.workspace__slug,
      }));
    }

    if (queryType === "module") {
      if (userProjectIds.length === 0) { responseData.module = []; continue; }
      const conditions: any[] = [
        eq(modules.workspaceId, workspace.id),
      ];
      if (projectIdParam) {
        conditions.push(eq(modules.projectId, projectIdParam));
      } else {
        conditions.push(inArray(modules.projectId, userProjectIds));
      }
      if (query) {
        conditions.push(like(modules.name, `%${query}%`));
      }
      const moduleRows = await db
        .select({
          name: modules.name,
          id: modules.id,
          project_id: modules.projectId,
          status: modules.status,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(modules)
        .where(and(...conditions))
        .orderBy(desc(modules.createdAt))
        .limit(countLimit);

      const moduleProjectIds = [...new Set(moduleRows.map((m) => m.project_id))];
      const moduleProjLookup = new Map<string, string>();
      if (moduleProjectIds.length > 0) {
        const projRows = await db.select({ id: projects.id, identifier: projects.identifier }).from(projects).where(inArray(projects.id, moduleProjectIds));
        for (const p of projRows) moduleProjLookup.set(p.id, p.identifier);
      }
      responseData.module = moduleRows.map((m) => ({
        ...m,
        project__identifier: moduleProjLookup.get(m.project_id) ?? "",
      }));
    }

    if (queryType === "page") {
      const conditions: any[] = [
        eq(pages.workspaceId, workspace.id),
        eq(pages.accessLevel, 0),
      ];
      if (projectIdParam) {
        conditions.push(eq(pages.projectId, projectIdParam));
      }
      if (query) {
        conditions.push(like(pages.name, `%${query}%`));
      }
      const pageRows = await db
        .select({
          name: pages.name,
          id: pages.id,
          projects__id: pages.projectId,
          workspace__slug: sql<string>`${workspace.slug}`.as("workspace__slug"),
        })
        .from(pages)
        .where(and(...conditions))
        .orderBy(desc(pages.createdAt))
        .limit(countLimit);
      responseData.page = pageRows;
    }
  }

  return c.json(responseData);
});

export { workspaceRoutes };

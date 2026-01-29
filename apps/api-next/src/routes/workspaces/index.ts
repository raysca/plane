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
import { sql, not, like, isNull } from "drizzle-orm";
import homePreferenceRoutes from "./home-preference";

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

  // Check the email matches
  if (!body.email || invitation.email !== body.email) {
    return c.json(
      { error: "You do not have permission to join the workspace" },
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

// GET /api/workspaces/:slug/labels/ - List workspace labels
workspaceRoutes.get("/:slug/labels/", async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

  const labels = await db.query.workspaceLabels.findMany({
    where: eq(workspaceLabels.workspaceId, workspace.id),
    orderBy: [asc(workspaceLabels.sortOrder)],
  });

  return c.json(labels.map(formatLabel));
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
workspaceRoutes.get("/:slug/sidebar-preferences/", async (c) => {
  const membership = c.get("workspaceMembership");
  if (!membership) return c.json({ detail: "Not found." }, 404);

  const dbMembership = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.id, membership.id),
  });

  return c.json({
    view_props: dbMembership?.viewProps ?? {},
    default_props: dbMembership?.defaultProps ?? {},
  });
});

// PATCH /api/workspaces/:slug/sidebar-preferences/ - Update sidebar preferences
workspaceRoutes.patch("/:slug/sidebar-preferences/", async (c) => {
  const membership = c.get("workspaceMembership");
  if (!membership) return c.json({ detail: "Not found." }, 404);

  const body = await c.req.json() as {
    view_props?: unknown;
    default_props?: unknown;
  };

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (body.view_props !== undefined) {
    updateData.viewProps = body.view_props;
  }
  if (body.default_props !== undefined) {
    updateData.defaultProps = body.default_props;
  }

  await db.update(workspaceMembers).set(updateData).where(eq(workspaceMembers.id, membership.id));

  const updated = await db.query.workspaceMembers.findFirst({
    where: eq(workspaceMembers.id, membership.id),
  });

  return c.json({
    view_props: updated?.viewProps ?? {},
    default_props: updated?.defaultProps ?? {},
  });
});

// Home Preferences
workspaceRoutes.route("/:slug/home-preferences/", homePreferenceRoutes);

// =====================================================
// Placeholder routes (later phases)
// =====================================================

// Projects (Phase 4) - Handled by projectRoutes mounted at /api/workspaces/:slug/projects

// Cycles
workspaceRoutes.get("/:slug/cycles/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.get("/:slug/active-cycles/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// Modules
workspaceRoutes.get("/:slug/modules/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// Views
workspaceRoutes.get("/:slug/views/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
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

// Search
workspaceRoutes.get("/:slug/search/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.get("/:slug/entity-search/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// Notifications (placeholder for full list)
workspaceRoutes.get("/:slug/users/notifications/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// GET /api/workspaces/:slug/users/notifications/unread/ - Get unread notification counts
workspaceRoutes.get("/:slug/users/notifications/unread/", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ detail: "Authentication required." }, 401);
  }

  const workspace = c.get("workspace");
  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

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
        isNull(notifications.snoozedTill),
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
        isNull(notifications.snoozedTill),
        like(notifications.sender, "%mentioned%")
      )
    );

  return c.json({
    total_unread_notifications_count: Number(unreadResult[0]?.count ?? 0),
    mention_unread_notifications_count: Number(mentionResult[0]?.count ?? 0),
  });
});

// Favorites
workspaceRoutes.get("/:slug/user-favorites/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.post("/:slug/user-favorites/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.delete("/:slug/user-favorites/:id/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// Quick links
workspaceRoutes.get("/:slug/quick-links/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.post("/:slug/quick-links/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.delete("/:slug/quick-links/:id/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// Stickies
workspaceRoutes.get("/:slug/stickies/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.post("/:slug/stickies/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.patch("/:slug/stickies/:id/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.delete("/:slug/stickies/:id/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

// Dashboard
workspaceRoutes.get("/:slug/dashboard/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
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
workspaceRoutes.get("/:slug/webhooks/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.post("/:slug/webhooks/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.get("/:slug/webhooks/:webhookId/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.patch("/:slug/webhooks/:webhookId/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

workspaceRoutes.delete("/:slug/webhooks/:webhookId/", async (c) => {
  return c.json({ detail: "Not implemented" }, 501);
});

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

export { workspaceRoutes };

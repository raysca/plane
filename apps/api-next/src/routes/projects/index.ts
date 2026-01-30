import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, desc, asc, isNull, inArray, sql, count as countFn } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import {
  projects,
  projectMembers,
  states,
  labels,
  estimates,
  estimatePoints,
} from "../../db/schema/project";
import { workspaces, workspaceMembers, favorites, recentVisits } from "../../db/schema/workspace";
import { authMiddleware, ROLES } from "../../middleware/auth";
import {
  workspaceMiddleware,
  requireWorkspaceAdmin,
  requireWorkspaceMember,
} from "../../middleware/workspace";
import {
  projectMiddleware,
  requireProjectAdmin,
  requireProjectMember,
} from "../../middleware/project";
import type { Variables } from "../../app";
import { generateIdentifier } from "../../lib/utils";

const projectRoutes = new Hono<{ Variables: Variables }>();

// Apply auth + workspace middleware globally
projectRoutes.use("*", authMiddleware);
projectRoutes.use("*", workspaceMiddleware);

// --- Validation Schemas ---

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  identifier: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Z][A-Z0-9]*$/)
    .optional(),
  description: z.string().optional(),
  description_text: z.string().optional(),
  description_html: z.string().optional(),
  network: z.number().int().refine((v) => [0, 2].includes(v)).optional(),
  emoji: z.string().optional().nullable(),
  icon_prop: z.record(z.string(), z.unknown()).optional().nullable(),
  logo_props: z.record(z.string(), z.unknown()).optional().nullable(),
  cover_image: z.string().optional().nullable(),
  project_lead: z.string().optional().nullable(),
  default_assignee: z.string().optional().nullable(),
});

const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  description_text: z.string().optional().nullable(),
  description_html: z.string().optional().nullable(),
  network: z.number().int().refine((v) => [0, 2].includes(v)).optional(),
  emoji: z.string().optional().nullable(),
  icon_prop: z.record(z.string(), z.unknown()).optional().nullable(),
  logo_props: z.record(z.string(), z.unknown()).optional().nullable(),
  cover_image: z.string().optional().nullable(),
  project_lead: z.string().optional().nullable(),
  default_assignee: z.string().optional().nullable(),
  archive_in: z.number().int().min(0).optional(),
  close_in: z.number().int().min(0).optional(),
  estimate_id: z.string().optional().nullable(),
  default_state_id: z.string().optional().nullable(),
  sort_order: z.number().optional(),
  cycle_view: z.boolean().optional(),
  module_view: z.boolean().optional(),
  page_view: z.boolean().optional(),
  issue_views_view: z.boolean().optional(),
  inbox_view: z.boolean().optional(),
  guest_view_all_features: z.boolean().optional(),
  is_time_tracking_enabled: z.boolean().optional(),
  is_issue_type_enabled: z.boolean().optional(),
});

const addMembersSchema = z.object({
  members: z
    .array(
      z.object({
        member_id: z.string().min(1),
        role: z.number().int().refine((v) => [5, 10, 15, 20].includes(v)),
      })
    )
    .min(1),
});

const updateMemberSchema = z.object({
  role: z.number().int().refine((v) => [5, 10, 15, 20].includes(v)),
  view_props: z.record(z.string(), z.unknown()).optional(),
  default_props: z.record(z.string(), z.unknown()).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  sort_order: z.number().optional(),
});

const createStateSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  group: z.enum(["backlog", "unstarted", "started", "completed", "cancelled"]),
  description: z.string().optional(),
  sequence: z.number().optional(),
  is_default: z.boolean().optional(),
});

const updateStateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  group: z.enum(["backlog", "unstarted", "started", "completed", "cancelled"]).optional(),
  description: z.string().optional().nullable(),
  sequence: z.number().optional(),
  is_default: z.boolean().optional(),
});

const createLabelSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: z.string().optional(),
  parent_id: z.string().optional().nullable(),
  sort_order: z.number().optional(),
});

const updateLabelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  description: z.string().optional().nullable(),
  parent_id: z.string().optional().nullable(),
  sort_order: z.number().optional(),
});

const createEstimateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  type: z.enum(["categories", "points", "time"]).optional(),
});

const updateEstimateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional().nullable(),
  type: z.enum(["categories", "points", "time"]).optional(),
});

const createEstimatePointSchema = z.object({
  key: z.number().int(),
  value: z.string().min(1),
  description: z.string().optional(),
});

const updateEstimatePointSchema = z.object({
  key: z.number().int().optional(),
  value: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
});

// --- Helper formatters ---

function formatProject(p: typeof projects.$inferSelect, extra?: {
  memberCount?: number;
  isFavorite?: boolean;
  memberRole?: number | null;
  isMember?: boolean;
  sortOrder?: number | null;
  anchor?: string | null;
  members?: string[];
}) {
  return {
    id: p.id,
    workspace: p.workspaceId,
    workspace_id: p.workspaceId,
    name: p.name,
    description: p.description ?? "",
    description_text: p.descriptionText ?? null,
    description_html: p.descriptionHtml ?? null,
    network: p.network ?? 2,
    identifier: p.identifier,
    emoji: p.emoji ?? null,
    icon_prop: p.iconProp ?? null,
    logo_props: p.logoProps ?? {},
    cover_image: p.coverImage ?? null,
    cover_image_url: p.coverImage ?? null,
    archive_in: p.archiveIn ?? 0,
    close_in: p.closeIn ?? 0,
    default_assignee: p.defaultAssigneeId ?? null,
    default_state: p.defaultStateId ?? null,
    project_lead: p.projectLeadId ?? null,
    estimate: p.estimateId ?? null,
    cycle_view: p.cycleView ?? true,
    module_view: p.moduleView ?? true,
    issue_views_view: p.issueViewsView ?? true,
    page_view: p.pageView ?? true,
    inbox_view: p.intakeView ?? false,
    guest_view_all_features: p.guestViewAllFeatures ?? false,
    archived_at: p.archivedAt?.toISOString() ?? null,
    sort_order: extra?.sortOrder ?? p.sortOrder ?? 65535,
    is_favorite: extra?.isFavorite ?? false,
    is_member: extra?.isMember ?? false,
    member_role: extra?.memberRole ?? null,
    members: extra?.members ?? [],
    anchor: extra?.anchor ?? null,
    total_members: extra?.memberCount ?? 0,
    created_by: p.createdById ?? null,
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
  };
}

function formatMember(m: typeof projectMembers.$inferSelect, user: typeof users.$inferSelect) {
  return {
    id: m.id,
    member: {
      id: user.id,
      email: user.email,
      first_name: user.firstName ?? "",
      last_name: user.lastName ?? "",
      display_name: user.displayName ?? user.name ?? "",
      avatar: user.avatar ?? user.image ?? "",
    },
    role: m.role,
    is_active: m.isActive ?? true,
    view_props: m.viewProps ?? {},
    default_props: m.defaultProps ?? {},
    preferences: m.preferences ?? {},
    sort_order: m.sortOrder ?? 65535,
    created_at: m.createdAt?.toISOString() ?? null,
    updated_at: m.updatedAt?.toISOString() ?? null,
  };
}

function formatState(s: typeof states.$inferSelect) {
  return {
    id: s.id,
    project_id: s.projectId,
    workspace_id: s.workspaceId,
    name: s.name,
    color: s.color,
    group: s.group,
    description: s.description ?? "",
    sequence: s.sequence ?? 65535,
    is_default: s.isDefault ?? false,
    created_at: s.createdAt?.toISOString() ?? null,
    updated_at: s.updatedAt?.toISOString() ?? null,
  };
}

function formatLabel(l: typeof labels.$inferSelect) {
  return {
    id: l.id,
    project_id: l.projectId,
    workspace_id: l.workspaceId,
    parent_id: l.parentId ?? null,
    name: l.name,
    color: l.color,
    description: l.description ?? "",
    sort_order: l.sortOrder ?? 65535,
    created_by_id: l.createdById ?? null,
    created_at: l.createdAt?.toISOString() ?? null,
    updated_at: l.updatedAt?.toISOString() ?? null,
  };
}

function formatEstimate(e: typeof estimates.$inferSelect, points?: (typeof estimatePoints.$inferSelect)[]) {
  return {
    id: e.id,
    project_id: e.projectId,
    workspace_id: e.workspaceId,
    name: e.name,
    description: e.description ?? "",
    type: e.type ?? "categories",
    last_used_at: e.lastUsedAt?.toISOString() ?? null,
    created_by_id: e.createdById ?? null,
    created_at: e.createdAt?.toISOString() ?? null,
    updated_at: e.updatedAt?.toISOString() ?? null,
    points: points?.map(formatEstimatePoint) ?? [],
  };
}

function formatEstimatePoint(p: typeof estimatePoints.$inferSelect) {
  return {
    id: p.id,
    estimate_id: p.estimateId,
    key: p.key,
    value: p.value,
    description: p.description ?? "",
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
  };
}

// Default states for new projects (matching Django's DEFAULT_STATES)
const DEFAULT_STATES = [
  { name: "Backlog", color: "#60646C", group: "backlog", sequence: 15000, default: true },
  { name: "Todo", color: "#60646C", group: "unstarted", sequence: 25000, default: false },
  { name: "In Progress", color: "#F59E0B", group: "started", sequence: 35000, default: false },
  { name: "Done", color: "#46A758", group: "completed", sequence: 45000, default: false },
  { name: "Cancelled", color: "#9AA4BC", group: "cancelled", sequence: 55000, default: false },
];

// =====================================================
// 4.1 Project CRUD
// =====================================================

// GET / - List projects for workspace (minimal response matching Django's .values())
projectRoutes.get("/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  // Get user's workspace role
  const wsMembership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true)
    ),
  });

  // Get user's project memberships with sort_order
  const userMemberships = await db
    .select({
      projectId: projectMembers.projectId,
      role: projectMembers.role,
      sortOrder: projectMembers.sortOrder,
    })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.memberId, user.id),
      eq(projectMembers.isActive, true)
    ));

  const memberProjectIds = new Set(userMemberships.map((m) => m.projectId));
  const memberRoleMap = new Map(userMemberships.map((m) => [m.projectId, m.role]));
  const memberSortOrderMap = new Map(userMemberships.map((m) => [m.projectId, m.sortOrder]));

  // Get all workspace projects (not soft-deleted)
  const allProjects = await db.query.projects.findMany({
    where: and(
      eq(projects.workspaceId, workspace.id),
      isNull(projects.deletedAt)
    ),
    orderBy: [asc(projects.sortOrder), asc(projects.name)],
  });

  // Filter based on workspace role (matching Django's behavior)
  let visibleProjects = allProjects;
  const wsRole = wsMembership?.role;

  if (wsRole === ROLES.GUEST) {
    // Guests only see projects they are members of
    visibleProjects = allProjects.filter((p) => memberProjectIds.has(p.id));
  } else if (wsRole === ROLES.MEMBER) {
    // Members see projects they are members of + public projects
    visibleProjects = allProjects.filter(
      (p) => memberProjectIds.has(p.id) || p.network === 2
    );
  }
  // Admins see all projects

  // Return minimal response matching Django's .values() call
  const results = visibleProjects.map((p) => ({
    id: p.id,
    name: p.name,
    identifier: p.identifier,
    sort_order: memberSortOrderMap.get(p.id) ?? p.sortOrder ?? 65535,
    logo_props: p.logoProps ?? {},
    member_role: memberRoleMap.get(p.id) ?? null,
    archived_at: p.archivedAt?.toISOString() ?? null,
    workspace: p.workspaceId,
    cycle_view: p.cycleView ?? true,
    issue_views_view: p.issueViewsView ?? true,
    module_view: p.moduleView ?? true,
    page_view: p.pageView ?? true,
    inbox_view: p.intakeView ?? false,
    guest_view_all_features: p.guestViewAllFeatures ?? false,
    project_lead: p.projectLeadId ?? null,
    network: p.network ?? 2,
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
    created_by: p.createdById ?? null,
    updated_by: null,
  }));

  return c.json(results);
});

// POST / - Create project
projectRoutes.post("/", requireWorkspaceMember, zValidator("json", createProjectSchema), async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  // Generate or validate identifier
  let identifier = body.identifier;
  if (!identifier) {
    const existingIdentifiers = await db
      .select({ identifier: projects.identifier })
      .from(projects)
      .where(eq(projects.workspaceId, workspace.id));
    identifier = generateIdentifier(
      body.name,
      existingIdentifiers.map((e) => e.identifier)
    );
  } else {
    // Check identifier uniqueness within workspace
    const existing = await db.query.projects.findFirst({
      where: and(
        eq(projects.workspaceId, workspace.id),
        eq(projects.identifier, identifier)
      ),
    });
    if (existing) {
      return c.json({ identifier: ["A project with this identifier already exists in the workspace."] }, 400);
    }
  }

  // Create project
  const result = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: body.name,
      identifier,
      description: body.description,
      descriptionText: body.description_text,
      descriptionHtml: body.description_html,
      network: body.network ?? 2,
      emoji: body.emoji,
      iconProp: body.icon_prop,
      logoProps: body.logo_props,
      coverImage: body.cover_image,
      projectLeadId: body.project_lead,
      defaultAssigneeId: body.default_assignee,
      createdById: user.id,
    })
    .returning();
  const project = result[0]!;

  // Add creator as admin member
  await db.insert(projectMembers).values({
    projectId: project.id,
    memberId: user.id,
    role: ROLES.ADMIN,
  });

  // Add project_lead as admin member if different from creator (matching Django)
  if (body.project_lead && body.project_lead !== user.id) {
    await db.insert(projectMembers).values({
      projectId: project.id,
      memberId: body.project_lead,
      role: ROLES.ADMIN,
    });
  }

  // Create default states
  for (const state of DEFAULT_STATES) {
    await db.insert(states).values({
      projectId: project.id,
      workspaceId: workspace.id,
      name: state.name,
      color: state.color,
      group: state.group,
      sequence: state.sequence,
      isDefault: state.default,
    });
  }

  return c.json(formatProject(project, {
    memberCount: 1,
    isMember: true,
    memberRole: ROLES.ADMIN,
  }), 201);
});

// GET /details/ - Get all projects with detailed info (matching Django's list_detail)
projectRoutes.get("/details/", async (c) => {
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!workspace || !user) return c.json({ detail: "Not found." }, 404);

  // Get user's workspace role
  const wsMembership = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true)
    ),
  });

  const allProjects = await db.query.projects.findMany({
    where: and(
      eq(projects.workspaceId, workspace.id),
      isNull(projects.deletedAt)
    ),
    orderBy: [asc(projects.sortOrder), asc(projects.name)],
  });

  // Get user's project memberships
  const userMemberships = await db
    .select({
      projectId: projectMembers.projectId,
      role: projectMembers.role,
      sortOrder: projectMembers.sortOrder,
    })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.memberId, user.id),
      eq(projectMembers.isActive, true)
    ));

  const memberProjectIds = new Set(userMemberships.map((m) => m.projectId));
  const memberRoleMap = new Map(userMemberships.map((m) => [m.projectId, m.role]));
  const memberSortOrderMap = new Map(userMemberships.map((m) => [m.projectId, m.sortOrder]));

  // Filter based on workspace role
  let visibleProjects = allProjects;
  const wsRole = wsMembership?.role;

  if (wsRole === ROLES.GUEST) {
    visibleProjects = allProjects.filter((p) => memberProjectIds.has(p.id));
  } else if (wsRole === ROLES.MEMBER) {
    visibleProjects = allProjects.filter(
      (p) => memberProjectIds.has(p.id) || p.network === 2
    );
  }

  if (visibleProjects.length === 0) {
    return c.json([]);
  }

  const projectIds = visibleProjects.map((p) => p.id);

  // Get member counts
  const memberCounts = await db
    .select({
      projectId: projectMembers.projectId,
      count: countFn(),
    })
    .from(projectMembers)
    .where(and(
      inArray(projectMembers.projectId, projectIds),
      eq(projectMembers.isActive, true)
    ))
    .groupBy(projectMembers.projectId);

  const countMap = new Map(memberCounts.map((mc) => [mc.projectId, mc.count]));

  // Get favorites for the user
  const userFavorites = await db
    .select({ entityId: favorites.entityId })
    .from(favorites)
    .where(and(
      eq(favorites.userId, user.id),
      eq(favorites.workspaceId, workspace.id),
      eq(favorites.entityType, "project")
    ));

  const favoriteProjectIds = new Set(userFavorites.map((f) => f.entityId).filter(Boolean));

  // Get active member IDs per project
  const allMembers = await db
    .select({
      projectId: projectMembers.projectId,
      memberId: projectMembers.memberId,
    })
    .from(projectMembers)
    .where(and(
      inArray(projectMembers.projectId, projectIds),
      eq(projectMembers.isActive, true)
    ));

  const membersMap = new Map<string, string[]>();
  for (const m of allMembers) {
    const list = membersMap.get(m.projectId) ?? [];
    list.push(m.memberId);
    membersMap.set(m.projectId, list);
  }

  const results = visibleProjects.map((p) =>
    formatProject(p, {
      memberCount: countMap.get(p.id) ?? 0,
      isFavorite: favoriteProjectIds.has(p.id),
      isMember: memberProjectIds.has(p.id),
      memberRole: memberRoleMap.get(p.id) ?? null,
      sortOrder: memberSortOrderMap.get(p.id) ?? p.sortOrder ?? 65535,
      members: membersMap.get(p.id) ?? [],
    })
  );

  return c.json(results);
});

// GET /identifiers/ - List project identifiers (for uniqueness check)
projectRoutes.get("/identifiers/", async (c) => {
  const workspace = c.get("workspace");
  if (!workspace) return c.json({ detail: "Not found." }, 404);

  const identifiers = await db
    .select({ identifier: projects.identifier })
    .from(projects)
    .where(eq(projects.workspaceId, workspace.id));

  return c.json(identifiers.map((i) => i.identifier));
});

// Apply project middleware for :projectId routes
projectRoutes.use("/:projectId/*", projectMiddleware);
projectRoutes.use("/:projectId", projectMiddleware);

// GET /:projectId/ - Get project (matching Django's retrieve)
projectRoutes.get("/:projectId/", async (c) => {
  const project = c.get("project");
  const user = c.get("user");
  const workspace = c.get("workspace");
  if (!project || !user || !workspace) return c.json({ detail: "Not found." }, 404);

  const fullProject = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, project.id),
      isNull(projects.archivedAt)
    ),
  });

  if (!fullProject) return c.json({ error: "Project does not exist" }, 404);

  // Check if user is a member
  const membership = c.get("projectMembership");
  if (!membership) {
    // Not a member - check if project is secret or public
    if (fullProject.network === 0) {
      return c.json({ error: "You do not have permission" }, 403);
    } else {
      return c.json({ error: "You are not a member of this project" }, 409);
    }
  }

  // Get member count
  const memberCountResult = await db
    .select({ count: countFn() })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.isActive, true)
    ));

  // Get member IDs
  const membersList = await db
    .select({ memberId: projectMembers.memberId })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.isActive, true)
    ));

  // Check if favorited
  const fav = await db.query.favorites.findFirst({
    where: and(
      eq(favorites.userId, user.id),
      eq(favorites.entityType, "project"),
      eq(favorites.entityId, project.id)
    ),
  });

  // Log recent visit
  try {
    await db.insert(recentVisits).values({
      workspaceId: workspace.id,
      userId: user.id,
      entityType: "project",
      entityId: project.id,
    });
  } catch {
    // Non-critical, ignore errors
  }

  return c.json(formatProject(fullProject, {
    memberCount: memberCountResult[0]?.count ?? 0,
    isFavorite: !!fav,
    isMember: true,
    memberRole: membership.role,
    members: membersList.map((m) => m.memberId),
  }));
});

// PATCH /:projectId/ - Update project (matching Django's partial_update)
projectRoutes.patch("/:projectId/", zValidator("json", updateProjectSchema), async (c) => {
  const project = c.get("project");
  const user = c.get("user");
  const workspace = c.get("workspace");
  if (!project || !user || !workspace) return c.json({ detail: "Not found." }, 404);

  // Check if user is workspace admin or project admin (matching Django)
  const isWorkspaceAdmin = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true),
      eq(workspaceMembers.role, ROLES.ADMIN)
    ),
  });

  const isProjectAdmin = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.memberId, user.id),
      eq(projectMembers.role, ROLES.ADMIN),
      eq(projectMembers.isActive, true)
    ),
  });

  if (!isProjectAdmin && !isWorkspaceAdmin) {
    return c.json({ error: "You don't have the required permissions." }, 403);
  }

  // Check if project is archived
  const fullProject = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });
  if (fullProject?.archivedAt) {
    return c.json({ error: "Archived projects cannot be updated" }, 400);
  }

  const body = c.req.valid("json");

  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.description_text !== undefined) updateData.descriptionText = body.description_text;
  if (body.description_html !== undefined) updateData.descriptionHtml = body.description_html;
  if (body.network !== undefined) updateData.network = body.network;
  if (body.emoji !== undefined) updateData.emoji = body.emoji;
  if (body.icon_prop !== undefined) updateData.iconProp = body.icon_prop;
  if (body.logo_props !== undefined) updateData.logoProps = body.logo_props;
  if (body.cover_image !== undefined) updateData.coverImage = body.cover_image;
  if (body.project_lead !== undefined) updateData.projectLeadId = body.project_lead;
  if (body.default_assignee !== undefined) updateData.defaultAssigneeId = body.default_assignee;
  if (body.archive_in !== undefined) updateData.archiveIn = body.archive_in;
  if (body.close_in !== undefined) updateData.closeIn = body.close_in;
  if (body.estimate_id !== undefined) updateData.estimateId = body.estimate_id;
  if (body.default_state_id !== undefined) updateData.defaultStateId = body.default_state_id;
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;
  if (body.cycle_view !== undefined) updateData.cycleView = body.cycle_view;
  if (body.module_view !== undefined) updateData.moduleView = body.module_view;
  if (body.page_view !== undefined) updateData.pageView = body.page_view;
  if (body.issue_views_view !== undefined) updateData.issueViewsView = body.issue_views_view;
  if (body.guest_view_all_features !== undefined) updateData.guestViewAllFeatures = body.guest_view_all_features;
  if (body.is_time_tracking_enabled !== undefined) updateData.isTimeTrackingEnabled = body.is_time_tracking_enabled;
  if (body.is_issue_type_enabled !== undefined) updateData.isIssueTypeEnabled = body.is_issue_type_enabled;
  // Map inbox_view to intake_view (Django compatibility)
  if (body.inbox_view !== undefined) updateData.intakeView = body.inbox_view;

  await db.update(projects).set(updateData).where(eq(projects.id, project.id));

  const updated = await db.query.projects.findFirst({
    where: eq(projects.id, project.id),
  });

  const memberCountResult = await db
    .select({ count: countFn() })
    .from(projectMembers)
    .where(and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.isActive, true)
    ));

  const membership = c.get("projectMembership");

  return c.json(formatProject(updated!, {
    memberCount: memberCountResult[0]?.count ?? 0,
    isMember: !!membership,
    memberRole: membership?.role ?? null,
  }));
});

// DELETE /:projectId/ - Delete project (matching Django's destroy)
projectRoutes.delete("/:projectId/", async (c) => {
  const project = c.get("project");
  const user = c.get("user");
  const workspace = c.get("workspace");
  if (!project || !user || !workspace) return c.json({ detail: "Not found." }, 404);

  // Check if user is workspace admin or project admin (matching Django)
  const isWorkspaceAdmin = await db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspace.id),
      eq(workspaceMembers.userId, user.id),
      eq(workspaceMembers.isActive, true),
      eq(workspaceMembers.role, ROLES.ADMIN)
    ),
  });

  const isProjectAdmin = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.memberId, user.id),
      eq(projectMembers.role, ROLES.ADMIN),
      eq(projectMembers.isActive, true)
    ),
  });

  if (!isProjectAdmin && !isWorkspaceAdmin) {
    return c.json({ error: "You don't have the required permissions." }, 403);
  }

  // Delete favorites for this project
  await db.delete(favorites).where(and(
    eq(favorites.projectId, project.id),
    eq(favorites.workspaceId, workspace.id)
  ));

  // Soft delete the project (set deletedAt)
  await db.update(projects).set({
    deletedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(projects.id, project.id));

  return new Response(null, { status: 204 });
});

// =====================================================
// 4.2 Project Members
// =====================================================

// GET /:projectId/members/ - List project members
projectRoutes.get("/:projectId/members/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const members = await db
    .select({
      membership: projectMembers,
      user: users,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.memberId, users.id))
    .where(eq(projectMembers.projectId, project.id));

  return c.json(members.map((m) => formatMember(m.membership, m.user)));
});

// POST /:projectId/members/ - Add members
projectRoutes.post("/:projectId/members/", requireProjectAdmin, zValidator("json", addMembersSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  if (!project || !workspace) return c.json({ detail: "Not found." }, 404);

  const { members } = c.req.valid("json");
  const added = [];

  for (const member of members) {
    // Verify user exists and is a workspace member
    const wsMembership = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspace.id),
        eq(workspaceMembers.userId, member.member_id)
      ),
    });

    if (!wsMembership) continue;

    // Check if already a project member
    const existing = await db.query.projectMembers.findFirst({
      where: and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.memberId, member.member_id)
      ),
    });

    if (existing) continue;

    const memberUser = await db.query.users.findFirst({
      where: eq(users.id, member.member_id),
    });

    if (!memberUser) continue;

    const memberResult = await db
      .insert(projectMembers)
      .values({
        projectId: project.id,
        memberId: member.member_id,
        role: member.role,
      })
      .returning();

    added.push(formatMember(memberResult[0]!, memberUser));
  }

  return c.json(added, 201);
});

// GET /:projectId/members/me/ - Get current user's membership
projectRoutes.get("/:projectId/members/me/", async (c) => {
  const project = c.get("project");
  const user = c.get("user");
  if (!project || !user) return c.json({ detail: "Not found." }, 404);

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.memberId, user.id)
    ),
  });

  if (!membership) {
    return c.json({ detail: "You are not a member of this project." }, 404);
  }

  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  return c.json(formatMember(membership, dbUser!));
});

// PATCH /:projectId/members/:memberId/ - Update member
projectRoutes.patch("/:projectId/members/:memberId/", requireProjectAdmin, zValidator("json", updateMemberSchema), async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const memberId = c.req.param("memberId");
  const body = c.req.valid("json");

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.id, memberId),
      eq(projectMembers.projectId, project.id)
    ),
  });

  if (!membership) return c.json({ detail: "Member not found." }, 404);

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.role !== undefined) updateData.role = body.role;
  if (body.view_props !== undefined) updateData.viewProps = body.view_props;
  if (body.default_props !== undefined) updateData.defaultProps = body.default_props;
  if (body.preferences !== undefined) updateData.preferences = body.preferences;
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

  await db.update(projectMembers).set(updateData).where(eq(projectMembers.id, memberId));

  const updated = await db.query.projectMembers.findFirst({
    where: eq(projectMembers.id, memberId),
  });

  const memberUser = await db.query.users.findFirst({
    where: eq(users.id, updated!.memberId),
  });

  return c.json(formatMember(updated!, memberUser!));
});

// DELETE /:projectId/members/:memberId/ - Remove member
projectRoutes.delete("/:projectId/members/:memberId/", requireProjectAdmin, async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const memberId = c.req.param("memberId");

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.id, memberId),
      eq(projectMembers.projectId, project.id)
    ),
  });

  if (!membership) return c.json({ detail: "Member not found." }, 404);

  // Cannot remove yourself if you're the only admin
  const adminCount = await db
    .select({ count: countFn() })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, project.id),
        eq(projectMembers.role, ROLES.ADMIN)
      )
    );

  if (membership.role === ROLES.ADMIN && (adminCount[0]?.count ?? 0) <= 1) {
    return c.json({ detail: "Cannot remove the last admin from the project." }, 400);
  }

  await db.delete(projectMembers).where(eq(projectMembers.id, memberId));

  return new Response(null, { status: 204 });
});

// =====================================================
// 4.3 Project States
// =====================================================

// GET /:projectId/states/ - List states
projectRoutes.get("/:projectId/states/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const stateList = await db.query.states.findMany({
    where: eq(states.projectId, project.id),
    orderBy: [asc(states.sequence)],
  });

  return c.json(stateList.map(formatState));
});

// POST /:projectId/states/ - Create state
projectRoutes.post("/:projectId/states/", requireProjectMember, zValidator("json", createStateSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  if (!project || !workspace) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  const result = await db
    .insert(states)
    .values({
      projectId: project.id,
      workspaceId: workspace.id,
      name: body.name,
      color: body.color,
      group: body.group,
      description: body.description,
      sequence: body.sequence ?? 65535,
      isDefault: body.is_default ?? false,
    })
    .returning();

  // If marking as default, unset other defaults
  if (body.is_default) {
    await db
      .update(states)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(states.projectId, project.id),
          sql`${states.id} != ${result[0]!.id}`
        )
      );
  }

  return c.json(formatState(result[0]!), 201);
});

// PATCH /:projectId/states/:stateId/ - Update state
projectRoutes.patch("/:projectId/states/:stateId/", requireProjectMember, zValidator("json", updateStateSchema), async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const stateId = c.req.param("stateId");

  const state = await db.query.states.findFirst({
    where: and(eq(states.id, stateId), eq(states.projectId, project.id)),
  });

  if (!state) return c.json({ detail: "State not found." }, 404);

  const body = c.req.valid("json");
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updateData.name = body.name;
  if (body.color !== undefined) updateData.color = body.color;
  if (body.group !== undefined) updateData.group = body.group;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.sequence !== undefined) updateData.sequence = body.sequence;
  if (body.is_default !== undefined) updateData.isDefault = body.is_default;

  await db.update(states).set(updateData).where(eq(states.id, stateId));

  // If marking as default, unset other defaults
  if (body.is_default) {
    await db
      .update(states)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(states.projectId, project.id),
          sql`${states.id} != ${stateId}`
        )
      );
  }

  const updated = await db.query.states.findFirst({
    where: eq(states.id, stateId),
  });

  return c.json(formatState(updated!));
});

// DELETE /:projectId/states/:stateId/ - Delete state
projectRoutes.delete("/:projectId/states/:stateId/", requireProjectMember, async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const stateId = c.req.param("stateId");

  const state = await db.query.states.findFirst({
    where: and(eq(states.id, stateId), eq(states.projectId, project.id)),
  });

  if (!state) return c.json({ detail: "State not found." }, 404);

  // Cannot delete default state
  if (state.isDefault) {
    return c.json({ detail: "Cannot delete the default state. Set another state as default first." }, 400);
  }

  await db.delete(states).where(eq(states.id, stateId));

  return new Response(null, { status: 204 });
});

// POST /:projectId/states/:stateId/mark-default/ - Mark state as default
projectRoutes.post("/:projectId/states/:stateId/mark-default/", requireProjectMember, async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const stateId = c.req.param("stateId");

  const state = await db.query.states.findFirst({
    where: and(eq(states.id, stateId), eq(states.projectId, project.id)),
  });

  if (!state) return c.json({ detail: "State not found." }, 404);

  // Unset all defaults for this project
  await db
    .update(states)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(states.projectId, project.id));

  // Set this state as default
  await db
    .update(states)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(states.id, stateId));

  // Also update project's default state
  await db
    .update(projects)
    .set({ defaultStateId: stateId, updatedAt: new Date() })
    .where(eq(projects.id, project.id));

  const updated = await db.query.states.findFirst({
    where: eq(states.id, stateId),
  });

  return c.json(formatState(updated!));
});

// =====================================================
// 4.4 Project Labels
// =====================================================

// GET /:projectId/labels/ - List labels
projectRoutes.get("/:projectId/labels/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const labelList = await db.query.labels.findMany({
    where: eq(labels.projectId, project.id),
    orderBy: [asc(labels.sortOrder)],
  });

  return c.json(labelList.map(formatLabel));
});

// POST /:projectId/labels/ - Create label
projectRoutes.post("/:projectId/labels/", requireProjectMember, zValidator("json", createLabelSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  const result = await db
    .insert(labels)
    .values({
      projectId: project.id,
      workspaceId: workspace.id,
      name: body.name,
      color: body.color ?? "#000000",
      description: body.description,
      parentId: body.parent_id,
      sortOrder: body.sort_order ?? 65535,
      createdById: user.id,
    })
    .returning();

  return c.json(formatLabel(result[0]!), 201);
});

// PATCH /:projectId/labels/:labelId/ - Update label
projectRoutes.patch("/:projectId/labels/:labelId/", requireProjectMember, zValidator("json", updateLabelSchema), async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const labelId = c.req.param("labelId");

  const label = await db.query.labels.findFirst({
    where: and(eq(labels.id, labelId), eq(labels.projectId, project.id)),
  });

  if (!label) return c.json({ detail: "Label not found." }, 404);

  const body = c.req.valid("json");
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updateData.name = body.name;
  if (body.color !== undefined) updateData.color = body.color;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.parent_id !== undefined) updateData.parentId = body.parent_id;
  if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

  await db.update(labels).set(updateData).where(eq(labels.id, labelId));

  const updated = await db.query.labels.findFirst({
    where: eq(labels.id, labelId),
  });

  return c.json(formatLabel(updated!));
});

// DELETE /:projectId/labels/:labelId/ - Delete label
projectRoutes.delete("/:projectId/labels/:labelId/", requireProjectMember, async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const labelId = c.req.param("labelId");

  const label = await db.query.labels.findFirst({
    where: and(eq(labels.id, labelId), eq(labels.projectId, project.id)),
  });

  if (!label) return c.json({ detail: "Label not found." }, 404);

  await db.delete(labels).where(eq(labels.id, labelId));

  return new Response(null, { status: 204 });
});

// =====================================================
// 4.5 Project Estimates
// =====================================================

// GET /:projectId/estimates/ - List estimates
projectRoutes.get("/:projectId/estimates/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const estimateList = await db.query.estimates.findMany({
    where: eq(estimates.projectId, project.id),
    orderBy: [desc(estimates.createdAt)],
  });

  // Get points for all estimates
  const allPoints = await db.query.estimatePoints.findMany({
    where: inArray(
      estimatePoints.estimateId,
      estimateList.map((e) => e.id)
    ),
    orderBy: [asc(estimatePoints.key)],
  });

  const pointsByEstimate = new Map<string, (typeof estimatePoints.$inferSelect)[]>();
  for (const point of allPoints) {
    const existing = pointsByEstimate.get(point.estimateId) ?? [];
    existing.push(point);
    pointsByEstimate.set(point.estimateId, existing);
  }

  return c.json(
    estimateList.map((e) => formatEstimate(e, pointsByEstimate.get(e.id) ?? []))
  );
});

// POST /:projectId/estimates/ - Create estimate
projectRoutes.post("/:projectId/estimates/", requireProjectAdmin, zValidator("json", createEstimateSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  const result = await db
    .insert(estimates)
    .values({
      projectId: project.id,
      workspaceId: workspace.id,
      name: body.name,
      description: body.description,
      type: body.type ?? "categories",
      createdById: user.id,
    })
    .returning();

  return c.json(formatEstimate(result[0]!, []), 201);
});

// PATCH /:projectId/estimates/:estimateId/ - Update estimate
projectRoutes.patch("/:projectId/estimates/:estimateId/", requireProjectAdmin, zValidator("json", updateEstimateSchema), async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const estimateId = c.req.param("estimateId");

  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, estimateId), eq(estimates.projectId, project.id)),
  });

  if (!estimate) return c.json({ detail: "Estimate not found." }, 404);

  const body = c.req.valid("json");
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.type !== undefined) updateData.type = body.type;

  await db.update(estimates).set(updateData).where(eq(estimates.id, estimateId));

  const updated = await db.query.estimates.findFirst({
    where: eq(estimates.id, estimateId),
  });

  const points = await db.query.estimatePoints.findMany({
    where: eq(estimatePoints.estimateId, estimateId),
    orderBy: [asc(estimatePoints.key)],
  });

  return c.json(formatEstimate(updated!, points));
});

// DELETE /:projectId/estimates/:estimateId/ - Delete estimate
projectRoutes.delete("/:projectId/estimates/:estimateId/", requireProjectAdmin, async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const estimateId = c.req.param("estimateId");

  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, estimateId), eq(estimates.projectId, project.id)),
  });

  if (!estimate) return c.json({ detail: "Estimate not found." }, 404);

  // Clear project's estimate reference if this is the active one
  await db
    .update(projects)
    .set({ estimateId: null, updatedAt: new Date() })
    .where(and(eq(projects.id, project.id), eq(projects.estimateId, estimateId)));

  // Delete points first (cascade should handle this, but be explicit)
  await db.delete(estimatePoints).where(eq(estimatePoints.estimateId, estimateId));
  await db.delete(estimates).where(eq(estimates.id, estimateId));

  return new Response(null, { status: 204 });
});

// --- Estimate Points sub-routes ---

// GET /:projectId/estimates/:estimateId/points/ - List estimate points
projectRoutes.get("/:projectId/estimates/:estimateId/points/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const estimateId = c.req.param("estimateId");

  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, estimateId), eq(estimates.projectId, project.id)),
  });

  if (!estimate) return c.json({ detail: "Estimate not found." }, 404);

  const points = await db.query.estimatePoints.findMany({
    where: eq(estimatePoints.estimateId, estimateId),
    orderBy: [asc(estimatePoints.key)],
  });

  return c.json(points.map(formatEstimatePoint));
});

// POST /:projectId/estimates/:estimateId/points/ - Create estimate point
projectRoutes.post("/:projectId/estimates/:estimateId/points/", requireProjectAdmin, zValidator("json", createEstimatePointSchema), async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const estimateId = c.req.param("estimateId");

  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, estimateId), eq(estimates.projectId, project.id)),
  });

  if (!estimate) return c.json({ detail: "Estimate not found." }, 404);

  const body = c.req.valid("json");

  const result = await db
    .insert(estimatePoints)
    .values({
      estimateId,
      key: body.key,
      value: body.value,
      description: body.description,
    })
    .returning();

  return c.json(formatEstimatePoint(result[0]!), 201);
});

// PATCH /:projectId/estimates/:estimateId/points/:pointId/ - Update estimate point
projectRoutes.patch("/:projectId/estimates/:estimateId/points/:pointId/", requireProjectAdmin, zValidator("json", updateEstimatePointSchema), async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const estimateId = c.req.param("estimateId");
  const pointId = c.req.param("pointId");

  const point = await db.query.estimatePoints.findFirst({
    where: and(
      eq(estimatePoints.id, pointId),
      eq(estimatePoints.estimateId, estimateId)
    ),
  });

  if (!point) return c.json({ detail: "Estimate point not found." }, 404);

  const body = c.req.valid("json");
  const updateData: Record<string, unknown> = { updatedAt: new Date() };

  if (body.key !== undefined) updateData.key = body.key;
  if (body.value !== undefined) updateData.value = body.value;
  if (body.description !== undefined) updateData.description = body.description;

  await db.update(estimatePoints).set(updateData).where(eq(estimatePoints.id, pointId));

  const updated = await db.query.estimatePoints.findFirst({
    where: eq(estimatePoints.id, pointId),
  });

  return c.json(formatEstimatePoint(updated!));
});

// DELETE /:projectId/estimates/:estimateId/points/:pointId/ - Delete estimate point
projectRoutes.delete("/:projectId/estimates/:estimateId/points/:pointId/", requireProjectAdmin, async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const estimateId = c.req.param("estimateId");
  const pointId = c.req.param("pointId");

  const point = await db.query.estimatePoints.findFirst({
    where: and(
      eq(estimatePoints.id, pointId),
      eq(estimatePoints.estimateId, estimateId)
    ),
  });

  if (!point) return c.json({ detail: "Estimate point not found." }, 404);

  await db.delete(estimatePoints).where(eq(estimatePoints.id, pointId));

  return new Response(null, { status: 204 });
});

export { projectRoutes };

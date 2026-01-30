import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and, or, desc, asc, isNull, isNotNull, inArray, sql, count as countFn, max, like, lt, lte, gte, ne } from "drizzle-orm";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import {
  projects,
  projectMembers,
  states,
  labels,
  estimates,
  estimatePoints,
  projectUserProperties,
} from "../../db/schema/project";
import { workspaces, workspaceMembers, favorites, recentVisits } from "../../db/schema/workspace";
import { cycles, cycleIssues, cycleFavorites, cycleUserProperties } from "../../db/schema/cycle";
import { modules, moduleIssues, moduleMembers, moduleFavorites, moduleLinks, moduleUserProperties } from "../../db/schema/module";
import { issues, issueAssignees, issueDescriptionVersions } from "../../db/schema/issue";
import { views, viewFavorites } from "../../db/schema/view";
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

// GET /:projectId/project-members/me/ - Get current user's membership (Django-compatible URL)
// Matches Django's ProjectMemberUserEndpoint
projectRoutes.get("/:projectId/project-members/me/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !user || !workspace) return c.json({ detail: "Not found." }, 404);

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.memberId, user.id),
      eq(projectMembers.isActive, true)
    ),
  });

  if (!membership) {
    return c.json({ detail: "Project Member not found." }, 404);
  }

  const dbUser = await db.query.users.findFirst({
    where: eq(users.id, user.id),
  });

  return c.json(formatMember(membership, dbUser!));
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

// GET /:projectId/intake-state/ - Get triage state for project
projectRoutes.get("/:projectId/intake-state/", async (c) => {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const state = await db.query.states.findFirst({
    where: and(eq(states.projectId, project.id), eq(states.group, "triage")),
  });

  if (!state) {
    return c.json({ error: "Triage state not found" }, 404);
  }

  return c.json(formatState(state));
});

// =====================================================
// 4.4 Project Labels
// =====================================================

// Label CRUD handler functions (shared between /labels/ and /issue-labels/ paths)
async function handleListLabels(c: any) {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const labelList = await db.query.labels.findMany({
    where: eq(labels.projectId, project.id),
    orderBy: [asc(labels.sortOrder)],
  });

  return c.json(labelList.map(formatLabel));
}

async function handleCreateLabel(c: any) {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const body = c.req.valid("json");

  // Case-insensitive name uniqueness check per project
  const existing = await db.query.labels.findFirst({
    where: and(
      eq(labels.projectId, project.id),
      sql`LOWER(${labels.name}) = LOWER(${body.name})`
    ),
  });
  if (existing) {
    return c.json({ error: "Label with the same name already exists in the project" }, 400);
  }

  // Auto-calculate sort_order if not provided (max + 10000)
  let sortOrder = body.sort_order;
  if (sortOrder === undefined) {
    const maxResult = await db
      .select({ largest: max(labels.sortOrder) })
      .from(labels)
      .where(eq(labels.projectId, project.id));
    const largest = maxResult[0]?.largest;
    sortOrder = largest != null ? largest + 10000 : 65535;
  }

  try {
    const result = await db
      .insert(labels)
      .values({
        projectId: project.id,
        workspaceId: workspace.id,
        name: body.name,
        color: body.color ?? "#000000",
        description: body.description,
        parentId: body.parent_id,
        sortOrder,
        createdById: user.id,
      })
      .returning();

    return c.json(formatLabel(result[0]!), 201);
  } catch (err: any) {
    if (err?.message?.includes("UNIQUE") || err?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return c.json({ error: "Label with the same name already exists in the project" }, 400);
    }
    throw err;
  }
}

async function handleUpdateLabel(c: any) {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const labelId = c.req.param("labelId");

  const label = await db.query.labels.findFirst({
    where: and(eq(labels.id, labelId), eq(labels.projectId, project.id)),
  });

  if (!label) return c.json({ detail: "Label not found." }, 404);

  const body = c.req.valid("json");

  // Case-insensitive name uniqueness check (excluding current label)
  if (body.name !== undefined) {
    const existing = await db.query.labels.findFirst({
      where: and(
        eq(labels.projectId, project.id),
        sql`LOWER(${labels.name}) = LOWER(${body.name})`,
        sql`${labels.id} != ${labelId}`
      ),
    });
    if (existing) {
      return c.json({ error: "Label with the same name already exists in the project" }, 400);
    }
  }

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
}

async function handleDeleteLabel(c: any) {
  const project = c.get("project");
  if (!project) return c.json({ detail: "Not found." }, 404);

  const labelId = c.req.param("labelId");

  const label = await db.query.labels.findFirst({
    where: and(eq(labels.id, labelId), eq(labels.projectId, project.id)),
  });

  if (!label) return c.json({ detail: "Label not found." }, 404);

  await db.delete(labels).where(eq(labels.id, labelId));

  return c.body(null, 204);
}

// GET /:projectId/labels/ - List labels
projectRoutes.get("/:projectId/labels/", handleListLabels);

// POST /:projectId/labels/ - Create label
projectRoutes.post("/:projectId/labels/", requireProjectMember, zValidator("json", createLabelSchema), handleCreateLabel);

// PATCH /:projectId/labels/:labelId/ - Update label
projectRoutes.patch("/:projectId/labels/:labelId/", requireProjectMember, zValidator("json", updateLabelSchema), handleUpdateLabel);

// DELETE /:projectId/labels/:labelId/ - Delete label
projectRoutes.delete("/:projectId/labels/:labelId/", requireProjectMember, handleDeleteLabel);

// Frontend uses /issue-labels/ path — alias routes
projectRoutes.get("/:projectId/issue-labels/", handleListLabels);
projectRoutes.post("/:projectId/issue-labels/", requireProjectMember, zValidator("json", createLabelSchema), handleCreateLabel);
projectRoutes.patch("/:projectId/issue-labels/:labelId/", requireProjectMember, zValidator("json", updateLabelSchema), handleUpdateLabel);
projectRoutes.delete("/:projectId/issue-labels/:labelId/", requireProjectMember, handleDeleteLabel);

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

// =====================================================
// 4.6 Project User Properties
// =====================================================

const updateProjectUserPropertiesSchema = z.object({
  filters: z.record(z.string(), z.any()).optional(),
  display_filters: z.record(z.string(), z.any()).optional(),
  display_properties: z.record(z.string(), z.any()).optional(),
  rich_filters: z.record(z.string(), z.any()).optional(),
  preferences: z.record(z.string(), z.any()).optional(),
  sort_order: z.number().optional(),
});

function formatProjectUserProperties(p: typeof projectUserProperties.$inferSelect) {
  return {
    id: p.id,
    project: p.projectId,
    workspace: p.workspaceId,
    user: p.userId,
    filters: p.filters ?? {},
    display_filters: p.displayFilters ?? {},
    display_properties: p.displayProperties ?? {},
    rich_filters: p.richFilters ?? {},
    preferences: p.preferences ?? { pages: { block_display: true }, navigation: { default_tab: "work_items", hide_in_more_menu: [] } },
    sort_order: p.sortOrder ?? 65535,
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
  };
}

// GET /:projectId/user-properties/ - Get or create user properties for project
projectRoutes.get("/:projectId/user-properties/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  // Find or create
  let props = await db.query.projectUserProperties.findFirst({
    where: and(
      eq(projectUserProperties.projectId, project.id),
      eq(projectUserProperties.userId, user.id)
    ),
  });

  if (!props) {
    const [created] = await db.insert(projectUserProperties).values({
      projectId: project.id,
      workspaceId: workspace.id,
      userId: user.id,
    }).returning();
    props = created;
  }

  return c.json(formatProjectUserProperties(props!));
});

// PATCH /:projectId/user-properties/ - Update user properties for project
projectRoutes.patch(
  "/:projectId/user-properties/",
  zValidator("json", updateProjectUserPropertiesSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    // Find or create
    let props = await db.query.projectUserProperties.findFirst({
      where: and(
        eq(projectUserProperties.projectId, project.id),
        eq(projectUserProperties.userId, user.id)
      ),
    });

    if (!props) {
      const [created] = await db.insert(projectUserProperties).values({
        projectId: project.id,
        workspaceId: workspace.id,
        userId: user.id,
      }).returning();
      props = created;
    }

    const body = c.req.valid("json");
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (body.filters !== undefined) updateData.filters = body.filters;
    if (body.display_filters !== undefined) updateData.displayFilters = body.display_filters;
    if (body.display_properties !== undefined) updateData.displayProperties = body.display_properties;
    if (body.rich_filters !== undefined) updateData.richFilters = body.rich_filters;
    if (body.preferences !== undefined) updateData.preferences = body.preferences;
    if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

    await db.update(projectUserProperties)
      .set(updateData)
      .where(eq(projectUserProperties.id, props!.id));

    const updated = await db.query.projectUserProperties.findFirst({
      where: eq(projectUserProperties.id, props!.id),
    });

    return c.json(formatProjectUserProperties(updated!));
  }
);

// =====================================================
// 4.7 Project Cycles CRUD
// =====================================================

// Helper: compute cycle status from dates
function computeCycleStatus(startDate: Date | null, endDate: Date | null): string {
  const now = new Date();
  if (!startDate && !endDate) return "DRAFT";
  if (startDate && endDate) {
    if (startDate <= now && endDate >= now) return "CURRENT";
    if (startDate > now) return "UPCOMING";
    if (endDate < now) return "COMPLETED";
  }
  return "DRAFT";
}

// Helper: format a single cycle row for JSON response
function formatCycle(
  c: typeof cycles.$inferSelect,
  stats: { total: number; completed: number; cancelled: number; started: number; unstarted: number; backlog: number },
  isFavorite: boolean,
  assigneeIds: string[],
  extra: Record<string, any> = {}
) {
  return {
    id: c.id,
    workspace_id: c.workspaceId,
    project_id: c.projectId,
    name: c.name,
    description: c.description ?? "",
    start_date: c.startDate?.toISOString() ?? null,
    end_date: c.endDate?.toISOString() ?? null,
    owned_by_id: c.ownedById ?? null,
    view_props: c.viewProps ?? {},
    sort_order: c.sortOrder ?? 65535,
    progress_snapshot: c.progressSnapshot ?? null,
    is_favorite: isFavorite,
    total_issues: stats.total,
    completed_issues: stats.completed,
    cancelled_issues: stats.cancelled,
    started_issues: stats.started ?? 0,
    unstarted_issues: stats.unstarted ?? 0,
    backlog_issues: stats.backlog ?? 0,
    assignee_ids: assigneeIds,
    status: computeCycleStatus(c.startDate, c.endDate),
    archived_at: c.archivedAt?.toISOString() ?? null,
    created_at: c.createdAt?.toISOString() ?? null,
    updated_at: c.updatedAt?.toISOString() ?? null,
    ...extra,
  };
}

// Helper: compute issue statistics for a set of cycle IDs
async function getCycleIssueStats(cycleIdList: string[]) {
  if (cycleIdList.length === 0) return new Map();

  const issueStats = await db
    .select({
      cycleId: cycleIssues.cycleId,
      stateGroup: states.group,
      issueCount: countFn(),
    })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        inArray(cycleIssues.cycleId, cycleIdList),
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
    const existing = statsMap.get(row.cycleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    const cnt = Number(row.issueCount);
    existing.total += cnt;
    switch (row.stateGroup) {
      case "completed": existing.completed += cnt; break;
      case "cancelled": existing.cancelled += cnt; break;
      case "started": existing.started += cnt; break;
      case "unstarted": existing.unstarted += cnt; break;
      case "backlog": existing.backlog += cnt; break;
    }
    statsMap.set(row.cycleId, existing);
  }
  return statsMap;
}

// Helper: get assignee IDs per cycle
async function getCycleAssigneeIds(cycleIdList: string[]) {
  if (cycleIdList.length === 0) return new Map<string, string[]>();

  const rows = await db
    .select({
      cycleId: cycleIssues.cycleId,
      assigneeId: issueAssignees.assigneeId,
    })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(issueAssignees, eq(issues.id, issueAssignees.issueId))
    .where(
      and(
        inArray(cycleIssues.cycleId, cycleIdList),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt)
      )
    );

  const map = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!map.has(r.cycleId)) map.set(r.cycleId, new Set());
    map.get(r.cycleId)!.add(r.assigneeId);
  }
  const result = new Map<string, string[]>();
  for (const [k, v] of map) result.set(k, Array.from(v));
  return result;
}

// Helper: get user favorite cycle IDs
async function getUserFavoriteCycleIds(cycleIdList: string[], userId: string) {
  if (cycleIdList.length === 0) return new Set<string>();
  const favs = await db
    .select({ cycleId: cycleFavorites.cycleId })
    .from(cycleFavorites)
    .where(and(inArray(cycleFavorites.cycleId, cycleIdList), eq(cycleFavorites.userId, userId)));
  return new Set(favs.map((f) => f.cycleId));
}

// GET /:projectId/cycles/ - List project cycles
projectRoutes.get("/:projectId/cycles/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cycleView = c.req.query("cycle_view") || "all";

  // Fetch all non-archived cycles
  let allCycles = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.projectId, project.id), isNull(cycles.archivedAt)))
    .orderBy(desc(cycles.createdAt));

  // Filter by current if requested
  if (cycleView === "current") {
    const now = new Date();
    allCycles = allCycles.filter(
      (cy) => cy.startDate && cy.endDate && cy.startDate <= now && cy.endDate >= now
    );
  }

  if (allCycles.length === 0) return c.json([]);

  const cycleIdList = allCycles.map((cy) => cy.id);

  const [statsMap, assigneeMap, favSet] = await Promise.all([
    getCycleIssueStats(cycleIdList),
    getCycleAssigneeIds(cycleIdList),
    getUserFavoriteCycleIds(cycleIdList, user.id),
  ]);

  const result = allCycles.map((cy) => {
    const stats = statsMap.get(cy.id) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    return formatCycle(cy, stats, favSet.has(cy.id), assigneeMap.get(cy.id) || []);
  });

  // Sort: favorites first, then by created_at descending
  result.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return 0;
  });

  return c.json(result);
});

// POST /:projectId/cycles/ - Create cycle
const createCycleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  owned_by_id: z.string().optional(),
  sort_order: z.number().optional(),
});

projectRoutes.post(
  "/:projectId/cycles/",
  zValidator("json", createCycleSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");

    // Both dates must be present or both null
    const hasStart = body.start_date !== null && body.start_date !== undefined && body.start_date !== "";
    const hasEnd = body.end_date !== null && body.end_date !== undefined && body.end_date !== "";
    if (hasStart !== hasEnd) {
      return c.json({ error: "Both start date and end date are either required or are to be null" }, 400);
    }

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    if (hasStart && hasEnd) {
      startDate = new Date(body.start_date!);
      endDate = new Date(body.end_date!);
      if (startDate > endDate) {
        return c.json({ error: "Start date cannot exceed end date" }, 400);
      }
    }

    // Auto sort_order
    let sortOrder = body.sort_order;
    if (sortOrder === undefined) {
      const maxResult = await db.select({ largest: max(cycles.sortOrder) }).from(cycles).where(eq(cycles.projectId, project.id));
      sortOrder = maxResult[0]?.largest != null ? maxResult[0].largest + 10000 : 65535;
    }

    const [created] = await db
      .insert(cycles)
      .values({
        projectId: project.id,
        workspaceId: workspace.id,
        name: body.name,
        description: body.description ?? null,
        startDate,
        endDate,
        ownedById: body.owned_by_id || user.id,
        sortOrder,
      })
      .returning();

    const emptyStats = { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    return c.json(formatCycle(created, emptyStats, false, []), 201);
  }
);

// GET /:projectId/cycles/:cycleId/ - Retrieve single cycle
projectRoutes.get("/:projectId/cycles/:cycleId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cycleId = c.req.param("cycleId");

  // Don't match sub-routes
  if (cycleId === "date-check") return c.notFound();

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id), isNull(cycles.archivedAt)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  const [statsMap, assigneeMap, favSet] = await Promise.all([
    getCycleIssueStats([cycleId]),
    getCycleAssigneeIds([cycleId]),
    getUserFavoriteCycleIds([cycleId], user.id),
  ]);

  // Count sub-issues (issues with parent that are in this cycle)
  const subIssuesResult = await db
    .select({ count: countFn() })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .where(
      and(
        eq(cycleIssues.cycleId, cycleId),
        isNotNull(issues.parentId),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt)
      )
    );
  const subIssues = Number(subIssuesResult[0]?.count ?? 0);

  const stats = statsMap.get(cycleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };

  return c.json(formatCycle(cycle, stats, favSet.has(cycleId), assigneeMap.get(cycleId) || [], { sub_issues: subIssues }));
});

// GET /:projectId/cycles/:cycleId/progress/ - Cycle progress stats
projectRoutes.get("/:projectId/cycles/:cycleId/progress/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  if (!project || !workspace) return c.json({ detail: "Not found." }, 404);

  const cycleId = c.req.param("cycleId");

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  // If cycle has a progress snapshot (transferred issues), use it
  const snapshot = cycle.progressSnapshot as Record<string, number> | null;
  let backlogIssues: number;
  let unstartedIssues: number;
  let startedIssues: number;
  let cancelledIssues: number;
  let completedIssues: number;
  let totalIssues: number;

  if (snapshot && Object.keys(snapshot).length > 0) {
    backlogIssues = snapshot.backlog_issues ?? 0;
    unstartedIssues = snapshot.unstarted_issues ?? 0;
    startedIssues = snapshot.started_issues ?? 0;
    cancelledIssues = snapshot.cancelled_issues ?? 0;
    completedIssues = snapshot.completed_issues ?? 0;
    totalIssues = snapshot.total_issues ?? 0;
  } else {
    // Compute issue counts by state group from live data
    const statsMap = await getCycleIssueStats([cycleId]);
    const stats = statsMap.get(cycleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    backlogIssues = stats.backlog;
    unstartedIssues = stats.unstarted;
    startedIssues = stats.started;
    cancelledIssues = stats.cancelled;
    completedIssues = stats.completed;
    totalIssues = stats.total;
  }

  // Compute estimate point aggregates
  // Join cycle_issues → issues → states, and sum estimate_point values by state group
  const estimateRows = await db
    .select({
      stateGroup: states.group,
      totalEstimate: sql<number>`COALESCE(SUM(${issues.estimatePoint}), 0)`,
    })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(
      and(
        eq(cycleIssues.cycleId, cycleId),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt),
        isNotNull(issues.estimatePoint)
      )
    )
    .groupBy(states.group);

  let backlogEstimate = 0;
  let unstartedEstimate = 0;
  let startedEstimate = 0;
  let cancelledEstimate = 0;
  let completedEstimate = 0;
  let totalEstimate = 0;

  for (const row of estimateRows) {
    const val = Number(row.totalEstimate) || 0;
    totalEstimate += val;
    switch (row.stateGroup) {
      case "backlog": backlogEstimate = val; break;
      case "unstarted": unstartedEstimate = val; break;
      case "started": startedEstimate = val; break;
      case "cancelled": cancelledEstimate = val; break;
      case "completed": completedEstimate = val; break;
    }
  }

  return c.json({
    backlog_estimate_points: backlogEstimate,
    unstarted_estimate_points: unstartedEstimate,
    started_estimate_points: startedEstimate,
    cancelled_estimate_points: cancelledEstimate,
    completed_estimate_points: completedEstimate,
    total_estimate_points: totalEstimate,
    backlog_issues: backlogIssues,
    total_issues: totalIssues,
    completed_issues: completedIssues,
    cancelled_issues: cancelledIssues,
    started_issues: startedIssues,
    unstarted_issues: unstartedIssues,
  });
});

// PATCH /:projectId/cycles/:cycleId/ - Update cycle
const updateCycleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  owned_by_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
});

projectRoutes.patch(
  "/:projectId/cycles/:cycleId/",
  zValidator("json", updateCycleSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const cycleId = c.req.param("cycleId");

    const cycle = await db.query.cycles.findFirst({
      where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)),
    });
    if (!cycle) return c.json({ error: "Cycle not found" }, 404);

    if (cycle.archivedAt) {
      return c.json({ error: "Archived cycle cannot be updated" }, 400);
    }

    const body = c.req.valid("json");

    // Completed cycle protection: only sort_order can be changed
    if (cycle.endDate && cycle.endDate < new Date()) {
      if (body.sort_order !== undefined) {
        await db.update(cycles).set({ sortOrder: body.sort_order, updatedAt: new Date() }).where(eq(cycles.id, cycleId));
      } else {
        return c.json({ error: "The Cycle has already been completed so it cannot be edited" }, 400);
      }
    } else {
      // Normal update
      const updateData: Record<string, any> = { updatedAt: new Date() };

      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.owned_by_id !== undefined) updateData.ownedById = body.owned_by_id;
      if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

      // Handle dates
      if (body.start_date !== undefined || body.end_date !== undefined) {
        const newStartStr = body.start_date !== undefined ? body.start_date : (cycle.startDate?.toISOString() ?? null);
        const newEndStr = body.end_date !== undefined ? body.end_date : (cycle.endDate?.toISOString() ?? null);
        const hasStart = newStartStr !== null && newStartStr !== "";
        const hasEnd = newEndStr !== null && newEndStr !== "";

        if (hasStart !== hasEnd) {
          return c.json({ error: "Both start date and end date are either required or are to be null" }, 400);
        }

        if (hasStart && hasEnd) {
          const sd = new Date(newStartStr!);
          const ed = new Date(newEndStr!);
          if (sd > ed) {
            return c.json({ error: "Start date cannot exceed end date" }, 400);
          }
          updateData.startDate = sd;
          updateData.endDate = ed;
        } else {
          updateData.startDate = null;
          updateData.endDate = null;
        }
      }

      await db.update(cycles).set(updateData).where(eq(cycles.id, cycleId));
    }

    // Re-fetch and return
    const updated = await db.query.cycles.findFirst({ where: eq(cycles.id, cycleId) });
    const [statsMap, assigneeMap, favSet] = await Promise.all([
      getCycleIssueStats([cycleId]),
      getCycleAssigneeIds([cycleId]),
      getUserFavoriteCycleIds([cycleId], user.id),
    ]);
    const stats = statsMap.get(cycleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };

    return c.json(formatCycle(updated!, stats, favSet.has(cycleId), assigneeMap.get(cycleId) || []));
  }
);

// DELETE /:projectId/cycles/:cycleId/ - Delete cycle
projectRoutes.delete("/:projectId/cycles/:cycleId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cycleId = c.req.param("cycleId");

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  // Delete the cycle (cascade will remove cycle_issues)
  await db.delete(cycles).where(eq(cycles.id, cycleId));

  // Clean up favorites
  await db.delete(cycleFavorites).where(eq(cycleFavorites.cycleId, cycleId));

  // Clean up recent visits
  await db.delete(recentVisits).where(
    and(eq(recentVisits.entityType, "cycle"), eq(recentVisits.entityId, cycleId))
  );

  return c.body(null, 204);
});

// =====================================================
// 4.7.1 Cycle Date Check
// =====================================================

// POST /:projectId/cycles/date-check/ - Check for overlapping dates
projectRoutes.post(
  "/:projectId/cycles/date-check/",
  zValidator("json", z.object({
    start_date: z.string(),
    end_date: z.string(),
    cycle_id: z.string().optional(),
  })),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");
    const startDate = new Date(body.start_date);
    const endDate = new Date(body.end_date);

    // Check for overlapping cycles:
    // existing.start <= new.end AND existing.end >= new.start
    let conditions = [
      eq(cycles.projectId, project.id),
      lte(cycles.startDate, endDate),
      gte(cycles.endDate, startDate),
    ];

    // Build query
    let overlapping;
    if (body.cycle_id) {
      overlapping = await db
        .select({ id: cycles.id })
        .from(cycles)
        .where(and(...conditions, ne(cycles.id, body.cycle_id)))
        .limit(1);
    } else {
      overlapping = await db
        .select({ id: cycles.id })
        .from(cycles)
        .where(and(...conditions))
        .limit(1);
    }

    if (overlapping.length > 0) {
      return c.json({
        error: "You have a cycle already on the given dates, if you want to create a draft cycle you can do that by removing dates",
        status: false,
      });
    }

    return c.json({ status: true });
  }
);

// =====================================================
// 4.7.2 Cycle Favorites
// =====================================================

// POST /:projectId/user-favorite-cycles/ - Add cycle to favorites
projectRoutes.post(
  "/:projectId/user-favorite-cycles/",
  zValidator("json", z.object({ cycle: z.string() })),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");

    await db.insert(cycleFavorites).values({
      cycleId: body.cycle,
      userId: user.id,
    });

    return c.body(null, 204);
  }
);

// DELETE /:projectId/user-favorite-cycles/:cycleId/ - Remove from favorites
projectRoutes.delete("/:projectId/user-favorite-cycles/:cycleId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cycleId = c.req.param("cycleId");

  await db.delete(cycleFavorites).where(
    and(eq(cycleFavorites.cycleId, cycleId), eq(cycleFavorites.userId, user.id))
  );

  return c.body(null, 204);
});

// =====================================================
// 4.7.3 Cycle Archive / Unarchive
// =====================================================

// GET /:projectId/archived-cycles/ - List archived cycles
projectRoutes.get("/:projectId/archived-cycles/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const allCycles = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.projectId, project.id), isNotNull(cycles.archivedAt)))
    .orderBy(desc(cycles.createdAt));

  if (allCycles.length === 0) return c.json([]);

  const cycleIdList = allCycles.map((cy) => cy.id);

  const [statsMap, assigneeMap, favSet] = await Promise.all([
    getCycleIssueStats(cycleIdList),
    getCycleAssigneeIds(cycleIdList),
    getUserFavoriteCycleIds(cycleIdList, user.id),
  ]);

  const result = allCycles.map((cy) => {
    const stats = statsMap.get(cy.id) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    return formatCycle(cy, stats, favSet.has(cy.id), assigneeMap.get(cy.id) || []);
  });

  result.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return 0;
  });

  return c.json(result);
});

// GET /:projectId/archived-cycles/:cycleId/ - Get archived cycle detail
projectRoutes.get("/:projectId/archived-cycles/:cycleId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cycleId = c.req.param("cycleId");

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id), isNotNull(cycles.archivedAt)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  const [statsMap, assigneeMap, favSet] = await Promise.all([
    getCycleIssueStats([cycleId]),
    getCycleAssigneeIds([cycleId]),
    getUserFavoriteCycleIds([cycleId], user.id),
  ]);

  const subIssuesResult = await db
    .select({ count: countFn() })
    .from(cycleIssues)
    .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
    .where(
      and(
        eq(cycleIssues.cycleId, cycleId),
        isNotNull(issues.parentId),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt)
      )
    );
  const subIssues = Number(subIssuesResult[0]?.count ?? 0);

  const stats = statsMap.get(cycleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };

  return c.json(formatCycle(cycle, stats, favSet.has(cycleId), assigneeMap.get(cycleId) || [], { sub_issues: subIssues }));
});

// POST /:projectId/cycles/:cycleId/archive/ - Archive a completed cycle
projectRoutes.post("/:projectId/cycles/:cycleId/archive/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cycleId = c.req.param("cycleId");

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  // Only completed cycles can be archived
  if (!cycle.endDate || cycle.endDate >= new Date()) {
    return c.json({ error: "Only completed cycles can be archived" }, 400);
  }

  const now = new Date();
  await db.update(cycles).set({ archivedAt: now }).where(eq(cycles.id, cycleId));

  // Remove favorites for this cycle
  await db.delete(cycleFavorites).where(eq(cycleFavorites.cycleId, cycleId));

  return c.json({ archived_at: now.toISOString() });
});

// DELETE /:projectId/cycles/:cycleId/archive/ - Unarchive cycle (frontend uses this path)
projectRoutes.delete("/:projectId/cycles/:cycleId/archive/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cycleId = c.req.param("cycleId");

  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)),
  });
  if (!cycle) return c.json({ error: "Cycle not found" }, 404);

  await db.update(cycles).set({ archivedAt: null }).where(eq(cycles.id, cycleId));

  return c.body(null, 204);
});

// =====================================================
// 4.7.4 Transfer Cycle Issues
// =====================================================

// POST /:projectId/cycles/:cycleId/transfer-issues/ - Transfer incomplete issues
projectRoutes.post(
  "/:projectId/cycles/:cycleId/transfer-issues/",
  zValidator("json", z.object({ new_cycle_id: z.string() })),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const cycleId = c.req.param("cycleId");
    const body = c.req.valid("json");

    // Source cycle must be completed
    const sourceCycle = await db.query.cycles.findFirst({
      where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)),
    });
    if (!sourceCycle) return c.json({ error: "Cycle not found" }, 404);

    if (!sourceCycle.endDate || sourceCycle.endDate >= new Date()) {
      return c.json({ error: "Only completed cycles can transfer issues" }, 400);
    }

    // Destination cycle must not be completed
    const destCycle = await db.query.cycles.findFirst({
      where: and(eq(cycles.id, body.new_cycle_id), eq(cycles.projectId, project.id)),
    });
    if (!destCycle) return c.json({ error: "New cycle not found" }, 404);

    if (destCycle.endDate && destCycle.endDate < new Date()) {
      return c.json({ error: "Cannot transfer issues to a completed cycle" }, 400);
    }

    // Get all issues in source cycle with their state groups
    const sourceIssueRows = await db
      .select({
        cycleIssueId: cycleIssues.id,
        issueId: cycleIssues.issueId,
        stateGroup: states.group,
      })
      .from(cycleIssues)
      .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
      .innerJoin(states, eq(issues.stateId, states.id))
      .where(
        and(
          eq(cycleIssues.cycleId, cycleId),
          isNull(issues.archivedAt),
          isNull(issues.deletedAt)
        )
      );

    // Build progress snapshot for source cycle
    const snapshot: Record<string, number> = {
      total_issues: sourceIssueRows.length,
      completed_issues: 0,
      cancelled_issues: 0,
      started_issues: 0,
      unstarted_issues: 0,
      backlog_issues: 0,
    };
    for (const row of sourceIssueRows) {
      switch (row.stateGroup) {
        case "completed": snapshot.completed_issues++; break;
        case "cancelled": snapshot.cancelled_issues++; break;
        case "started": snapshot.started_issues++; break;
        case "unstarted": snapshot.unstarted_issues++; break;
        case "backlog": snapshot.backlog_issues++; break;
      }
    }

    // Save progress snapshot on source cycle
    await db.update(cycles).set({ progressSnapshot: snapshot }).where(eq(cycles.id, cycleId));

    // Transfer incomplete issues (backlog, unstarted, started) to destination
    const incompleteIssues = sourceIssueRows.filter(
      (r) => r.stateGroup === "backlog" || r.stateGroup === "unstarted" || r.stateGroup === "started"
    );

    if (incompleteIssues.length > 0) {
      const incompleteIssueIds = incompleteIssues.map((r) => r.issueId);
      const incompleteCycleIssueIds = incompleteIssues.map((r) => r.cycleIssueId);

      // Remove from source cycle
      await db.delete(cycleIssues).where(inArray(cycleIssues.id, incompleteCycleIssueIds));

      // Check which issues are already in destination cycle
      const existingInDest = await db
        .select({ issueId: cycleIssues.issueId })
        .from(cycleIssues)
        .where(
          and(
            eq(cycleIssues.cycleId, body.new_cycle_id),
            inArray(cycleIssues.issueId, incompleteIssueIds)
          )
        );
      const existingSet = new Set(existingInDest.map((r) => r.issueId));

      // Insert only new ones
      const toInsert = incompleteIssueIds
        .filter((id) => !existingSet.has(id))
        .map((issueId) => ({ cycleId: body.new_cycle_id, issueId }));

      if (toInsert.length > 0) {
        await db.insert(cycleIssues).values(toInsert);
      }
    }

    return c.json({ message: "Success" });
  }
);

// =====================================================
// 4.7.5 Cycle User Properties
// =====================================================

const updateCycleUserPropertiesSchema = z.object({
  filters: z.record(z.string(), z.any()).optional(),
  display_filters: z.record(z.string(), z.any()).optional(),
  display_properties: z.record(z.string(), z.any()).optional(),
  rich_filters: z.record(z.string(), z.any()).optional(),
});

function formatCycleUserProperties(p: typeof cycleUserProperties.$inferSelect) {
  return {
    id: p.id,
    cycle: p.cycleId,
    project: p.projectId,
    workspace: p.workspaceId,
    user: p.userId,
    filters: p.filters ?? {},
    display_filters: p.displayFilters ?? {},
    display_properties: p.displayProperties ?? {},
    rich_filters: p.richFilters ?? {},
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
  };
}

// GET /:projectId/cycles/:cycleId/user-properties/
projectRoutes.get("/:projectId/cycles/:cycleId/user-properties/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const cycleId = c.req.param("cycleId");

  // Verify cycle exists in this project
  const cycle = await db.query.cycles.findFirst({
    where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)),
  });
  if (!cycle) return c.json({ detail: "Cycle not found." }, 404);

  // Find or create
  let props = await db.query.cycleUserProperties.findFirst({
    where: and(
      eq(cycleUserProperties.cycleId, cycleId),
      eq(cycleUserProperties.userId, user.id)
    ),
  });

  if (!props) {
    const [created] = await db.insert(cycleUserProperties).values({
      cycleId,
      projectId: project.id,
      workspaceId: workspace.id,
      userId: user.id,
    }).returning();
    props = created;
  }

  return c.json(formatCycleUserProperties(props!));
});

// PATCH /:projectId/cycles/:cycleId/user-properties/
projectRoutes.patch(
  "/:projectId/cycles/:cycleId/user-properties/",
  zValidator("json", updateCycleUserPropertiesSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const cycleId = c.req.param("cycleId");

    const cycle = await db.query.cycles.findFirst({
      where: and(eq(cycles.id, cycleId), eq(cycles.projectId, project.id)),
    });
    if (!cycle) return c.json({ detail: "Cycle not found." }, 404);

    // Find or create
    let props = await db.query.cycleUserProperties.findFirst({
      where: and(
        eq(cycleUserProperties.cycleId, cycleId),
        eq(cycleUserProperties.userId, user.id)
      ),
    });

    if (!props) {
      const [created] = await db.insert(cycleUserProperties).values({
        cycleId,
        projectId: project.id,
        workspaceId: workspace.id,
        userId: user.id,
      }).returning();
      props = created;
    }

    const body = c.req.valid("json");
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (body.filters !== undefined) updateData.filters = body.filters;
    if (body.display_filters !== undefined) updateData.displayFilters = body.display_filters;
    if (body.display_properties !== undefined) updateData.displayProperties = body.display_properties;
    if (body.rich_filters !== undefined) updateData.richFilters = body.rich_filters;

    await db.update(cycleUserProperties)
      .set(updateData)
      .where(eq(cycleUserProperties.id, props!.id));

    const updated = await db.query.cycleUserProperties.findFirst({
      where: eq(cycleUserProperties.id, props!.id),
    });

    return c.json(formatCycleUserProperties(updated!));
  }
);

// =====================================================
// 4.8 Project Modules
// =====================================================

// GET /:projectId/modules/ - List non-archived modules for project
projectRoutes.get("/:projectId/modules/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  // Fetch all non-archived modules for this project
  const allModules = await db
    .select()
    .from(modules)
    .where(and(eq(modules.projectId, project.id), isNull(modules.archivedAt)))
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

  // Compute issue statistics per module by joining module_issues -> issues -> states
  const issueStats = await db
    .select({
      moduleId: moduleIssues.moduleId,
      stateGroup: states.group,
      issueCount: countFn(),
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
    };
  });

  // Sort: favorites first, then by created_at descending (already ordered by created_at from query)
  result.sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    return 0; // preserve created_at desc from query
  });

  return c.json(result);
});

// POST /:projectId/modules/ - Create module
const createModuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  description_text: z.string().nullable().optional(),
  description_html: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
  status: z.enum(["backlog", "planned", "in-progress", "paused", "completed", "cancelled"]).optional(),
  lead_id: z.string().nullable().optional(),
  member_ids: z.array(z.string()).optional(),
  sort_order: z.number().optional(),
});

projectRoutes.post(
  "/:projectId/modules/",
  zValidator("json", createModuleSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");

    let startDate: Date | null = null;
    let targetDate: Date | null = null;
    if (body.start_date) startDate = new Date(body.start_date);
    if (body.target_date) targetDate = new Date(body.target_date);

    // Auto sort_order
    let sortOrder = body.sort_order;
    if (sortOrder === undefined) {
      const maxResult = await db.select({ largest: max(modules.sortOrder) }).from(modules).where(eq(modules.projectId, project.id));
      sortOrder = maxResult[0]?.largest != null ? maxResult[0].largest + 10000 : 65535;
    }

    const [created] = await db
      .insert(modules)
      .values({
        projectId: project.id,
        workspaceId: workspace.id,
        name: body.name,
        description: body.description ?? null,
        descriptionText: body.description_text ?? null,
        descriptionHtml: body.description_html ?? null,
        startDate,
        targetDate,
        status: body.status ?? "backlog",
        leadId: body.lead_id ?? null,
        sortOrder,
        createdById: user.id,
      })
      .returning();

    // Add members if provided
    const memberIds = body.member_ids ?? [];
    if (memberIds.length > 0) {
      await db.insert(moduleMembers).values(
        memberIds.map((memberId) => ({ moduleId: created.id, memberId }))
      );
    }

    return c.json({
      id: created.id,
      workspace_id: created.workspaceId,
      project_id: created.projectId,
      name: created.name,
      description: created.description ?? "",
      description_text: created.descriptionText ?? null,
      description_html: created.descriptionHtml ?? null,
      start_date: created.startDate?.toISOString().split("T")[0] ?? null,
      target_date: created.targetDate?.toISOString().split("T")[0] ?? null,
      status: created.status ?? "backlog",
      lead_id: created.leadId ?? null,
      member_ids: memberIds,
      view_props: created.viewProps ?? {},
      sort_order: created.sortOrder ?? 65535,
      is_favorite: false,
      total_issues: 0,
      completed_issues: 0,
      cancelled_issues: 0,
      started_issues: 0,
      unstarted_issues: 0,
      backlog_issues: 0,
      created_at: created.createdAt?.toISOString() ?? null,
      updated_at: created.updatedAt?.toISOString() ?? null,
      archived_at: null,
    }, 201);
  }
);

// GET /:projectId/modules/:moduleId/ - Retrieve single module
projectRoutes.get("/:projectId/modules/:moduleId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id), isNull(modules.archivedAt)),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  // Members
  const members = await db
    .select({ memberId: moduleMembers.memberId })
    .from(moduleMembers)
    .where(eq(moduleMembers.moduleId, moduleId));

  // Favorite
  const fav = await db.query.moduleFavorites.findFirst({
    where: and(eq(moduleFavorites.moduleId, moduleId), eq(moduleFavorites.userId, user.id)),
  });

  // Issue stats
  const issueStatRows = await db
    .select({ stateGroup: states.group, issueCount: countFn() })
    .from(moduleIssues)
    .innerJoin(issues, eq(moduleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(and(eq(moduleIssues.moduleId, moduleId), isNull(issues.archivedAt), isNull(issues.deletedAt)))
    .groupBy(states.group);

  const stats = { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
  for (const row of issueStatRows) {
    const cnt = Number(row.issueCount);
    stats.total += cnt;
    switch (row.stateGroup) {
      case "completed": stats.completed += cnt; break;
      case "cancelled": stats.cancelled += cnt; break;
      case "started": stats.started += cnt; break;
      case "unstarted": stats.unstarted += cnt; break;
      case "backlog": stats.backlog += cnt; break;
    }
  }

  // Sub-issues count
  const subIssuesResult = await db
    .select({ count: countFn() })
    .from(moduleIssues)
    .innerJoin(issues, eq(moduleIssues.issueId, issues.id))
    .where(
      and(
        eq(moduleIssues.moduleId, moduleId),
        isNotNull(issues.parentId),
        isNull(issues.archivedAt),
        isNull(issues.deletedAt)
      )
    );
  const subIssues = Number(subIssuesResult[0]?.count ?? 0);

  // Links
  const links = await db.select().from(moduleLinks).where(eq(moduleLinks.moduleId, moduleId));

  return c.json({
    id: mod.id,
    workspace_id: mod.workspaceId,
    project_id: mod.projectId,
    name: mod.name,
    description: mod.description ?? "",
    description_text: mod.descriptionText ?? null,
    description_html: mod.descriptionHtml ?? null,
    start_date: mod.startDate?.toISOString().split("T")[0] ?? null,
    target_date: mod.targetDate?.toISOString().split("T")[0] ?? null,
    status: mod.status ?? "backlog",
    lead_id: mod.leadId ?? null,
    member_ids: members.map((m) => m.memberId),
    view_props: mod.viewProps ?? {},
    sort_order: mod.sortOrder ?? 65535,
    is_favorite: !!fav,
    total_issues: stats.total,
    completed_issues: stats.completed,
    cancelled_issues: stats.cancelled,
    started_issues: stats.started,
    unstarted_issues: stats.unstarted,
    backlog_issues: stats.backlog,
    sub_issues: subIssues,
    link_module: links.map((l) => ({
      id: l.id,
      module: l.moduleId,
      title: l.title ?? "",
      url: l.url,
      metadata: l.metadata ?? {},
      created_by: l.createdById ?? null,
      created_at: l.createdAt?.toISOString() ?? null,
    })),
    created_at: mod.createdAt?.toISOString() ?? null,
    updated_at: mod.updatedAt?.toISOString() ?? null,
    archived_at: mod.archivedAt?.toISOString() ?? null,
  });
});

// PATCH /:projectId/modules/:moduleId/ - Update module
const updateModuleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  description_text: z.string().nullable().optional(),
  description_html: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
  status: z.enum(["backlog", "planned", "in-progress", "paused", "completed", "cancelled"]).optional(),
  lead_id: z.string().nullable().optional(),
  member_ids: z.array(z.string()).optional(),
  sort_order: z.number().optional(),
});

projectRoutes.patch(
  "/:projectId/modules/:moduleId/",
  zValidator("json", updateModuleSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const moduleId = c.req.param("moduleId");

    const mod = await db.query.modules.findFirst({
      where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id)),
    });
    if (!mod) return c.json({ error: "Module not found" }, 404);

    if (mod.archivedAt) {
      return c.json({ error: "Archived module cannot be updated" }, 400);
    }

    const body = c.req.valid("json");
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.description_text !== undefined) updateData.descriptionText = body.description_text;
    if (body.description_html !== undefined) updateData.descriptionHtml = body.description_html;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.lead_id !== undefined) updateData.leadId = body.lead_id;
    if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

    if (body.start_date !== undefined) {
      updateData.startDate = body.start_date ? new Date(body.start_date) : null;
    }
    if (body.target_date !== undefined) {
      updateData.targetDate = body.target_date ? new Date(body.target_date) : null;
    }

    await db.update(modules).set(updateData).where(eq(modules.id, moduleId));

    // Handle member updates
    if (body.member_ids !== undefined) {
      await db.delete(moduleMembers).where(eq(moduleMembers.moduleId, moduleId));
      if (body.member_ids.length > 0) {
        await db.insert(moduleMembers).values(
          body.member_ids.map((memberId) => ({ moduleId, memberId }))
        );
      }
    }

    // Re-fetch and return
    const updated = await db.query.modules.findFirst({ where: eq(modules.id, moduleId) });
    const members = await db
      .select({ memberId: moduleMembers.memberId })
      .from(moduleMembers)
      .where(eq(moduleMembers.moduleId, moduleId));

    return c.json({
      id: updated!.id,
      workspace_id: updated!.workspaceId,
      project_id: updated!.projectId,
      name: updated!.name,
      description: updated!.description ?? "",
      description_text: updated!.descriptionText ?? null,
      description_html: updated!.descriptionHtml ?? null,
      start_date: updated!.startDate?.toISOString().split("T")[0] ?? null,
      target_date: updated!.targetDate?.toISOString().split("T")[0] ?? null,
      status: updated!.status ?? "backlog",
      lead_id: updated!.leadId ?? null,
      member_ids: members.map((m) => m.memberId),
      view_props: updated!.viewProps ?? {},
      sort_order: updated!.sortOrder ?? 65535,
      created_at: updated!.createdAt?.toISOString() ?? null,
      updated_at: updated!.updatedAt?.toISOString() ?? null,
      archived_at: updated!.archivedAt?.toISOString() ?? null,
    });
  }
);

// DELETE /:projectId/modules/:moduleId/ - Delete module
projectRoutes.delete("/:projectId/modules/:moduleId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id)),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  await db.delete(modules).where(eq(modules.id, moduleId));

  // Clean up favorites
  await db.delete(moduleFavorites).where(eq(moduleFavorites.moduleId, moduleId));

  // Clean up recent visits
  await db.delete(recentVisits).where(
    and(eq(recentVisits.entityType, "module"), eq(recentVisits.entityId, moduleId))
  );

  return c.body(null, 204);
});

// =====================================================
// 4.8.1 Module Links
// =====================================================

// POST /:projectId/modules/:moduleId/module-links/ - Create link
projectRoutes.post(
  "/:projectId/modules/:moduleId/module-links/",
  zValidator("json", z.object({
    title: z.string().optional(),
    url: z.string().url(),
    metadata: z.record(z.string(), z.any()).optional(),
  })),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const moduleId = c.req.param("moduleId");

    const mod = await db.query.modules.findFirst({
      where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id)),
    });
    if (!mod) return c.json({ error: "Module not found" }, 404);

    const body = c.req.valid("json");

    const [link] = await db.insert(moduleLinks).values({
      moduleId,
      title: body.title ?? null,
      url: body.url,
      metadata: body.metadata ?? null,
      createdById: user.id,
    }).returning();

    return c.json({
      id: link.id,
      module: link.moduleId,
      title: link.title ?? "",
      url: link.url,
      metadata: link.metadata ?? {},
      created_by: link.createdById ?? null,
      created_at: link.createdAt?.toISOString() ?? null,
    }, 201);
  }
);

// PATCH /:projectId/modules/:moduleId/module-links/:linkId/ - Update link
projectRoutes.patch(
  "/:projectId/modules/:moduleId/module-links/:linkId/",
  zValidator("json", z.object({
    title: z.string().optional(),
    url: z.string().url().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const moduleId = c.req.param("moduleId");
    const linkId = c.req.param("linkId");

    const link = await db.query.moduleLinks.findFirst({
      where: and(eq(moduleLinks.id, linkId), eq(moduleLinks.moduleId, moduleId)),
    });
    if (!link) return c.json({ error: "Link not found" }, 404);

    const body = c.req.valid("json");
    const updateData: Record<string, any> = {};

    if (body.title !== undefined) updateData.title = body.title;
    if (body.url !== undefined) updateData.url = body.url;
    if (body.metadata !== undefined) updateData.metadata = body.metadata;

    await db.update(moduleLinks).set(updateData).where(eq(moduleLinks.id, linkId));

    const updated = await db.query.moduleLinks.findFirst({ where: eq(moduleLinks.id, linkId) });

    return c.json({
      id: updated!.id,
      module: updated!.moduleId,
      title: updated!.title ?? "",
      url: updated!.url,
      metadata: updated!.metadata ?? {},
      created_by: updated!.createdById ?? null,
      created_at: updated!.createdAt?.toISOString() ?? null,
    });
  }
);

// DELETE /:projectId/modules/:moduleId/module-links/:linkId/ - Delete link
projectRoutes.delete("/:projectId/modules/:moduleId/module-links/:linkId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const moduleId = c.req.param("moduleId");
  const linkId = c.req.param("linkId");

  const link = await db.query.moduleLinks.findFirst({
    where: and(eq(moduleLinks.id, linkId), eq(moduleLinks.moduleId, moduleId)),
  });
  if (!link) return c.json({ error: "Link not found" }, 404);

  await db.delete(moduleLinks).where(eq(moduleLinks.id, linkId));

  return c.body(null, 204);
});

// =====================================================
// 4.8.2 Module Favorites
// =====================================================

// POST /:projectId/user-favorite-modules/ - Add module to favorites
projectRoutes.post(
  "/:projectId/user-favorite-modules/",
  zValidator("json", z.object({ module: z.string() })),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");

    await db.insert(moduleFavorites).values({
      moduleId: body.module,
      userId: user.id,
    });

    return c.body(null, 204);
  }
);

// DELETE /:projectId/user-favorite-modules/:moduleId/ - Remove from favorites
projectRoutes.delete("/:projectId/user-favorite-modules/:moduleId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const moduleId = c.req.param("moduleId");

  await db.delete(moduleFavorites).where(
    and(eq(moduleFavorites.moduleId, moduleId), eq(moduleFavorites.userId, user.id))
  );

  return c.body(null, 204);
});

// =====================================================
// 4.8.3 Module Archive / Unarchive
// =====================================================

// GET /:projectId/archived-modules/ - List archived modules
projectRoutes.get("/:projectId/archived-modules/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const allModules = await db
    .select()
    .from(modules)
    .where(and(eq(modules.projectId, project.id), isNotNull(modules.archivedAt)))
    .orderBy(desc(modules.createdAt));

  if (allModules.length === 0) return c.json([]);

  const moduleIds = allModules.map((m) => m.id);

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

  const userFavorites = await db
    .select({ moduleId: moduleFavorites.moduleId })
    .from(moduleFavorites)
    .where(and(inArray(moduleFavorites.moduleId, moduleIds), eq(moduleFavorites.userId, user.id)));

  const favModuleIds = new Set(userFavorites.map((f) => f.moduleId));

  const issueStats = await db
    .select({ moduleId: moduleIssues.moduleId, stateGroup: states.group, issueCount: countFn() })
    .from(moduleIssues)
    .innerJoin(issues, eq(moduleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(and(inArray(moduleIssues.moduleId, moduleIds), isNull(issues.archivedAt), isNull(issues.deletedAt)))
    .groupBy(moduleIssues.moduleId, states.group);

  const statsMap = new Map<string, { total: number; completed: number; cancelled: number; started: number; unstarted: number; backlog: number }>();
  for (const row of issueStats) {
    const existing = statsMap.get(row.moduleId) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
    const cnt = Number(row.issueCount);
    existing.total += cnt;
    switch (row.stateGroup) {
      case "completed": existing.completed += cnt; break;
      case "cancelled": existing.cancelled += cnt; break;
      case "started": existing.started += cnt; break;
      case "unstarted": existing.unstarted += cnt; break;
      case "backlog": existing.backlog += cnt; break;
    }
    statsMap.set(row.moduleId, existing);
  }

  const result = allModules.map((m) => {
    const stats = statsMap.get(m.id) || { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
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
    };
  });

  return c.json(result);
});

// GET /:projectId/archived-modules/:moduleId/ - Archived module detail
projectRoutes.get("/:projectId/archived-modules/:moduleId/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id), isNotNull(modules.archivedAt)),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  const members = await db
    .select({ memberId: moduleMembers.memberId })
    .from(moduleMembers)
    .where(eq(moduleMembers.moduleId, moduleId));

  const fav = await db.query.moduleFavorites.findFirst({
    where: and(eq(moduleFavorites.moduleId, moduleId), eq(moduleFavorites.userId, user.id)),
  });

  const issueStatRows = await db
    .select({ stateGroup: states.group, issueCount: countFn() })
    .from(moduleIssues)
    .innerJoin(issues, eq(moduleIssues.issueId, issues.id))
    .innerJoin(states, eq(issues.stateId, states.id))
    .where(and(eq(moduleIssues.moduleId, moduleId), isNull(issues.archivedAt), isNull(issues.deletedAt)))
    .groupBy(states.group);

  const stats = { total: 0, completed: 0, cancelled: 0, started: 0, unstarted: 0, backlog: 0 };
  for (const row of issueStatRows) {
    const cnt = Number(row.issueCount);
    stats.total += cnt;
    switch (row.stateGroup) {
      case "completed": stats.completed += cnt; break;
      case "cancelled": stats.cancelled += cnt; break;
      case "started": stats.started += cnt; break;
      case "unstarted": stats.unstarted += cnt; break;
      case "backlog": stats.backlog += cnt; break;
    }
  }

  const subIssuesResult = await db
    .select({ count: countFn() })
    .from(moduleIssues)
    .innerJoin(issues, eq(moduleIssues.issueId, issues.id))
    .where(and(eq(moduleIssues.moduleId, moduleId), isNotNull(issues.parentId), isNull(issues.archivedAt), isNull(issues.deletedAt)));
  const subIssues = Number(subIssuesResult[0]?.count ?? 0);

  const links = await db.select().from(moduleLinks).where(eq(moduleLinks.moduleId, moduleId));

  return c.json({
    id: mod.id,
    workspace_id: mod.workspaceId,
    project_id: mod.projectId,
    name: mod.name,
    description: mod.description ?? "",
    description_text: mod.descriptionText ?? null,
    description_html: mod.descriptionHtml ?? null,
    start_date: mod.startDate?.toISOString().split("T")[0] ?? null,
    target_date: mod.targetDate?.toISOString().split("T")[0] ?? null,
    status: mod.status ?? "backlog",
    lead_id: mod.leadId ?? null,
    member_ids: members.map((m) => m.memberId),
    view_props: mod.viewProps ?? {},
    sort_order: mod.sortOrder ?? 65535,
    is_favorite: !!fav,
    total_issues: stats.total,
    completed_issues: stats.completed,
    cancelled_issues: stats.cancelled,
    started_issues: stats.started,
    unstarted_issues: stats.unstarted,
    backlog_issues: stats.backlog,
    sub_issues: subIssues,
    link_module: links.map((l) => ({
      id: l.id,
      module: l.moduleId,
      title: l.title ?? "",
      url: l.url,
      metadata: l.metadata ?? {},
      created_by: l.createdById ?? null,
      created_at: l.createdAt?.toISOString() ?? null,
    })),
    created_at: mod.createdAt?.toISOString() ?? null,
    updated_at: mod.updatedAt?.toISOString() ?? null,
    archived_at: mod.archivedAt?.toISOString() ?? null,
  });
});

// POST /:projectId/modules/:moduleId/archive/ - Archive module (only completed or cancelled)
projectRoutes.post("/:projectId/modules/:moduleId/archive/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id)),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  // Only completed or cancelled modules can be archived
  if (mod.status !== "completed" && mod.status !== "cancelled") {
    return c.json({ error: "Only completed or cancelled modules can be archived" }, 400);
  }

  const now = new Date();
  await db.update(modules).set({ archivedAt: now }).where(eq(modules.id, moduleId));

  // Remove favorites for this module
  await db.delete(moduleFavorites).where(eq(moduleFavorites.moduleId, moduleId));

  return c.json({ archived_at: now.toISOString() });
});

// DELETE /:projectId/modules/:moduleId/archive/ - Unarchive module
projectRoutes.delete("/:projectId/modules/:moduleId/archive/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id)),
  });
  if (!mod) return c.json({ error: "Module not found" }, 404);

  await db.update(modules).set({ archivedAt: null }).where(eq(modules.id, moduleId));

  return c.body(null, 204);
});

// =====================================================
// 4.9 Module User Properties
// =====================================================

const updateModuleUserPropertiesSchema = z.object({
  filters: z.record(z.string(), z.any()).optional(),
  display_filters: z.record(z.string(), z.any()).optional(),
  display_properties: z.record(z.string(), z.any()).optional(),
  rich_filters: z.record(z.string(), z.any()).optional(),
});

function formatModuleUserProperties(p: typeof moduleUserProperties.$inferSelect) {
  return {
    id: p.id,
    module: p.moduleId,
    project: p.projectId,
    workspace: p.workspaceId,
    user: p.userId,
    filters: p.filters ?? {},
    display_filters: p.displayFilters ?? {},
    display_properties: p.displayProperties ?? {},
    rich_filters: p.richFilters ?? {},
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
  };
}

// GET /:projectId/modules/:moduleId/user-properties/
projectRoutes.get("/:projectId/modules/:moduleId/user-properties/", async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");
  if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

  const moduleId = c.req.param("moduleId");

  const mod = await db.query.modules.findFirst({
    where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id)),
  });
  if (!mod) return c.json({ detail: "Module not found." }, 404);

  let props = await db.query.moduleUserProperties.findFirst({
    where: and(
      eq(moduleUserProperties.moduleId, moduleId),
      eq(moduleUserProperties.userId, user.id)
    ),
  });

  if (!props) {
    const [created] = await db.insert(moduleUserProperties).values({
      moduleId,
      projectId: project.id,
      workspaceId: workspace.id,
      userId: user.id,
    }).returning();
    props = created;
  }

  return c.json(formatModuleUserProperties(props!));
});

// PATCH /:projectId/modules/:moduleId/user-properties/
projectRoutes.patch(
  "/:projectId/modules/:moduleId/user-properties/",
  zValidator("json", updateModuleUserPropertiesSchema),
  async (c) => {
    const project = c.get("project");
    const workspace = c.get("workspace");
    const user = c.get("user");
    if (!project || !workspace || !user) return c.json({ detail: "Not found." }, 404);

    const moduleId = c.req.param("moduleId");

    const mod = await db.query.modules.findFirst({
      where: and(eq(modules.id, moduleId), eq(modules.projectId, project.id)),
    });
    if (!mod) return c.json({ detail: "Module not found." }, 404);

    let props = await db.query.moduleUserProperties.findFirst({
      where: and(
        eq(moduleUserProperties.moduleId, moduleId),
        eq(moduleUserProperties.userId, user.id)
      ),
    });

    if (!props) {
      const [created] = await db.insert(moduleUserProperties).values({
        moduleId,
        projectId: project.id,
        workspaceId: workspace.id,
        userId: user.id,
      }).returning();
      props = created;
    }

    const body = c.req.valid("json");
    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (body.filters !== undefined) updateData.filters = body.filters;
    if (body.display_filters !== undefined) updateData.displayFilters = body.display_filters;
    if (body.display_properties !== undefined) updateData.displayProperties = body.display_properties;
    if (body.rich_filters !== undefined) updateData.richFilters = body.rich_filters;

    await db.update(moduleUserProperties)
      .set(updateData)
      .where(eq(moduleUserProperties.id, props!.id));

    const updated = await db.query.moduleUserProperties.findFirst({
      where: eq(moduleUserProperties.id, props!.id),
    });

    return c.json(formatModuleUserProperties(updated!));
  }
);

// ===========================
// Section: Project Views
// ===========================

// Helper to format view response
function formatView(v: any, workspaceId: string, isFavorite: boolean) {
  return {
    id: v.id,
    workspace: workspaceId,
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
    is_favorite: isFavorite,
    owned_by: v.ownedById,
    created_at: v.createdAt?.toISOString() ?? null,
    updated_at: v.updatedAt?.toISOString() ?? null,
  };
}

// GET /:projectId/views/ - List project views
projectRoutes.get("/:projectId/views/", async (c) => {
  const workspace = c.get("workspace");
  const project = c.get("project");
  const user = c.get("user");
  const membership = c.get("projectMembership");
  if (!workspace || !project || !user || !membership)
    return c.json({ detail: "Not found." }, 404);

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
      eq(views.projectId, project.id)
    ),
    orderBy: [orderDir],
  });

  // Guests only see their own views; others see own + public (accessLevel >= 1)
  const filtered = isGuest
    ? allViews.filter((v) => v.ownedById === user.id)
    : allViews.filter((v) => v.ownedById === user.id || (v.accessLevel ?? 0) >= 1);

  // Get favorites for current user
  const userFavorites = await db
    .select({ viewId: viewFavorites.viewId })
    .from(viewFavorites)
    .where(eq(viewFavorites.userId, user.id));
  const favSet = new Set(userFavorites.map((f) => f.viewId));

  // Sort: favorites first, then by the selected order
  const result = filtered
    .sort((a, b) => {
      const aFav = favSet.has(a.id) ? 1 : 0;
      const bFav = favSet.has(b.id) ? 1 : 0;
      return bFav - aFav;
    })
    .map((v) => formatView(v, workspace.id, favSet.has(v.id)));

  return c.json(result);
});

// POST /:projectId/views/ - Create project view
projectRoutes.post(
  "/:projectId/views/",
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
      logo_props: z.any().optional(),
    })
  ),
  async (c) => {
    const workspace = c.get("workspace");
    const project = c.get("project");
    const user = c.get("user");
    if (!workspace || !project || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");

    // Auto-calculate sort_order if not provided
    let sortOrder = body.sort_order;
    if (sortOrder === undefined) {
      const maxResult = await db
        .select({ largest: max(views.sortOrder) })
        .from(views)
        .where(
          and(
            eq(views.workspaceId, workspace.id),
            eq(views.projectId, project.id)
          )
        );
      const largest = maxResult[0]?.largest;
      sortOrder = largest != null ? largest + 10000 : 65535;
    }

    const [created] = await db
      .insert(views)
      .values({
        workspaceId: workspace.id,
        projectId: project.id,
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

    return c.json(formatView(created, workspace.id, false), 201);
  }
);

// GET /:projectId/views/:viewId/ - Retrieve project view
projectRoutes.get("/:projectId/views/:viewId/", async (c) => {
  const workspace = c.get("workspace");
  const project = c.get("project");
  const user = c.get("user");
  if (!workspace || !project || !user) return c.json({ detail: "Not found." }, 404);

  const viewId = c.req.param("viewId");

  const view = await db.query.views.findFirst({
    where: and(
      eq(views.id, viewId),
      eq(views.workspaceId, workspace.id),
      eq(views.projectId, project.id)
    ),
  });

  if (!view) return c.json({ detail: "Not found." }, 404);

  const fav = await db.query.viewFavorites.findFirst({
    where: and(
      eq(viewFavorites.viewId, view.id),
      eq(viewFavorites.userId, user.id)
    ),
  });

  return c.json(formatView(view, workspace.id, !!fav));
});

// PATCH /:projectId/views/:viewId/ - Update project view
projectRoutes.patch(
  "/:projectId/views/:viewId/",
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
      logo_props: z.any().optional(),
    })
  ),
  async (c) => {
    const workspace = c.get("workspace");
    const project = c.get("project");
    const user = c.get("user");
    if (!workspace || !project || !user) return c.json({ detail: "Not found." }, 404);

    const viewId = c.req.param("viewId");

    const view = await db.query.views.findFirst({
      where: and(
        eq(views.id, viewId),
        eq(views.workspaceId, workspace.id),
        eq(views.projectId, project.id)
      ),
    });

    if (!view) return c.json({ detail: "Not found." }, 404);

    // Only owner can update
    if (view.ownedById !== user.id) {
      return c.json({ detail: "Only the owner can update this view." }, 403);
    }

    const body = c.req.valid("json");

    // Locked views cannot be updated (except to unlock)
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

    return c.json(formatView(updated, workspace.id, !!fav));
  }
);

// DELETE /:projectId/views/:viewId/ - Delete project view
projectRoutes.delete("/:projectId/views/:viewId/", async (c) => {
  const workspace = c.get("workspace");
  const project = c.get("project");
  const user = c.get("user");
  const membership = c.get("projectMembership");
  if (!workspace || !project || !user || !membership)
    return c.json({ detail: "Not found." }, 404);

  const viewId = c.req.param("viewId");

  const view = await db.query.views.findFirst({
    where: and(
      eq(views.id, viewId),
      eq(views.workspaceId, workspace.id),
      eq(views.projectId, project.id)
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

// POST /:projectId/user-favorite-views/ - Add view to favorites
projectRoutes.post(
  "/:projectId/user-favorite-views/",
  zValidator(
    "json",
    z.object({
      view: z.string().min(1),
    })
  ),
  async (c) => {
    const workspace = c.get("workspace");
    const project = c.get("project");
    const user = c.get("user");
    if (!workspace || !project || !user) return c.json({ detail: "Not found." }, 404);

    const body = c.req.valid("json");

    // Verify the view exists and belongs to this project
    const view = await db.query.views.findFirst({
      where: and(
        eq(views.id, body.view),
        eq(views.workspaceId, workspace.id),
        eq(views.projectId, project.id)
      ),
    });

    if (!view) return c.json({ detail: "View not found." }, 404);

    // Check if already favorited
    const existing = await db.query.viewFavorites.findFirst({
      where: and(
        eq(viewFavorites.viewId, view.id),
        eq(viewFavorites.userId, user.id)
      ),
    });

    if (existing) return c.json({ detail: "View already favorited." }, 400);

    const [fav] = await db
      .insert(viewFavorites)
      .values({
        viewId: view.id,
        userId: user.id,
      })
      .returning();

    return c.json(
      {
        id: fav.id,
        view: fav.viewId,
        user: fav.userId,
        created_at: fav.createdAt?.toISOString() ?? null,
      },
      201
    );
  }
);

// DELETE /:projectId/user-favorite-views/:viewId/ - Remove view from favorites
projectRoutes.delete("/:projectId/user-favorite-views/:viewId/", async (c) => {
  const workspace = c.get("workspace");
  const project = c.get("project");
  const user = c.get("user");
  if (!workspace || !project || !user) return c.json({ detail: "Not found." }, 404);

  const viewId = c.req.param("viewId");

  const fav = await db.query.viewFavorites.findFirst({
    where: and(
      eq(viewFavorites.viewId, viewId),
      eq(viewFavorites.userId, user.id)
    ),
  });

  if (!fav) return c.json({ detail: "Favorite not found." }, 404);

  await db.delete(viewFavorites).where(eq(viewFavorites.id, fav.id));

  return c.body(null, 204);
});

// ===========================
// Section: Work Item Description Versions
// ===========================

// GET /:projectId/work-items/:issueId/description-versions/ - List description versions
projectRoutes.get("/:projectId/work-items/:issueId/description-versions/", async (c) => {
  const project = c.get("project");
  const user = c.get("user");
  if (!project || !user) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");

  // Verify issue exists in this project
  const issue = await db.query.issues.findFirst({
    where: and(
      eq(issues.id, issueId),
      eq(issues.projectId, project.id),
      isNull(issues.deletedAt)
    ),
  });
  if (!issue) return c.json({ detail: "Issue not found." }, 404);

  // Guest permission check
  const membership = c.get("projectMembership");
  if (
    membership &&
    membership.role === 5 &&
    !project.guestViewAllFeatures &&
    issue.createdById !== user.id
  ) {
    return c.json({ error: "You are not allowed to view this issue" }, 403);
  }

  // Cursor-based pagination
  const cursor = c.req.query("cursor") || null;
  const perPage = Math.min(parseInt(c.req.query("per_page") || "10") || 10, 100);

  let offset = 0;
  if (cursor) {
    const parts = cursor.split(":");
    const pageNumber = parseInt(parts[1] || "0") || 0;
    offset = pageNumber * perPage;
  }

  // Fetch versions ordered by created_at desc
  const allVersions = await db
    .select()
    .from(issueDescriptionVersions)
    .where(
      and(
        eq(issueDescriptionVersions.issueId, issueId),
        eq(issueDescriptionVersions.projectId, project.id)
      )
    )
    .orderBy(desc(issueDescriptionVersions.createdAt));

  const totalCount = allVersions.length;
  const totalPages = Math.ceil(totalCount / perPage);
  const currentPage = Math.floor(offset / perPage);
  const paginatedVersions = allVersions.slice(offset, offset + perPage);

  const nextPageExists = currentPage + 1 < totalPages;
  const prevPageExists = currentPage > 0;

  const results = paginatedVersions.map((v) => ({
    id: v.id,
    workspace: v.workspaceId,
    project: v.projectId,
    issue: v.issueId,
    last_saved_at: v.lastSavedAt?.toISOString() ?? null,
    owned_by: v.ownedById,
    created_at: v.createdAt?.toISOString() ?? null,
    updated_at: v.updatedAt?.toISOString() ?? null,
    created_by: v.createdById ?? null,
    updated_by: v.updatedById ?? null,
  }));

  return c.json({
    grouped_by: null,
    sub_grouped_by: null,
    total_count: totalCount,
    next_cursor: `${perPage}:${currentPage + 1}:0`,
    prev_cursor: `${perPage}:${currentPage > 0 ? currentPage - 1 : 0}:0`,
    next_page_results: nextPageExists,
    prev_page_results: prevPageExists,
    count: results.length,
    total_pages: totalPages,
    extra_stats: null,
    results,
  });
});

// GET /:projectId/work-items/:issueId/description-versions/:versionId/ - Get specific version
projectRoutes.get("/:projectId/work-items/:issueId/description-versions/:versionId/", async (c) => {
  const project = c.get("project");
  const user = c.get("user");
  if (!project || !user) return c.json({ detail: "Not found." }, 404);

  const issueId = c.req.param("issueId");
  const versionId = c.req.param("versionId");

  // Verify issue exists
  const issue = await db.query.issues.findFirst({
    where: and(
      eq(issues.id, issueId),
      eq(issues.projectId, project.id),
      isNull(issues.deletedAt)
    ),
  });
  if (!issue) return c.json({ detail: "Issue not found." }, 404);

  // Guest permission check
  const membership = c.get("projectMembership");
  if (
    membership &&
    membership.role === 5 &&
    !project.guestViewAllFeatures &&
    issue.createdById !== user.id
  ) {
    return c.json({ error: "You are not allowed to view this issue" }, 403);
  }

  const version = await db.query.issueDescriptionVersions.findFirst({
    where: and(
      eq(issueDescriptionVersions.id, versionId),
      eq(issueDescriptionVersions.issueId, issueId),
      eq(issueDescriptionVersions.projectId, project.id)
    ),
  });

  if (!version) return c.json({ detail: "Version not found." }, 404);

  return c.json({
    id: version.id,
    workspace: version.workspaceId,
    project: version.projectId,
    issue: version.issueId,
    description_html: version.descriptionHtml ?? "",
    description_stripped: version.descriptionStripped ?? "",
    description_json: version.descriptionJson ?? {},
    last_saved_at: version.lastSavedAt?.toISOString() ?? null,
    owned_by: version.ownedById,
    created_at: version.createdAt?.toISOString() ?? null,
    updated_at: version.updatedAt?.toISOString() ?? null,
    created_by: version.createdById ?? null,
    updated_by: version.updatedById ?? null,
  });
});

export { projectRoutes };

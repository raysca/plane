import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  eq,
  and,
  or,
  desc,
  isNull,
  sql,
} from "drizzle-orm";
import { db } from "../../db";
import { pages, pageVersions, pageFavorites, pageLabels } from "../../db/schema/page";
import { projects } from "../../db/schema/project";
import { favorites, recentVisits } from "../../db/schema/workspace";
import { authMiddleware, ROLES } from "../../middleware/auth";
import { workspaceMiddleware } from "../../middleware/workspace";
import { projectMiddleware } from "../../middleware/project";
import type { Variables } from "../../app";

const pageRoutes = new Hono<{ Variables: Variables }>();

// Apply auth + workspace + project middleware globally
pageRoutes.use("*", authMiddleware);
pageRoutes.use("*", workspaceMiddleware);
pageRoutes.use("*", projectMiddleware);

// --- Validation Schemas ---

const createPageSchema = z.object({
  name: z.string().min(1).max(255).default("Untitled"),
  description: z.record(z.string(), z.unknown()).optional(),
  description_html: z.string().optional().default("<p></p>"),
  description_binary: z.string().optional().nullable(),
  access: z.number().int().refine((v) => [0, 1].includes(v)).optional().default(0),
  color: z.string().optional().nullable(),
  logo_props: z.record(z.string(), z.unknown()).optional().nullable(),
  parent: z.string().optional().nullable(),
  labels: z.array(z.string()).optional(),
});

const updatePageSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description_html: z.string().optional(),
  access: z.number().int().refine((v) => [0, 1].includes(v)).optional(),
  color: z.string().optional().nullable(),
  logo_props: z.record(z.string(), z.unknown()).optional().nullable(),
  view_props: z.record(z.string(), z.unknown()).optional().nullable(),
  parent: z.string().optional().nullable(),
  labels: z.array(z.string()).optional(),
  is_locked: z.boolean().optional(),
});

const updateDescriptionSchema = z.object({
  description_binary: z.string().optional(),
  description_html: z.string().optional(),
  description: z.record(z.string(), z.unknown()).optional().nullable(),
});

const accessSchema = z.object({
  access: z.number().int().refine((v) => [0, 1].includes(v)),
});

// --- Helper formatters ---

function formatPage(
  p: typeof pages.$inferSelect,
  extra?: {
    isFavorite?: boolean;
    labelIds?: string[];
    projectIds?: string[];
  }
) {
  return {
    id: p.id,
    name: p.name,
    owned_by: p.ownedById,
    access: p.accessLevel ?? 0,
    color: p.colorProp ?? null,
    logo_props: p.iconProp ? JSON.parse(p.iconProp) : {},
    parent: p.parentId ?? null,
    is_favorite: extra?.isFavorite ?? false,
    is_locked: p.isLocked ?? false,
    archived_at: p.archivedAt?.toISOString() ?? null,
    workspace: p.workspaceId,
    created_at: p.createdAt?.toISOString() ?? null,
    updated_at: p.updatedAt?.toISOString() ?? null,
    created_by: p.ownedById ?? null,
    updated_by: p.ownedById ?? null,
    view_props: {},
    label_ids: extra?.labelIds ?? [],
    project_ids: extra?.projectIds ?? [],
  };
}

function formatPageDetail(
  p: typeof pages.$inferSelect,
  extra?: {
    isFavorite?: boolean;
    labelIds?: string[];
    projectIds?: string[];
  }
) {
  return {
    ...formatPage(p, extra),
    description_html: p.descriptionHtml ?? "<p></p>",
  };
}

function formatPageVersion(v: typeof pageVersions.$inferSelect) {
  return {
    id: v.id,
    page: v.pageId,
    last_saved_at: v.lastSavedAt?.toISOString() ?? null,
    owned_by: v.ownedById,
    created_at: v.createdAt?.toISOString() ?? null,
    updated_at: v.createdAt?.toISOString() ?? null,
  };
}

function formatPageVersionDetail(v: typeof pageVersions.$inferSelect) {
  return {
    ...formatPageVersion(v),
    description_html: v.descriptionHtml ?? null,
    description_stripped: v.descriptionStripped ?? null,
  };
}

// --- Helper: check if guest can view all features ---
async function getGuestViewAllFeatures(projectId: string): Promise<boolean> {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  return project?.guestViewAllFeatures ?? false;
}

// --- Helper: check page permission ---
function canModifyPage(role: number | null): boolean {
  return role !== null && role >= ROLES.MEMBER;
}

function canDeletePage(role: number | null): boolean {
  return role !== null && role >= ROLES.ADMIN;
}

// --- Helper: get page with favorites and labels ---
async function getPageWithExtras(pageId: string, userId: string, projectId: string) {
  const page = await db.query.pages.findFirst({
    where: eq(pages.id, pageId),
  });
  if (!page) return null;

  const favorite = await db.query.pageFavorites.findFirst({
    where: and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, userId)),
  });

  const labels = await db
    .select({ labelId: pageLabels.labelId })
    .from(pageLabels)
    .where(eq(pageLabels.pageId, pageId));

  return {
    page,
    isFavorite: !!favorite,
    labelIds: labels.map((l) => l.labelId),
    projectIds: [projectId],
  };
}

// =====================
// LIST PAGES
// =====================
pageRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const projectMembership = c.get("projectMembership");

  // Get all pages for this project that are root-level (no parent)
  // and accessible to the user (owned by user OR public)
  let allPages = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspace.id),
        eq(pages.projectId, project.id),
        isNull(pages.parentId),
        or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))
      )
    )
    .orderBy(desc(pages.createdAt));

  // If guest without guest_view_all_features, filter to owned pages
  if (projectMembership?.role === ROLES.GUEST) {
    const guestViewAll = await getGuestViewAllFeatures(project.id);
    if (!guestViewAll) {
      allPages = allPages.filter((p) => p.ownedById === user.id);
    }
  }

  // Get favorites for the user
  const userFavorites = await db
    .select({ pageId: pageFavorites.pageId })
    .from(pageFavorites)
    .where(eq(pageFavorites.userId, user.id));
  const favoriteSet = new Set(userFavorites.map((f) => f.pageId));

  // Get labels for all pages
  const pageIds = allPages.map((p) => p.id);
  let allLabels: { pageId: string; labelId: string }[] = [];
  if (pageIds.length > 0) {
    allLabels = await db
      .select({ pageId: pageLabels.pageId, labelId: pageLabels.labelId })
      .from(pageLabels)
      .where(
        sql`${pageLabels.pageId} IN (${sql.join(
          pageIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
  }

  const labelsByPage = new Map<string, string[]>();
  for (const l of allLabels) {
    if (!labelsByPage.has(l.pageId)) labelsByPage.set(l.pageId, []);
    labelsByPage.get(l.pageId)!.push(l.labelId);
  }

  // Sort: favorites first, then by created_at desc
  const sorted = allPages.sort((a, b) => {
    const aFav = favoriteSet.has(a.id) ? 1 : 0;
    const bFav = favoriteSet.has(b.id) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });

  const result = sorted.map((p) =>
    formatPage(p, {
      isFavorite: favoriteSet.has(p.id),
      labelIds: labelsByPage.get(p.id) ?? [],
      projectIds: [project.id],
    })
  );

  return c.json(result);
});

// =====================
// CREATE PAGE
// =====================
pageRoutes.post("/", zValidator("json", createPageSchema), async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const role = c.get("projectMembership")?.role ?? null;

  if (!canModifyPage(role)) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  const body = c.req.valid("json");

  // Validate parent exists if provided
  if (body.parent) {
    const parentPage = await db.query.pages.findFirst({
      where: and(
        eq(pages.id, body.parent),
        eq(pages.workspaceId, workspace.id),
        eq(pages.projectId, project.id)
      ),
    });
    if (!parentPage) {
      return c.json({ error: "Parent page not found" }, 400);
    }
  }

  // Decode binary if provided
  let binaryData: Buffer | null = null;
  if (body.description_binary) {
    try {
      binaryData = Buffer.from(body.description_binary, "base64");
    } catch {
      return c.json({ error: "Invalid base64 binary data" }, 400);
    }
  }

  const [newPage] = await db
    .insert(pages)
    .values({
      name: body.name,
      workspaceId: workspace.id,
      projectId: project.id,
      parentId: body.parent ?? null,
      descriptionHtml: body.description_html ?? "<p></p>",
      descriptionBinary: binaryData,
      accessLevel: body.access ?? 0,
      colorProp: body.color ?? null,
      iconProp: body.logo_props ? JSON.stringify(body.logo_props) : null,
      ownedById: user.id,
      isLocked: false,
    })
    .returning();

  // Create page labels if provided
  if (body.labels && body.labels.length > 0) {
    await db.insert(pageLabels).values(
      body.labels.map((labelId) => ({
        pageId: newPage.id,
        labelId,
      }))
    );
  }

  const result = formatPageDetail(newPage, {
    isFavorite: false,
    labelIds: body.labels ?? [],
    projectIds: [project.id],
  });

  return c.json(result, 201);
});

// =====================
// PAGES SUMMARY
// =====================
pageRoutes.get("/summary/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const projectMembership = c.get("projectMembership");

  let baseCondition = and(
    eq(pages.workspaceId, workspace.id),
    eq(pages.projectId, project.id),
    isNull(pages.parentId),
    or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))
  );

  // If guest without guest_view_all_features, only count owned pages
  let allPages = await db.select().from(pages).where(baseCondition!);

  if (projectMembership?.role === ROLES.GUEST) {
    const guestViewAll = await getGuestViewAllFeatures(project.id);
    if (!guestViewAll) {
      allPages = allPages.filter((p) => p.ownedById === user.id);
    }
  }

  const stats = {
    public_pages: allPages.filter((p) => p.accessLevel === 0 && !p.archivedAt).length,
    private_pages: allPages.filter((p) => p.accessLevel === 1 && !p.archivedAt).length,
    archived_pages: allPages.filter((p) => p.archivedAt !== null).length,
  };

  return c.json(stats);
});

// =====================
// RETRIEVE PAGE
// =====================
pageRoutes.get("/:pageId/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");
  const projectMembership = c.get("projectMembership");
  const trackVisit = c.req.query("track_visit") !== "false";

  const data = await getPageWithExtras(pageId, user.id, project.id);
  if (!data) {
    return c.json({ error: "Page not found" }, 404);
  }

  const { page } = data;

  // Verify page belongs to this workspace/project
  if (page.workspaceId !== workspace.id || page.projectId !== project.id) {
    return c.json({ error: "Page not found" }, 404);
  }

  // Check access: private pages only visible to owner
  if (page.accessLevel === 1 && page.ownedById !== user.id) {
    return c.json({ error: "You are not allowed to view this page" }, 400);
  }

  // Guest check
  if (projectMembership?.role === ROLES.GUEST && page.ownedById !== user.id) {
    const guestViewAll = await getGuestViewAllFeatures(project.id);
    if (!guestViewAll) {
      return c.json({ error: "You are not allowed to view this page" }, 400);
    }
  }

  // Track recent visit
  if (trackVisit) {
    // Upsert recent visit
    const existingVisit = await db.query.recentVisits.findFirst({
      where: and(
        eq(recentVisits.userId, user.id),
        eq(recentVisits.entityType, "page"),
        eq(recentVisits.entityId, pageId),
        eq(recentVisits.workspaceId, workspace.id)
      ),
    });

    if (existingVisit) {
      await db
        .update(recentVisits)
        .set({ visitedAt: new Date() })
        .where(eq(recentVisits.id, existingVisit.id));
    } else {
      await db.insert(recentVisits).values({
        workspaceId: workspace.id,
        userId: user.id,
        entityType: "page",
        entityId: pageId,
        visitedAt: new Date(),
      });
    }
  }

  const result = formatPageDetail(data.page, {
    isFavorite: data.isFavorite,
    labelIds: data.labelIds,
    projectIds: data.projectIds,
  });

  return c.json(result);
});

// =====================
// UPDATE PAGE
// =====================
pageRoutes.patch("/:pageId/", zValidator("json", updatePageSchema), async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  if (!canModifyPage(role)) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  if (page.isLocked) {
    return c.json({ error: "Page is locked" }, 400);
  }

  const body = c.req.valid("json");

  // Only owner can change access
  if (body.access !== undefined && body.access !== page.accessLevel && page.ownedById !== user.id) {
    return c.json(
      { error: "Access cannot be updated since this page is owned by someone else" },
      400
    );
  }

  // Validate parent if provided
  if (body.parent) {
    const parentPage = await db.query.pages.findFirst({
      where: and(
        eq(pages.id, body.parent),
        eq(pages.workspaceId, workspace.id),
        eq(pages.projectId, project.id)
      ),
    });
    if (!parentPage) {
      return c.json({ error: "Parent page not found" }, 400);
    }
  }

  // Build update object
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description_html !== undefined) updateData.descriptionHtml = body.description_html;
  if (body.access !== undefined) updateData.accessLevel = body.access;
  if (body.color !== undefined) updateData.colorProp = body.color;
  if (body.logo_props !== undefined) updateData.iconProp = body.logo_props ? JSON.stringify(body.logo_props) : null;
  if (body.parent !== undefined) updateData.parentId = body.parent;
  if (body.is_locked !== undefined) updateData.isLocked = body.is_locked;

  await db.update(pages).set(updateData).where(eq(pages.id, pageId));

  // Update labels if provided
  if (body.labels !== undefined) {
    await db.delete(pageLabels).where(eq(pageLabels.pageId, pageId));
    if (body.labels.length > 0) {
      await db.insert(pageLabels).values(
        body.labels.map((labelId) => ({
          pageId,
          labelId,
        }))
      );
    }
  }

  const updated = await getPageWithExtras(pageId, user.id, project.id);
  if (!updated) {
    return c.json({ error: "Page not found" }, 404);
  }

  return c.json(
    formatPageDetail(updated.page, {
      isFavorite: updated.isFavorite,
      labelIds: updated.labelIds,
      projectIds: updated.projectIds,
    })
  );
});

// =====================
// DELETE PAGE
// =====================
pageRoutes.delete("/:pageId/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  // Page must be archived before deletion
  if (!page.archivedAt) {
    return c.json({ error: "The page should be archived before deleting" }, 400);
  }

  // Only owner or admin can delete
  if (page.ownedById !== user.id && !canDeletePage(role)) {
    return c.json({ error: "Only admin or owner can delete the page" }, 403);
  }

  await db.transaction(async (tx) => {
    // Remove parent from children
    await tx
      .update(pages)
      .set({ parentId: null })
      .where(
        and(
          eq(pages.parentId, pageId),
          eq(pages.workspaceId, workspace.id),
          eq(pages.projectId, project.id)
        )
      );

    // Delete the page
    await tx.delete(pages).where(eq(pages.id, pageId));

    // Delete favorites referencing this page
    await tx.delete(pageFavorites).where(eq(pageFavorites.pageId, pageId));

    // Delete from favorites table (workspace-level)
    await tx
      .delete(favorites)
      .where(
        and(
          eq(favorites.entityType, "page"),
          eq(favorites.entityId, pageId),
          eq(favorites.workspaceId, workspace.id)
        )
      );

    // Delete recent visits
    await tx
      .delete(recentVisits)
      .where(
        and(
          eq(recentVisits.entityType, "page"),
          eq(recentVisits.entityId, pageId),
          eq(recentVisits.workspaceId, workspace.id)
        )
      );
  });

  return c.body(null, 204);
});

// =====================
// FAVORITE PAGE
// =====================
pageRoutes.post("/:pageId/favorite/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  if (!canModifyPage(role)) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  // Check page exists
  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.projectId, project.id)),
  });
  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  // Check if already favorited
  const existing = await db.query.pageFavorites.findFirst({
    where: and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, user.id)),
  });

  if (!existing) {
    await db.insert(pageFavorites).values({
      pageId,
      userId: user.id,
    });
  }

  return c.body(null, 204);
});

// =====================
// UNFAVORITE PAGE
// =====================
pageRoutes.delete("/:pageId/favorite/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  if (!canModifyPage(role)) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  await db
    .delete(pageFavorites)
    .where(and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, user.id)));

  return c.body(null, 204);
});

// =====================
// ARCHIVE PAGE
// =====================
pageRoutes.post("/:pageId/archive/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  // Only owner or admin can archive
  if (role !== null && role <= ROLES.MEMBER && page.ownedById !== user.id) {
    return c.json({ error: "Only the owner or admin can archive the page" }, 400);
  }

  const now = new Date();

  // Archive page and all descendants recursively
  await archivePageAndDescendants(pageId, now);

  // Remove favorites for this page
  await db.delete(pageFavorites).where(eq(pageFavorites.pageId, pageId));

  return c.json({ archived_at: now.toISOString() });
});

// =====================
// UNARCHIVE PAGE
// =====================
pageRoutes.delete("/:pageId/archive/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  // Only owner or admin can unarchive
  if (role !== null && role <= ROLES.MEMBER && page.ownedById !== user.id) {
    return c.json({ error: "Only the owner or admin can un archive the page" }, 400);
  }

  // If parent is archived, break the hierarchy
  if (page.parentId) {
    const parent = await db.query.pages.findFirst({
      where: eq(pages.id, page.parentId),
    });
    if (parent?.archivedAt) {
      await db.update(pages).set({ parentId: null }).where(eq(pages.id, pageId));
    }
  }

  // Unarchive page and all descendants
  await archivePageAndDescendants(pageId, null);

  return c.body(null, 204);
});

// =====================
// LOCK PAGE
// =====================
pageRoutes.post("/:pageId/lock/", async (c) => {
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const membership = c.get("projectMembership");
  const role = membership?.role ?? null;
  const pageId = c.req.param("pageId");

  if (!canModifyPage(role)) {
    return c.json({ error: "You do not have permission to lock this page" }, 403);
  }

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  await db.update(pages).set({ isLocked: true, updatedAt: new Date() }).where(eq(pages.id, pageId));

  return c.body(null, 204);
});

// =====================
// UNLOCK PAGE
// =====================
pageRoutes.delete("/:pageId/lock/", async (c) => {
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const membership = c.get("projectMembership");
  const role = membership?.role ?? null;
  const pageId = c.req.param("pageId");

  if (!canModifyPage(role)) {
    return c.json({ error: "You do not have permission to unlock this page" }, 403);
  }

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  await db.update(pages).set({ isLocked: false, updatedAt: new Date() }).where(eq(pages.id, pageId));

  return c.body(null, 204);
});

// =====================
// CHANGE ACCESS
// =====================
pageRoutes.post("/:pageId/access/", zValidator("json", accessSchema), async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");
  const body = c.req.valid("json");

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  // Only owner can change access
  if (page.accessLevel !== body.access && page.ownedById !== user.id) {
    return c.json(
      { error: "Access cannot be updated since this page is owned by someone else" },
      400
    );
  }

  await db
    .update(pages)
    .set({ accessLevel: body.access, updatedAt: new Date() })
    .where(eq(pages.id, pageId));

  return c.body(null, 204);
});

// =====================
// GET PAGE DESCRIPTION (binary stream)
// =====================
pageRoutes.get("/:pageId/description/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id),
      or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  const binaryData = page.descriptionBinary;

  const responseData = binaryData ? new Uint8Array(binaryData as ArrayBuffer) : new Uint8Array(0);
  return new Response(responseData, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="page_description.bin"',
    },
  });
});

// =====================
// UPDATE PAGE DESCRIPTION
// =====================
pageRoutes.patch(
  "/:pageId/description/",
  zValidator("json", updateDescriptionSchema),
  async (c) => {
    const user = c.get("user")!;
    const project = c.get("project")!;
    const workspace = c.get("workspace")!;
    const membership = c.get("projectMembership");
    const role = membership?.role ?? null;
    const pageId = c.req.param("pageId");

    const page = await db.query.pages.findFirst({
      where: and(
        eq(pages.id, pageId),
        eq(pages.workspaceId, workspace.id),
        eq(pages.projectId, project.id),
        or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))
      ),
    });

    if (!page) {
      return c.json({ error: "Page not found" }, 404);
    }

    // Only owner or members+ can edit page descriptions
    if (page.ownedById !== user.id && !canModifyPage(role)) {
      return c.json({ error: "You do not have permission to edit this page" }, 403);
    }

    if (page.isLocked) {
      return c.json({ error_code: 4001, error_message: "PAGE_LOCKED" }, 400);
    }

    if (page.archivedAt) {
      return c.json({ error_code: 4002, error_message: "PAGE_ARCHIVED" }, 400);
    }

    const body = c.req.valid("json");

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (body.description_html !== undefined) {
      updateData.descriptionHtml = body.description_html;
    }

    if (body.description_binary !== undefined) {
      try {
        updateData.descriptionBinary = Buffer.from(body.description_binary, "base64");
      } catch {
        return c.json({ error: "Invalid base64 binary data" }, 400);
      }
    }

    await db.update(pages).set(updateData).where(eq(pages.id, pageId));

    // Create a version snapshot
    await db.insert(pageVersions).values({
      pageId,
      descriptionHtml: (updateData.descriptionHtml as string) ?? page.descriptionHtml,
      descriptionStripped: null,
      ownedById: user.id,
      lastSavedAt: new Date(),
    });

    return c.json({ message: "Updated successfully" });
  }
);

// =====================
// LIST PAGE VERSIONS
// =====================
pageRoutes.get("/:pageId/versions/", async (c) => {
  const workspace = c.get("workspace")!;
  const project = c.get("project")!;
  const pageId = c.req.param("pageId");

  // Verify page exists
  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  const versions = await db
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.createdAt));

  return c.json(versions.map(formatPageVersion));
});

// =====================
// GET PAGE VERSION DETAIL
// =====================
pageRoutes.get("/:pageId/versions/:versionId/", async (c) => {
  const workspace = c.get("workspace")!;
  const project = c.get("project")!;
  const pageId = c.req.param("pageId");
  const versionId = c.req.param("versionId");

  // Verify page exists
  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  const version = await db.query.pageVersions.findFirst({
    where: and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)),
  });

  if (!version) {
    return c.json({ error: "Version not found" }, 404);
  }

  return c.json(formatPageVersionDetail(version));
});

// =====================
// DUPLICATE PAGE
// =====================
pageRoutes.post("/:pageId/duplicate/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  // Private pages can only be duplicated by owner
  if (page.accessLevel === 1 && page.ownedById !== user.id) {
    return c.json({ error: "Permission denied" }, 403);
  }

  // Create duplicate (without binary data, as per Django implementation)
  const [duplicated] = await db
    .insert(pages)
    .values({
      name: `${page.name} (Copy)`,
      workspaceId: page.workspaceId,
      projectId: page.projectId,
      parentId: null,
      descriptionHtml: page.descriptionHtml,
      descriptionStripped: page.descriptionStripped,
      descriptionBinary: null, // Binary not copied per Django
      accessLevel: page.accessLevel,
      colorProp: page.colorProp,
      iconProp: page.iconProp,
      coverImage: page.coverImage,
      ownedById: user.id,
      isLocked: false,
    })
    .returning();

  const result = formatPageDetail(duplicated, {
    isFavorite: false,
    labelIds: [],
    projectIds: [project.id],
  });

  return c.json(result, 201);
});

// =====================
// MOVE PAGE TO ANOTHER PROJECT
// =====================
pageRoutes.post("/:pageId/move/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  if (!canModifyPage(role)) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  const body = await c.req.json<{ new_project_id: string }>();
  if (!body.new_project_id) {
    return c.json({ error: "new_project_id is required" }, 400);
  }

  // Verify target project exists in the same workspace
  const targetProject = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, body.new_project_id),
      eq(projects.workspaceId, workspace.id)
    ),
  });

  if (!targetProject) {
    return c.json({ error: "Target project not found" }, 404);
  }

  // Move page and all descendants
  await movePageAndDescendants(pageId, body.new_project_id);

  return c.body(null, 204);
});

// =====================
// RESTORE PAGE VERSION
// =====================
pageRoutes.post("/:pageId/versions/:versionId/restore/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const pageId = c.req.param("pageId");
  const versionId = c.req.param("versionId");
  const role = c.get("projectMembership")?.role ?? null;

  if (!canModifyPage(role)) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  const page = await db.query.pages.findFirst({
    where: and(
      eq(pages.id, pageId),
      eq(pages.workspaceId, workspace.id),
      eq(pages.projectId, project.id)
    ),
  });

  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  if (page.isLocked) {
    return c.json({ error_code: 4001, error_message: "PAGE_LOCKED" }, 400);
  }

  if (page.archivedAt) {
    return c.json({ error_code: 4002, error_message: "PAGE_ARCHIVED" }, 400);
  }

  const version = await db.query.pageVersions.findFirst({
    where: and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)),
  });

  if (!version) {
    return c.json({ error: "Version not found" }, 404);
  }

  // Create a new version snapshot of current state before restoring
  await db.insert(pageVersions).values({
    pageId,
    descriptionHtml: page.descriptionHtml,
    descriptionStripped: page.descriptionStripped,
    ownedById: user.id,
    lastSavedAt: new Date(),
  });

  // Restore the page description from the version
  await db
    .update(pages)
    .set({
      descriptionHtml: version.descriptionHtml,
      descriptionStripped: version.descriptionStripped,
      updatedAt: new Date(),
    })
    .where(eq(pages.id, pageId));

  return c.json({ message: "Version restored successfully" });
});

// --- Helper: archive/unarchive page and descendants recursively ---
async function archivePageAndDescendants(pageId: string, archivedAt: Date | null) {
  // Update the page itself
  await db.update(pages).set({ archivedAt, updatedAt: new Date() }).where(eq(pages.id, pageId));

  // Find children
  const children = await db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.parentId, pageId));

  // Recursively archive/unarchive children
  for (const child of children) {
    await archivePageAndDescendants(child.id, archivedAt);
  }
}

// --- Helper: move page and descendants to a new project ---
async function movePageAndDescendants(pageId: string, newProjectId: string) {
  await db.update(pages).set({ projectId: newProjectId, updatedAt: new Date() }).where(eq(pages.id, pageId));

  const children = await db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.parentId, pageId));

  for (const child of children) {
    await movePageAndDescendants(child.id, newProjectId);
  }
}

// =====================
// FAVORITE PAGES ROUTES (separate path: /favorite-pages/:pageId/)
// These match the frontend's expected URL pattern
// =====================
const pageFavoriteRoutes = new Hono<{ Variables: Variables }>();
pageFavoriteRoutes.use("*", authMiddleware);
pageFavoriteRoutes.use("*", workspaceMiddleware);
pageFavoriteRoutes.use("*", projectMiddleware);

// GET /favorite-pages/ - List all favorite pages
pageFavoriteRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;

  const userFavs = await db
    .select({ pageId: pageFavorites.pageId })
    .from(pageFavorites)
    .where(eq(pageFavorites.userId, user.id));

  if (userFavs.length === 0) {
    return c.json([]);
  }

  const favPageIds = userFavs.map((f) => f.pageId);

  const favPages = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspace.id),
        eq(pages.projectId, project.id),
        sql`${pages.id} IN (${sql.join(
          favPageIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))
      )
    )
    .orderBy(desc(pages.createdAt));

  // Get labels for all pages
  const pageIds = favPages.map((p) => p.id);
  let allLabels: { pageId: string; labelId: string }[] = [];
  if (pageIds.length > 0) {
    allLabels = await db
      .select({ pageId: pageLabels.pageId, labelId: pageLabels.labelId })
      .from(pageLabels)
      .where(
        sql`${pageLabels.pageId} IN (${sql.join(
          pageIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
  }

  const labelsByPage = new Map<string, string[]>();
  for (const l of allLabels) {
    if (!labelsByPage.has(l.pageId)) labelsByPage.set(l.pageId, []);
    labelsByPage.get(l.pageId)!.push(l.labelId);
  }

  const result = favPages.map((p) =>
    formatPage(p, {
      isFavorite: true,
      labelIds: labelsByPage.get(p.id) ?? [],
      projectIds: [project.id],
    })
  );

  return c.json(result);
});

// POST /favorite-pages/:pageId/ - Add page to favorites
pageFavoriteRoutes.post("/:pageId/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  if (!canModifyPage(role)) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.projectId, project.id)),
  });
  if (!page) {
    return c.json({ error: "Page not found" }, 404);
  }

  const existing = await db.query.pageFavorites.findFirst({
    where: and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, user.id)),
  });

  if (!existing) {
    await db.insert(pageFavorites).values({
      pageId,
      userId: user.id,
    });
  }

  return c.body(null, 204);
});

// DELETE /favorite-pages/:pageId/ - Remove page from favorites
pageFavoriteRoutes.delete("/:pageId/", async (c) => {
  const user = c.get("user")!;
  const pageId = c.req.param("pageId");
  const role = c.get("projectMembership")?.role ?? null;

  if (!canModifyPage(role)) {
    return c.json({ detail: "You do not have permission to perform this action." }, 403);
  }

  await db
    .delete(pageFavorites)
    .where(and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, user.id)));

  return c.body(null, 204);
});

// =====================
// ARCHIVED PAGES ROUTES (separate path: /archived-pages/)
// =====================
const archivedPageRoutes = new Hono<{ Variables: Variables }>();
archivedPageRoutes.use("*", authMiddleware);
archivedPageRoutes.use("*", workspaceMiddleware);
archivedPageRoutes.use("*", projectMiddleware);

// GET /archived-pages/ - List all archived pages
archivedPageRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const projectMembership = c.get("projectMembership");

  let archivedPages = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspace.id),
        eq(pages.projectId, project.id),
        sql`${pages.archivedAt} IS NOT NULL`,
        or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))
      )
    )
    .orderBy(desc(pages.createdAt));

  // Guest restriction
  if (projectMembership?.role === ROLES.GUEST) {
    const guestViewAll = await getGuestViewAllFeatures(project.id);
    if (!guestViewAll) {
      archivedPages = archivedPages.filter((p) => p.ownedById === user.id);
    }
  }

  // Get favorites
  const userFavorites = await db
    .select({ pageId: pageFavorites.pageId })
    .from(pageFavorites)
    .where(eq(pageFavorites.userId, user.id));
  const favoriteSet = new Set(userFavorites.map((f) => f.pageId));

  // Get labels
  const pageIds = archivedPages.map((p) => p.id);
  let allLabels: { pageId: string; labelId: string }[] = [];
  if (pageIds.length > 0) {
    allLabels = await db
      .select({ pageId: pageLabels.pageId, labelId: pageLabels.labelId })
      .from(pageLabels)
      .where(
        sql`${pageLabels.pageId} IN (${sql.join(
          pageIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
  }

  const labelsByPage = new Map<string, string[]>();
  for (const l of allLabels) {
    if (!labelsByPage.has(l.pageId)) labelsByPage.set(l.pageId, []);
    labelsByPage.get(l.pageId)!.push(l.labelId);
  }

  const result = archivedPages.map((p) =>
    formatPage(p, {
      isFavorite: favoriteSet.has(p.id),
      labelIds: labelsByPage.get(p.id) ?? [],
      projectIds: [project.id],
    })
  );

  return c.json(result);
});

// Pages summary route (separate path: /pages-summary/)
const pageSummaryRoutes = new Hono<{ Variables: Variables }>();
pageSummaryRoutes.use("*", authMiddleware);
pageSummaryRoutes.use("*", workspaceMiddleware);
pageSummaryRoutes.use("*", projectMiddleware);

pageSummaryRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const project = c.get("project")!;
  const workspace = c.get("workspace")!;
  const projectMembership = c.get("projectMembership");

  let allPages = await db
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspace.id),
        eq(pages.projectId, project.id),
        isNull(pages.parentId),
        or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))
      )
    );

  if (projectMembership?.role === ROLES.GUEST) {
    const guestViewAll = await getGuestViewAllFeatures(project.id);
    if (!guestViewAll) {
      allPages = allPages.filter((p) => p.ownedById === user.id);
    }
  }

  const stats = {
    public_pages: allPages.filter((p) => p.accessLevel === 0 && !p.archivedAt).length,
    private_pages: allPages.filter((p) => p.accessLevel === 1 && !p.archivedAt).length,
    archived_pages: allPages.filter((p) => p.archivedAt !== null).length,
  };

  return c.json(stats);
});

export { pageRoutes, pageFavoriteRoutes, archivedPageRoutes, pageSummaryRoutes };

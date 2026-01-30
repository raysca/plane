import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers } from "../../db/schema/project";
import { pages, pageFavorites, pageLabels, pageVersions } from "../../db/schema/page";
import { recentVisits } from "../../db/schema/workspace";
import { eq, and, or, desc, isNull, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const ROLES = { GUEST: 5, VIEWER: 10, MEMBER: 15, ADMIN: 20 } as const;

// Test IDs
const adminId = createId();
const memberId = createId();
const guestId = createId();
const workspaceId = createId();
const projectId = createId();

// Build test app with fake auth middleware
const app = new Hono();

app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);

  const role = parseInt(c.req.header("x-test-role") || "20");

  c.set("user" as any, { id: uid, email: "test@test.com", name: "Test" });
  c.set("session" as any, { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace" as any, { id: workspaceId, name: "Test WS", slug: "test-ws", ownerId: adminId });
  c.set("workspaceMembership" as any, { id: "wm", workspaceId, userId: uid, role: 20 });
  c.set("project" as any, { id: projectId, name: "Test Project", workspaceId, identifier: "TST", network: 2 });
  c.set("projectMembership" as any, { id: "pm", projectId, memberId: uid, role });
  await next();
});

// --- Helper functions (mirror the route logic) ---

async function getGuestViewAllFeatures(pId: string): Promise<boolean> {
  const project = await db.query.projects.findFirst({ where: eq(projects.id, pId) });
  return project?.guestViewAllFeatures ?? false;
}

function formatPage(p: any, extra?: { isFavorite?: boolean; labelIds?: string[]; projectIds?: string[] }) {
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

function formatPageDetail(p: any, extra?: any) {
  return { ...formatPage(p, extra), description_html: p.descriptionHtml ?? "<p></p>" };
}

async function archivePageAndDescendants(pageId: string, archivedAt: Date | null) {
  await db.update(pages).set({ archivedAt, updatedAt: new Date() }).where(eq(pages.id, pageId));
  const children = await db.select({ id: pages.id }).from(pages).where(eq(pages.parentId, pageId));
  for (const child of children) {
    await archivePageAndDescendants(child.id, archivedAt);
  }
}

async function getPageWithExtras(pageId: string, userId: string, pId: string) {
  const page = await db.query.pages.findFirst({ where: eq(pages.id, pageId) });
  if (!page) return null;
  const favorite = await db.query.pageFavorites.findFirst({
    where: and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, userId)),
  });
  const labels = await db.select({ labelId: pageLabels.labelId }).from(pageLabels).where(eq(pageLabels.pageId, pageId));
  return { page, isFavorite: !!favorite, labelIds: labels.map((l) => l.labelId), projectIds: [pId] };
}

// --- Routes (inline, bypasses real auth middleware) ---

// LIST
app.get("/pages/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const projectMembership: any = c.get("projectMembership" as any);

  let allPages = await db.select().from(pages).where(
    and(eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id), isNull(pages.parentId),
      or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0)))
  ).orderBy(desc(pages.createdAt));

  if (projectMembership?.role === ROLES.GUEST) {
    const guestViewAll = await getGuestViewAllFeatures(project.id);
    if (!guestViewAll) allPages = allPages.filter((p) => p.ownedById === user.id);
  }

  const userFavorites = await db.select({ pageId: pageFavorites.pageId }).from(pageFavorites).where(eq(pageFavorites.userId, user.id));
  const favoriteSet = new Set(userFavorites.map((f) => f.pageId));

  const pageIds = allPages.map((p) => p.id);
  let allLabels: { pageId: string; labelId: string }[] = [];
  if (pageIds.length > 0) {
    allLabels = await db.select({ pageId: pageLabels.pageId, labelId: pageLabels.labelId }).from(pageLabels)
      .where(sql`${pageLabels.pageId} IN (${sql.join(pageIds.map((id) => sql`${id}`), sql`, `)})`);
  }

  const labelsByPage = new Map<string, string[]>();
  for (const l of allLabels) {
    if (!labelsByPage.has(l.pageId)) labelsByPage.set(l.pageId, []);
    labelsByPage.get(l.pageId)!.push(l.labelId);
  }

  const sorted = allPages.sort((a, b) => {
    const aFav = favoriteSet.has(a.id) ? 1 : 0;
    const bFav = favoriteSet.has(b.id) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
  });

  return c.json(sorted.map((p) => formatPage(p, { isFavorite: favoriteSet.has(p.id), labelIds: labelsByPage.get(p.id) ?? [], projectIds: [project.id] })));
});

// CREATE
app.post("/pages/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const role = (c.get("projectMembership" as any) as any)?.role ?? null;

  if (role === null || role < ROLES.MEMBER) return c.json({ detail: "You do not have permission to perform this action." }, 403);

  const body = await c.req.json();

  const [newPage] = await db.insert(pages).values({
    name: body.name || "Untitled",
    workspaceId: workspace.id,
    projectId: project.id,
    parentId: body.parent ?? null,
    descriptionHtml: body.description_html ?? "<p></p>",
    accessLevel: body.access ?? 0,
    colorProp: body.color ?? null,
    iconProp: body.logo_props ? JSON.stringify(body.logo_props) : null,
    ownedById: user.id,
    isLocked: false,
  }).returning();

  return c.json(formatPageDetail(newPage, { isFavorite: false, labelIds: [], projectIds: [project.id] }), 201);
});

// RETRIEVE
app.get("/pages/:pageId/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const data = await getPageWithExtras(pageId, user.id, project.id);
  if (!data || data.page.workspaceId !== workspace.id || data.page.projectId !== project.id) {
    return c.json({ error: "Page not found" }, 404);
  }

  if (data.page.accessLevel === 1 && data.page.ownedById !== user.id) {
    return c.json({ error: "You are not allowed to view this page" }, 400);
  }

  return c.json(formatPageDetail(data.page, { isFavorite: data.isFavorite, labelIds: data.labelIds, projectIds: data.projectIds }));
});

// UPDATE
app.patch("/pages/:pageId/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");
  const role = (c.get("projectMembership" as any) as any)?.role ?? null;

  if (role === null || role < ROLES.MEMBER) return c.json({ detail: "Forbidden" }, 403);

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);
  if (page.isLocked) return c.json({ error: "Page is locked" }, 400);

  const body = await c.req.json();
  if (body.access !== undefined && body.access !== page.accessLevel && page.ownedById !== user.id) {
    return c.json({ error: "Access cannot be updated since this page is owned by someone else" }, 400);
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description_html !== undefined) updateData.descriptionHtml = body.description_html;
  if (body.access !== undefined) updateData.accessLevel = body.access;

  await db.update(pages).set(updateData).where(eq(pages.id, pageId));

  const updated = await getPageWithExtras(pageId, user.id, project.id);
  return c.json(formatPageDetail(updated!.page, { isFavorite: updated!.isFavorite, labelIds: updated!.labelIds, projectIds: updated!.projectIds }));
});

// DELETE
app.delete("/pages/:pageId/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");
  const role = (c.get("projectMembership" as any) as any)?.role ?? null;

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);
  if (!page.archivedAt) return c.json({ error: "The page should be archived before deleting" }, 400);
  if (page.ownedById !== user.id && (role === null || role < ROLES.ADMIN)) {
    return c.json({ error: "Only admin or owner can delete the page" }, 403);
  }

  await db.update(pages).set({ parentId: null }).where(and(eq(pages.parentId, pageId), eq(pages.workspaceId, workspace.id)));
  await db.delete(pages).where(eq(pages.id, pageId));
  await db.delete(pageFavorites).where(eq(pageFavorites.pageId, pageId));

  return new Response(null, { status: 204 });
});

// LOCK
app.post("/pages/:pageId/lock/", async (c) => {
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);

  await db.update(pages).set({ isLocked: true, updatedAt: new Date() }).where(eq(pages.id, pageId));
  return new Response(null, { status: 204 });
});

// UNLOCK
app.delete("/pages/:pageId/lock/", async (c) => {
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);

  await db.update(pages).set({ isLocked: false, updatedAt: new Date() }).where(eq(pages.id, pageId));
  return new Response(null, { status: 204 });
});

// ACCESS
app.post("/pages/:pageId/access/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");
  const body = await c.req.json();

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);

  if (page.accessLevel !== body.access && page.ownedById !== user.id) {
    return c.json({ error: "Access cannot be updated since this page is owned by someone else" }, 400);
  }

  await db.update(pages).set({ accessLevel: body.access, updatedAt: new Date() }).where(eq(pages.id, pageId));
  return new Response(null, { status: 204 });
});

// FAVORITE
app.post("/pages/:pageId/favorite/", async (c) => {
  const user: any = c.get("user" as any);
  const pageId = c.req.param("pageId");
  const role = (c.get("projectMembership" as any) as any)?.role ?? null;
  if (role === null || role < ROLES.MEMBER) return c.json({ detail: "Forbidden" }, 403);

  const existing = await db.query.pageFavorites.findFirst({
    where: and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, user.id)),
  });
  if (!existing) {
    await db.insert(pageFavorites).values({ pageId, userId: user.id });
  }
  return new Response(null, { status: 204 });
});

// UNFAVORITE
app.delete("/pages/:pageId/favorite/", async (c) => {
  const user: any = c.get("user" as any);
  const pageId = c.req.param("pageId");

  await db.delete(pageFavorites).where(and(eq(pageFavorites.pageId, pageId), eq(pageFavorites.userId, user.id)));
  return new Response(null, { status: 204 });
});

// ARCHIVE
app.post("/pages/:pageId/archive/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);

  const now = new Date();
  await archivePageAndDescendants(pageId, now);
  await db.delete(pageFavorites).where(eq(pageFavorites.pageId, pageId));
  return c.json({ archived_at: now.toISOString() });
});

// UNARCHIVE
app.delete("/pages/:pageId/archive/", async (c) => {
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);

  if (page.parentId) {
    const parent = await db.query.pages.findFirst({ where: eq(pages.id, page.parentId) });
    if (parent?.archivedAt) {
      await db.update(pages).set({ parentId: null }).where(eq(pages.id, pageId));
    }
  }
  await archivePageAndDescendants(pageId, null);
  return new Response(null, { status: 204 });
});

// SUMMARY
app.get("/pages-summary/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);

  const allPages = await db.select().from(pages).where(
    and(eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id), isNull(pages.parentId),
      or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0)))
  );

  return c.json({
    public_pages: allPages.filter((p) => p.accessLevel === 0 && !p.archivedAt).length,
    private_pages: allPages.filter((p) => p.accessLevel === 1 && !p.archivedAt).length,
    archived_pages: allPages.filter((p) => p.archivedAt !== null).length,
  });
});

// DESCRIPTION GET
app.get("/pages/:pageId/description/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id),
      or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);

  const responseData = page.descriptionBinary ? new Uint8Array(page.descriptionBinary as ArrayBuffer) : new Uint8Array(0);
  return new Response(responseData, {
    headers: { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="page_description.bin"' },
  });
});

// DESCRIPTION UPDATE
app.patch("/pages/:pageId/description/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id),
      or(eq(pages.ownedById, user.id), eq(pages.accessLevel, 0))),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);
  if (page.isLocked) return c.json({ error_code: 4001, error_message: "PAGE_LOCKED" }, 400);
  if (page.archivedAt) return c.json({ error_code: 4002, error_message: "PAGE_ARCHIVED" }, 400);

  const body = await c.req.json();
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.description_html !== undefined) updateData.descriptionHtml = body.description_html;

  await db.update(pages).set(updateData).where(eq(pages.id, pageId));

  await db.insert(pageVersions).values({
    pageId,
    descriptionHtml: (updateData.descriptionHtml as string) ?? page.descriptionHtml,
    ownedById: user.id,
    lastSavedAt: new Date(),
  });

  return c.json({ message: "Updated successfully" });
});

// VERSIONS LIST
app.get("/pages/:pageId/versions/", async (c) => {
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);

  const versions = await db.select().from(pageVersions).where(eq(pageVersions.pageId, pageId)).orderBy(desc(pageVersions.createdAt));
  return c.json(versions.map((v) => ({
    id: v.id,
    page: v.pageId,
    last_saved_at: v.lastSavedAt?.toISOString() ?? null,
    owned_by: v.ownedById,
    created_at: v.createdAt?.toISOString() ?? null,
  })));
});

// DUPLICATE
app.post("/pages/:pageId/duplicate/", async (c) => {
  const user: any = c.get("user" as any);
  const project: any = c.get("project" as any);
  const workspace: any = c.get("workspace" as any);
  const pageId = c.req.param("pageId");

  const page = await db.query.pages.findFirst({
    where: and(eq(pages.id, pageId), eq(pages.workspaceId, workspace.id), eq(pages.projectId, project.id)),
  });
  if (!page) return c.json({ error: "Page not found" }, 404);

  if (page.accessLevel === 1 && page.ownedById !== user.id) {
    return c.json({ error: "Permission denied" }, 403);
  }

  const [duplicated] = await db.insert(pages).values({
    name: `${page.name} (Copy)`,
    workspaceId: page.workspaceId,
    projectId: page.projectId,
    descriptionHtml: page.descriptionHtml,
    descriptionBinary: null,
    accessLevel: page.accessLevel,
    colorProp: page.colorProp,
    iconProp: page.iconProp,
    ownedById: user.id,
    isLocked: false,
  }).returning();

  return c.json(formatPageDetail(duplicated, { isFavorite: false, labelIds: [], projectIds: [project.id] }), 201);
});

// --- Request Helper ---
async function makeRequest(method: string, path: string, userId: string, body?: unknown, role?: number) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-test-user": userId,
    "x-test-role": String(role ?? 20),
  };
  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

// --- Setup ---
beforeAll(async () => {
  await db.insert(users).values([
    { id: adminId, email: `admin-${adminId}@test.com`, name: "Admin", emailVerified: true },
    { id: memberId, email: `member-${memberId}@test.com`, name: "Member", emailVerified: true },
    { id: guestId, email: `guest-${guestId}@test.com`, name: "Guest", emailVerified: true },
  ]).onConflictDoNothing();

  await db.insert(workspaces).values({
    id: workspaceId, name: "Test WS", slug: `test-ws-${workspaceId}`, ownerId: adminId,
  }).onConflictDoNothing();

  await db.insert(workspaceMembers).values([
    { workspaceId, userId: adminId, role: 20 },
    { workspaceId, userId: memberId, role: 15 },
    { workspaceId, userId: guestId, role: 5 },
  ]).onConflictDoNothing();

  await db.insert(projects).values({
    id: projectId, workspaceId, name: "Test Project", identifier: `TST${projectId.slice(0, 4).toUpperCase()}`,
    network: 2, createdById: adminId,
  }).onConflictDoNothing();

  await db.insert(projectMembers).values([
    { projectId, memberId: adminId, role: 20 },
    { projectId, memberId, role: 15 },
    { projectId, memberId: guestId, role: 5 },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(pageVersions).where(
    sql`${pageVersions.pageId} IN (SELECT id FROM pages WHERE workspace_id = ${workspaceId})`
  );
  await db.delete(pageFavorites).where(
    sql`${pageFavorites.pageId} IN (SELECT id FROM pages WHERE workspace_id = ${workspaceId})`
  );
  await db.delete(pageLabels).where(
    sql`${pageLabels.pageId} IN (SELECT id FROM pages WHERE workspace_id = ${workspaceId})`
  );
  await db.delete(pages).where(eq(pages.workspaceId, workspaceId));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, adminId));
  await db.delete(users).where(eq(users.id, memberId));
  await db.delete(users).where(eq(users.id, guestId));
});

// --- Tests ---

describe("Page Routes", () => {
  let createdPageId: string;

  describe("POST /pages/ - Create Page", () => {
    test("admin can create a page", async () => {
      const res = await makeRequest("POST", "/pages/", adminId, {
        name: "Test Page",
        description_html: "<p>Hello</p>",
        access: 0,
      });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.name).toBe("Test Page");
      expect(data.description_html).toBe("<p>Hello</p>");
      expect(data.owned_by).toBe(adminId);
      expect(data.access).toBe(0);
      expect(data.is_locked).toBe(false);
      createdPageId = data.id;
    });

    test("member can create a page", async () => {
      const res = await makeRequest("POST", "/pages/", memberId, { name: "Member Page" }, ROLES.MEMBER);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.name).toBe("Member Page");
      await db.delete(pages).where(eq(pages.id, data.id));
    });

    test("guest cannot create a page", async () => {
      const res = await makeRequest("POST", "/pages/", guestId, { name: "Guest Page" }, ROLES.GUEST);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /pages/ - List Pages", () => {
    test("returns list of pages", async () => {
      const res = await makeRequest("GET", "/pages/", adminId);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("GET /pages/:pageId/ - Retrieve Page", () => {
    test("returns page details", async () => {
      const res = await makeRequest("GET", `/pages/${createdPageId}/`, adminId);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(createdPageId);
      expect(data.name).toBe("Test Page");
    });

    test("returns 404 for non-existent page", async () => {
      const res = await makeRequest("GET", `/pages/${createId()}/`, adminId);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /pages/:pageId/ - Update Page", () => {
    test("admin can update a page", async () => {
      const res = await makeRequest("PATCH", `/pages/${createdPageId}/`, adminId, { name: "Updated Page" });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe("Updated Page");
    });

    test("cannot update locked page", async () => {
      await db.update(pages).set({ isLocked: true }).where(eq(pages.id, createdPageId));
      const res = await makeRequest("PATCH", `/pages/${createdPageId}/`, adminId, { name: "Should Fail" });
      expect(res.status).toBe(400);
      await db.update(pages).set({ isLocked: false }).where(eq(pages.id, createdPageId));
    });

    test("guest cannot update a page", async () => {
      const res = await makeRequest("PATCH", `/pages/${createdPageId}/`, guestId, { name: "Guest Update" }, ROLES.GUEST);
      expect(res.status).toBe(403);
    });
  });

  describe("POST/DELETE /pages/:pageId/lock/", () => {
    test("can lock a page", async () => {
      const res = await makeRequest("POST", `/pages/${createdPageId}/lock/`, adminId);
      expect(res.status).toBe(204);
      const page = await db.query.pages.findFirst({ where: eq(pages.id, createdPageId) });
      expect(page?.isLocked).toBe(true);
    });

    test("can unlock a page", async () => {
      const res = await makeRequest("DELETE", `/pages/${createdPageId}/lock/`, adminId);
      expect(res.status).toBe(204);
      const page = await db.query.pages.findFirst({ where: eq(pages.id, createdPageId) });
      expect(page?.isLocked).toBe(false);
    });
  });

  describe("POST /pages/:pageId/access/", () => {
    test("owner can change access", async () => {
      const res = await makeRequest("POST", `/pages/${createdPageId}/access/`, adminId, { access: 1 });
      expect(res.status).toBe(204);
      const page = await db.query.pages.findFirst({ where: eq(pages.id, createdPageId) });
      expect(page?.accessLevel).toBe(1);
    });

    test("non-owner cannot change access", async () => {
      const res = await makeRequest("POST", `/pages/${createdPageId}/access/`, memberId, { access: 0 }, ROLES.MEMBER);
      expect(res.status).toBe(400);
    });

    test("restore access to public", async () => {
      const res = await makeRequest("POST", `/pages/${createdPageId}/access/`, adminId, { access: 0 });
      expect(res.status).toBe(204);
    });
  });

  describe("POST/DELETE /pages/:pageId/favorite/", () => {
    test("can add to favorites", async () => {
      const res = await makeRequest("POST", `/pages/${createdPageId}/favorite/`, adminId);
      expect(res.status).toBe(204);
      const fav = await db.query.pageFavorites.findFirst({
        where: and(eq(pageFavorites.pageId, createdPageId), eq(pageFavorites.userId, adminId)),
      });
      expect(fav).toBeTruthy();
    });

    test("duplicate favorite is idempotent", async () => {
      const res = await makeRequest("POST", `/pages/${createdPageId}/favorite/`, adminId);
      expect(res.status).toBe(204);
    });

    test("can remove from favorites", async () => {
      const res = await makeRequest("DELETE", `/pages/${createdPageId}/favorite/`, adminId);
      expect(res.status).toBe(204);
      const fav = await db.query.pageFavorites.findFirst({
        where: and(eq(pageFavorites.pageId, createdPageId), eq(pageFavorites.userId, adminId)),
      });
      expect(fav).toBeUndefined();
    });
  });

  describe("POST/DELETE /pages/:pageId/archive/", () => {
    test("can archive a page", async () => {
      const res = await makeRequest("POST", `/pages/${createdPageId}/archive/`, adminId);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.archived_at).toBeTruthy();
    });

    test("can unarchive a page", async () => {
      const res = await makeRequest("DELETE", `/pages/${createdPageId}/archive/`, adminId);
      expect(res.status).toBe(204);
      const page = await db.query.pages.findFirst({ where: eq(pages.id, createdPageId) });
      expect(page?.archivedAt).toBeNull();
    });
  });

  describe("GET /pages-summary/", () => {
    test("returns page counts", async () => {
      const res = await makeRequest("GET", "/pages-summary/", adminId);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(typeof data.public_pages).toBe("number");
      expect(typeof data.private_pages).toBe("number");
      expect(typeof data.archived_pages).toBe("number");
    });
  });

  describe("PATCH /pages/:pageId/description/", () => {
    test("can update page description", async () => {
      const res = await makeRequest("PATCH", `/pages/${createdPageId}/description/`, adminId, {
        description_html: "<p>Updated description</p>",
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toBe("Updated successfully");
    });

    test("creates a version on description update", async () => {
      const versions = await db.select().from(pageVersions).where(eq(pageVersions.pageId, createdPageId));
      expect(versions.length).toBeGreaterThanOrEqual(1);
    });

    test("cannot update description of locked page", async () => {
      await db.update(pages).set({ isLocked: true }).where(eq(pages.id, createdPageId));
      const res = await makeRequest("PATCH", `/pages/${createdPageId}/description/`, adminId, {
        description_html: "<p>Should fail</p>",
      });
      expect(res.status).toBe(400);
      await db.update(pages).set({ isLocked: false }).where(eq(pages.id, createdPageId));
    });
  });

  describe("GET /pages/:pageId/description/", () => {
    test("returns binary description", async () => {
      const res = await makeRequest("GET", `/pages/${createdPageId}/description/`, adminId);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/octet-stream");
    });
  });

  describe("GET /pages/:pageId/versions/", () => {
    test("returns page versions", async () => {
      const res = await makeRequest("GET", `/pages/${createdPageId}/versions/`, adminId);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("POST /pages/:pageId/duplicate/", () => {
    test("can duplicate a page", async () => {
      const res = await makeRequest("POST", `/pages/${createdPageId}/duplicate/`, adminId);
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.name).toBe("Updated Page (Copy)");
      expect(data.id).not.toBe(createdPageId);
      await db.delete(pages).where(eq(pages.id, data.id));
    });

    test("cannot duplicate private page owned by someone else", async () => {
      await db.update(pages).set({ accessLevel: 1 }).where(eq(pages.id, createdPageId));
      const res = await makeRequest("POST", `/pages/${createdPageId}/duplicate/`, memberId, undefined, ROLES.MEMBER);
      expect(res.status).toBe(403);
      await db.update(pages).set({ accessLevel: 0 }).where(eq(pages.id, createdPageId));
    });
  });

  describe("DELETE /pages/:pageId/ - Delete Page", () => {
    test("cannot delete non-archived page", async () => {
      const res = await makeRequest("DELETE", `/pages/${createdPageId}/`, adminId);
      expect(res.status).toBe(400);
    });

    test("can delete archived page as admin/owner", async () => {
      await db.update(pages).set({ archivedAt: new Date() }).where(eq(pages.id, createdPageId));
      const res = await makeRequest("DELETE", `/pages/${createdPageId}/`, adminId);
      expect(res.status).toBe(204);
      const page = await db.query.pages.findFirst({ where: eq(pages.id, createdPageId) });
      expect(page).toBeUndefined();
    });
  });
});

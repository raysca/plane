import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers } from "../../db/schema/project";
import { views, viewFavorites } from "../../db/schema/view";
import { eq, and, desc, asc, max } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

const ROLES = { GUEST: 5, VIEWER: 10, MEMBER: 15, ADMIN: 20 } as const;

const userId = createId();
const otherUserId = createId();
const workspaceId = createId();
const projectId = createId();

// Helper to format view response (mirrors the one in routes)
function formatView(v: any, wId: string, isFav: boolean) {
  return {
    id: v.id,
    workspace: wId,
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
    is_favorite: isFav,
    owned_by: v.ownedById,
    created_at: v.createdAt?.toISOString() ?? null,
    updated_at: v.updatedAt?.toISOString() ?? null,
  };
}

// Build test app with inline routes (bypasses authMiddleware)
const app = new Hono();

app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  c.set("user" as any, { id: uid, email: "test@test.com", name: "Test" });
  c.set("workspace" as any, { id: workspaceId, name: "Test WS", slug: "test-ws", ownerId: userId });
  c.set("workspaceMembership" as any, { id: "wm", workspaceId, userId: uid, role: 20 });
  c.set("project" as any, { id: projectId, name: "Test Project", workspaceId, identifier: "TP", network: 2 });
  c.set("projectMembership" as any, { id: "pm", projectId, memberId: uid, role: 20 });
  await next();
});

// LIST
app.get("/views/", async (c) => {
  const workspace: any = c.get("workspace" as any);
  const project: any = c.get("project" as any);
  const user: any = c.get("user" as any);
  const membership: any = c.get("projectMembership" as any);
  const isGuest = membership.role === ROLES.GUEST;

  const allViews = await db.query.views.findMany({
    where: and(eq(views.workspaceId, workspace.id), eq(views.projectId, project.id)),
    orderBy: [desc(views.createdAt)],
  });

  const filtered = isGuest
    ? allViews.filter((v) => v.ownedById === user.id)
    : allViews.filter((v) => v.ownedById === user.id || (v.accessLevel ?? 0) >= 1);

  const userFavs = await db.select({ viewId: viewFavorites.viewId }).from(viewFavorites).where(eq(viewFavorites.userId, user.id));
  const favSet = new Set(userFavs.map((f) => f.viewId));

  const result = filtered
    .sort((a, b) => (favSet.has(b.id) ? 1 : 0) - (favSet.has(a.id) ? 1 : 0))
    .map((v) => formatView(v, workspace.id, favSet.has(v.id)));

  return c.json(result);
});

// CREATE
app.post("/views/", zValidator("json", z.object({
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
})), async (c) => {
  const workspace: any = c.get("workspace" as any);
  const project: any = c.get("project" as any);
  const user: any = c.get("user" as any);
  const body = c.req.valid("json");

  let sortOrder = body.sort_order;
  if (sortOrder === undefined) {
    const maxR = await db.select({ largest: max(views.sortOrder) }).from(views).where(and(eq(views.workspaceId, workspace.id), eq(views.projectId, project.id)));
    const largest = maxR[0]?.largest;
    sortOrder = largest != null ? largest + 10000 : 65535;
  }

  const [created] = await db.insert(views).values({
    workspaceId: workspace.id, projectId: project.id, name: body.name, description: body.description,
    query: body.query, queryData: body.query_data, filtersData: body.filters,
    displayFilters: body.display_filters, displayProperties: body.display_properties,
    accessLevel: body.access, sortOrder, isLocked: body.is_locked, ownedById: user.id,
  }).returning();

  return c.json(formatView(created, workspace.id, false), 201);
});

// RETRIEVE
app.get("/views/:viewId/", async (c) => {
  const workspace: any = c.get("workspace" as any);
  const project: any = c.get("project" as any);
  const user: any = c.get("user" as any);
  const viewId = c.req.param("viewId");

  const view = await db.query.views.findFirst({
    where: and(eq(views.id, viewId), eq(views.workspaceId, workspace.id), eq(views.projectId, project.id)),
  });
  if (!view) return c.json({ detail: "Not found." }, 404);

  const fav = await db.query.viewFavorites.findFirst({
    where: and(eq(viewFavorites.viewId, view.id), eq(viewFavorites.userId, user.id)),
  });

  return c.json(formatView(view, workspace.id, !!fav));
});

// UPDATE
app.patch("/views/:viewId/", zValidator("json", z.object({
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
})), async (c) => {
  const workspace: any = c.get("workspace" as any);
  const project: any = c.get("project" as any);
  const user: any = c.get("user" as any);
  const viewId = c.req.param("viewId");

  const view = await db.query.views.findFirst({
    where: and(eq(views.id, viewId), eq(views.workspaceId, workspace.id), eq(views.projectId, project.id)),
  });
  if (!view) return c.json({ detail: "Not found." }, 404);
  if (view.ownedById !== user.id) return c.json({ detail: "Only the owner can update this view." }, 403);

  const body = c.req.valid("json");
  if (view.isLocked && body.is_locked !== false) return c.json({ detail: "View is locked." }, 400);

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

  const [updated] = await db.update(views).set(updateData).where(eq(views.id, viewId)).returning();

  const fav = await db.query.viewFavorites.findFirst({
    where: and(eq(viewFavorites.viewId, updated.id), eq(viewFavorites.userId, user.id)),
  });

  return c.json(formatView(updated, workspace.id, !!fav));
});

// DELETE
app.delete("/views/:viewId/", async (c) => {
  const workspace: any = c.get("workspace" as any);
  const project: any = c.get("project" as any);
  const user: any = c.get("user" as any);
  const membership: any = c.get("projectMembership" as any);
  const viewId = c.req.param("viewId");

  const view = await db.query.views.findFirst({
    where: and(eq(views.id, viewId), eq(views.workspaceId, workspace.id), eq(views.projectId, project.id)),
  });
  if (!view) return c.json({ detail: "Not found." }, 404);

  const isAdmin = membership.role === ROLES.ADMIN;
  const isOwner = view.ownedById === user.id;
  if (!isAdmin && !isOwner) return c.json({ detail: "Only the owner or admin can delete this view." }, 403);

  await db.delete(viewFavorites).where(eq(viewFavorites.viewId, viewId));
  await db.delete(views).where(eq(views.id, viewId));
  return c.body(null, 204);
});

// FAVORITE
app.post("/user-favorite-views/", zValidator("json", z.object({ view: z.string().min(1) })), async (c) => {
  const workspace: any = c.get("workspace" as any);
  const project: any = c.get("project" as any);
  const user: any = c.get("user" as any);
  const body = c.req.valid("json");

  const view = await db.query.views.findFirst({
    where: and(eq(views.id, body.view), eq(views.workspaceId, workspace.id), eq(views.projectId, project.id)),
  });
  if (!view) return c.json({ detail: "View not found." }, 404);

  const existing = await db.query.viewFavorites.findFirst({
    where: and(eq(viewFavorites.viewId, view.id), eq(viewFavorites.userId, user.id)),
  });
  if (existing) return c.json({ detail: "View already favorited." }, 400);

  const [fav] = await db.insert(viewFavorites).values({ viewId: view.id, userId: user.id }).returning();
  return c.json({ id: fav.id, view: fav.viewId, user: fav.userId, created_at: fav.createdAt?.toISOString() ?? null }, 201);
});

// UNFAVORITE
app.delete("/user-favorite-views/:viewId/", async (c) => {
  const user: any = c.get("user" as any);
  const viewId = c.req.param("viewId");

  const fav = await db.query.viewFavorites.findFirst({
    where: and(eq(viewFavorites.viewId, viewId), eq(viewFavorites.userId, user.id)),
  });
  if (!fav) return c.json({ detail: "Favorite not found." }, 404);

  await db.delete(viewFavorites).where(eq(viewFavorites.id, fav.id));
  return c.body(null, 204);
});

function h(uid: string = userId) {
  return { "x-test-user": uid, "Content-Type": "application/json" };
}

describe("Project Views CRUD", () => {
  let viewId: string;

  beforeAll(async () => {
    await db.insert(users).values([
      { id: userId, email: "pv-test@test.com", name: "PV Test", emailVerified: true },
      { id: otherUserId, email: "pv-other@test.com", name: "PV Other", emailVerified: true },
    ]);
    await db.insert(workspaces).values({ id: workspaceId, name: "Test WS", slug: "pv-test-ws", ownerId: userId });
    await db.insert(workspaceMembers).values({ id: createId(), workspaceId, userId, role: 20 });
    await db.insert(projects).values({ id: projectId, workspaceId, name: "Test Project", identifier: "PVT", createdById: userId });
    await db.insert(projectMembers).values({ id: createId(), projectId, memberId: userId, role: 20 });
  });

  afterAll(async () => {
    await db.delete(viewFavorites).where(eq(viewFavorites.userId, userId));
    await db.delete(views).where(eq(views.projectId, projectId));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
  });

  test("GET views/ returns empty list initially", async () => {
    const res = await app.request("/views/", { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test("POST views/ creates a view", async () => {
    const res = await app.request("/views/", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ name: "My Test View", description: "A test view", access: 1 }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("My Test View");
    expect(data.description).toBe("A test view");
    expect(data.access).toBe(1);
    expect(data.project).toBe(projectId);
    expect(data.workspace).toBe(workspaceId);
    expect(data.is_favorite).toBe(false);
    expect(data.owned_by).toBe(userId);
    viewId = data.id;
  });

  test("GET views/ returns created view", async () => {
    const res = await app.request("/views/", { headers: h() });
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(viewId);
  });

  test("GET views/:viewId/ retrieves a view", async () => {
    const res = await app.request(`/views/${viewId}/`, { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(viewId);
    expect(data.name).toBe("My Test View");
  });

  test("PATCH views/:viewId/ updates a view", async () => {
    const res = await app.request(`/views/${viewId}/`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ name: "Updated View", description: "Updated desc" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.name).toBe("Updated View");
    expect(data.description).toBe("Updated desc");
  });

  test("PATCH views/:viewId/ non-owner gets 403", async () => {
    const res = await app.request(`/views/${viewId}/`, {
      method: "PATCH",
      headers: h(otherUserId),
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(res.status).toBe(403);
  });

  test("POST user-favorite-views/ favorites a view", async () => {
    const res = await app.request("/user-favorite-views/", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ view: viewId }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.view).toBe(viewId);
  });

  test("GET views/ shows is_favorite=true after favoriting", async () => {
    const res = await app.request("/views/", { headers: h() });
    const data = await res.json();
    expect(data[0].is_favorite).toBe(true);
  });

  test("POST user-favorite-views/ duplicate returns 400", async () => {
    const res = await app.request("/user-favorite-views/", {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ view: viewId }),
    });
    expect(res.status).toBe(400);
  });

  test("DELETE user-favorite-views/:viewId/ removes favorite", async () => {
    const res = await app.request(`/user-favorite-views/${viewId}/`, {
      method: "DELETE",
      headers: h(),
    });
    expect(res.status).toBe(204);
  });

  test("GET views/ shows is_favorite=false after unfavoriting", async () => {
    const res = await app.request("/views/", { headers: h() });
    const data = await res.json();
    expect(data[0].is_favorite).toBe(false);
  });

  test("PATCH locked view returns 400", async () => {
    // Lock the view
    await app.request(`/views/${viewId}/`, {
      method: "PATCH", headers: h(),
      body: JSON.stringify({ is_locked: true }),
    });
    // Try to update locked view
    const res = await app.request(`/views/${viewId}/`, {
      method: "PATCH", headers: h(),
      body: JSON.stringify({ name: "Should fail" }),
    });
    expect(res.status).toBe(400);
    // Unlock
    await app.request(`/views/${viewId}/`, {
      method: "PATCH", headers: h(),
      body: JSON.stringify({ is_locked: false }),
    });
  });

  test("DELETE views/:viewId/ deletes a view", async () => {
    const res = await app.request(`/views/${viewId}/`, {
      method: "DELETE", headers: h(),
    });
    expect(res.status).toBe(204);
  });

  test("GET views/ returns empty after delete", async () => {
    const res = await app.request("/views/", { headers: h() });
    const data = await res.json();
    expect(data.length).toBe(0);
  });

  test("GET views/:viewId/ returns 404 after delete", async () => {
    const res = await app.request(`/views/${viewId}/`, { headers: h() });
    expect(res.status).toBe(404);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request("/views/");
    expect(res.status).toBe(401);
  });
});

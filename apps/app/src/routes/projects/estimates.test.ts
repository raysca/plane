import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../../db";
import { users } from "../../db/schema/user";
import { workspaces, workspaceMembers } from "../../db/schema/workspace";
import { projects, projectMembers, estimates, estimatePoints } from "../../db/schema/project";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

type Variables = any;
const app = new Hono<{ Variables: Variables }>();

const userId = createId();
const workspaceId = createId();
const projectId = createId();

// Fake middleware
app.use("*", async (c, next) => {
  const uid = c.req.header("x-test-user");
  if (!uid) return c.json({ detail: "Auth required" }, 401);
  c.set("user", { id: uid, email: "test@test.com", name: "Test" });
  c.set("session", { id: "s", userId: uid, expiresAt: new Date() });
  c.set("workspace", { id: workspaceId, name: "Est WS", slug: "est-ws", ownerId: userId });
  c.set("workspaceMembership", { id: "wm", workspaceId, userId: uid, role: 20 });
  c.set("project", { id: projectId, workspaceId, name: "Est Project", identifier: "EST", estimateId: null });
  c.set("projectMembership", { id: "pm", projectId, memberId: uid, role: 20 });
  await next();
});

// Import route handlers inline (mirrors logic from projects/index.ts)
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { asc, inArray, isNull, desc } from "drizzle-orm";

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

const createEstimateSchema = z.object({
  estimate: z.object({
    name: z.string().max(255).optional(),
    type: z.enum(["categories", "points", "time"]).optional(),
    last_used: z.boolean().optional(),
  }).optional(),
  estimate_points: z.array(z.object({
    key: z.number().int().optional(),
    value: z.string().max(255).optional().default(""),
    description: z.string().optional().default(""),
  })).optional(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().optional(),
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

// POST /estimates/ - Create with bulk points
app.post("/api/projects/:projectId/estimates/", zValidator("json", createEstimateSchema), async (c) => {
  const project = c.get("project");
  const workspace = c.get("workspace");
  const user = c.get("user");

  const body = c.req.valid("json");
  const estimateData = body.estimate ?? {};
  const estimateName = estimateData.name ?? body.name ?? "default";
  const estimateType = estimateData.type ?? body.type ?? "categories";

  const result = await db.insert(estimates).values({
    projectId: project.id,
    workspaceId: workspace.id,
    name: estimateName,
    type: estimateType,
    createdById: user.id,
  }).returning();

  const estimate = result[0]!;
  const pointsData = body.estimate_points ?? [];
  let createdPoints: (typeof estimatePoints.$inferSelect)[] = [];
  if (pointsData.length > 0) {
    createdPoints = await db.insert(estimatePoints).values(
      pointsData.map((p) => ({
        estimateId: estimate.id,
        key: p.key ?? 0,
        value: p.value ?? "",
        description: p.description ?? "",
      }))
    ).returning();
  }

  return c.json(formatEstimate(estimate, createdPoints));
});

// GET /estimates/ - List
app.get("/api/projects/:projectId/estimates/", async (c) => {
  const project = c.get("project");
  const estimateList = await db.query.estimates.findMany({
    where: eq(estimates.projectId, project.id),
    orderBy: [desc(estimates.createdAt)],
  });
  const allPoints = await db.query.estimatePoints.findMany({
    where: inArray(estimatePoints.estimateId, estimateList.map((e) => e.id).length > 0 ? estimateList.map((e) => e.id) : [""]),
    orderBy: [asc(estimatePoints.key)],
  });
  const pointsByEstimate = new Map<string, (typeof estimatePoints.$inferSelect)[]>();
  for (const point of allPoints) {
    const existing = pointsByEstimate.get(point.estimateId) ?? [];
    existing.push(point);
    pointsByEstimate.set(point.estimateId, existing);
  }
  return c.json(estimateList.map((e) => formatEstimate(e, pointsByEstimate.get(e.id) ?? [])));
});

// GET /estimates/:estimateId/ - Retrieve
app.get("/api/projects/:projectId/estimates/:estimateId/", async (c) => {
  const project = c.get("project");
  const estimateId = c.req.param("estimateId");
  const estimate = await db.query.estimates.findFirst({
    where: and(eq(estimates.id, estimateId), eq(estimates.projectId, project.id)),
  });
  if (!estimate) return c.json({ detail: "Estimate not found." }, 404);
  const points = await db.query.estimatePoints.findMany({
    where: eq(estimatePoints.estimateId, estimateId),
    orderBy: [asc(estimatePoints.key)],
  });
  return c.json(formatEstimate(estimate, points));
});

// POST /estimate-points/ - Create point
app.post("/api/projects/:projectId/estimates/:estimateId/estimate-points/", zValidator("json", createEstimatePointSchema), async (c) => {
  const estimateId = c.req.param("estimateId");
  const body = c.req.valid("json");
  const result = await db.insert(estimatePoints).values({
    estimateId,
    key: body.key,
    value: body.value,
    description: body.description,
  }).returning();
  return c.json(formatEstimatePoint(result[0]!));
});

// PATCH /estimate-points/:pointId/ - Update point
app.patch("/api/projects/:projectId/estimates/:estimateId/estimate-points/:pointId/", zValidator("json", updateEstimatePointSchema), async (c) => {
  const pointId = c.req.param("pointId");
  const body = c.req.valid("json");
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (body.key !== undefined) updateData.key = body.key;
  if (body.value !== undefined) updateData.value = body.value;
  if (body.description !== undefined) updateData.description = body.description;
  await db.update(estimatePoints).set(updateData).where(eq(estimatePoints.id, pointId));
  const updated = await db.query.estimatePoints.findFirst({ where: eq(estimatePoints.id, pointId) });
  return c.json(formatEstimatePoint(updated!));
});

function h(uid: string = userId) {
  return { "x-test-user": uid, "Content-Type": "application/json" };
}

describe("Estimates Endpoints", () => {
  let estimateId: string;
  let pointId: string;

  beforeAll(async () => {
    await db.insert(users).values({ id: userId, email: "est-test@test.com", name: "Est Test", emailVerified: true });
    await db.insert(workspaces).values({ id: workspaceId, name: "Est WS", slug: "est-ws", ownerId: userId });
    await db.insert(workspaceMembers).values({ id: createId(), workspaceId, userId, role: 20 });
    await db.insert(projects).values({ id: projectId, workspaceId, name: "Est Project", identifier: "EST", createdById: userId });
    await db.insert(projectMembers).values({ id: createId(), projectId, memberId: userId, role: 20 });
  });

  afterAll(async () => {
    await db.delete(estimatePoints).where(eq(estimatePoints.estimateId, estimateId)).catch(() => {});
    await db.delete(estimates).where(eq(estimates.projectId, projectId));
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));
    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
  });

  test("create estimate with bulk points (Django format)", async () => {
    const res = await app.request(`/api/projects/${projectId}/estimates/`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({
        estimate: { name: "T-Shirt Sizes", type: "categories" },
        estimate_points: [
          { key: 0, value: "XS" },
          { key: 1, value: "S" },
          { key: 2, value: "M" },
          { key: 3, value: "L" },
          { key: 4, value: "XL" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.name).toBe("T-Shirt Sizes");
    expect(data.type).toBe("categories");
    expect(data.points.length).toBe(5);
    expect(data.points[0].value).toBe("XS");
    expect(data.points[4].value).toBe("XL");

    estimateId = data.id;
  });

  test("list estimates with points", async () => {
    const res = await app.request(`/api/projects/${projectId}/estimates/`, { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.length).toBeGreaterThanOrEqual(1);
    const est = data.find((e: any) => e.id === estimateId);
    expect(est).toBeTruthy();
    expect(est.points.length).toBe(5);
  });

  test("retrieve single estimate", async () => {
    const res = await app.request(`/api/projects/${projectId}/estimates/${estimateId}/`, { headers: h() });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe(estimateId);
    expect(data.name).toBe("T-Shirt Sizes");
    expect(data.points.length).toBe(5);
  });

  test("create estimate point via /estimate-points/", async () => {
    const res = await app.request(`/api/projects/${projectId}/estimates/${estimateId}/estimate-points/`, {
      method: "POST",
      headers: h(),
      body: JSON.stringify({ key: 5, value: "XXL" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.value).toBe("XXL");
    expect(data.key).toBe(5);
    expect(data.estimate_id).toBe(estimateId);

    pointId = data.id;
  });

  test("update estimate point via /estimate-points/", async () => {
    const res = await app.request(`/api/projects/${projectId}/estimates/${estimateId}/estimate-points/${pointId}/`, {
      method: "PATCH",
      headers: h(),
      body: JSON.stringify({ value: "2XL" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.value).toBe("2XL");
    expect(data.key).toBe(5);
  });

  test("retrieve returns 404 for non-existent estimate", async () => {
    const res = await app.request(`/api/projects/${projectId}/estimates/nonexistent/`, { headers: h() });
    expect(res.status).toBe(404);
  });

  test("returns 401 without auth", async () => {
    const res = await app.request(`/api/projects/${projectId}/estimates/`);
    expect(res.status).toBe(401);
  });
});

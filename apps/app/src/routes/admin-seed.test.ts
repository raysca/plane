import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { db } from "../db";
import { users, instanceAdmins, instances } from "../db/schema";
import { workspaces, workspaceMembers } from "../db/schema/workspace";
import { projects, projectMembers, states, labels } from "../db/schema/project";
import { cycles, cycleIssues } from "../db/schema/cycle";
import { modules, moduleIssues } from "../db/schema/module";
import { issues } from "../db/schema/issue";
import { views } from "../db/schema/view";
import { pages } from "../db/schema/page";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { seedWorkspace } from "../lib/workspace-seeder";

// Test the seed endpoint via the instance routes
import { instanceRoutes } from "./instances";

type Variables = {
  user: { id: string; email: string; name: string | null } | null;
  session: { id: string; userId: string; expiresAt: Date } | null;
};

// Build a test app with auth simulation
function createTestApp(userId?: string) {
  const app = new Hono<{ Variables: Variables }>();

  // Simulate auth middleware
  app.use("*", async (c, next) => {
    if (userId) {
      c.set("user", { id: userId, email: "admin@test.com", name: "Admin" } as any);
      c.set("session", { id: "test-session", userId, expiresAt: new Date(Date.now() + 86400000) } as any);
    }
    await next();
  });

  app.route("/api/instances/", instanceRoutes);
  return app;
}

describe("Admin Seed Endpoint", () => {
  let adminUserId: string;
  let nonAdminUserId: string;
  let workspaceId: string;
  let instanceId: string;

  beforeAll(async () => {
    // Create admin user
    adminUserId = createId();
    await db.insert(users).values({
      id: adminUserId,
      email: "seed-admin@test.com",
      name: "Seed Admin",
      emailVerified: true,
    });

    // Create instance
    instanceId = createId();
    await db.insert(instances).values({
      id: instanceId,
    });

    // Make them an instance admin
    await db.insert(instanceAdmins).values({
      id: createId(),
      instanceId: instanceId,
      userId: adminUserId,
      role: 20,
    });

    // Create non-admin user
    nonAdminUserId = createId();
    await db.insert(users).values({
      id: nonAdminUserId,
      email: "seed-nonadmin@test.com",
      name: "Non Admin",
      emailVerified: true,
    });

    // Create workspace
    workspaceId = createId();
    await db.insert(workspaces).values({
      id: workspaceId,
      name: "Seed Test Workspace",
      slug: "seed-test-workspace",
      ownerId: adminUserId,
    });

    await db.insert(workspaceMembers).values({
      id: createId(),
      workspaceId,
      userId: adminUserId,
      role: 20,
    });
  });

  afterAll(async () => {
    // Clean up seeded data first (cascade will handle most)
    const seededProjects = await db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
    for (const p of seededProjects) {
      await db.delete(projects).where(eq(projects.id, p.id));
    }

    await db.delete(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(instanceAdmins).where(eq(instanceAdmins.userId, adminUserId));
    await db.delete(instances).where(eq(instances.id, instanceId));
    await db.delete(users).where(eq(users.id, adminUserId));
    await db.delete(users).where(eq(users.id, nonAdminUserId));
  });

  test("returns 401 without authentication", async () => {
    const app = createTestApp(); // no user
    const res = await app.request("/api/instances/seed/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-admin user", async () => {
    const app = createTestApp(nonAdminUserId);
    const res = await app.request("/api/instances/seed/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    expect(res.status).toBe(403);
  });

  test("returns 400 without workspace_id", async () => {
    const app = createTestApp(adminUserId);
    const res = await app.request("/api/instances/seed/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.detail).toBe("workspace_id is required");
  });

  test("seeds workspace with sample data", async () => {
    const app = createTestApp(adminUserId);
    const res = await app.request("/api/instances/seed/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("success");

    // Verify projects were created
    const seededProjects = await db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
    expect(seededProjects.length).toBeGreaterThanOrEqual(1);

    const projectId = seededProjects[0].id;

    // Verify states
    const seededStates = await db.select().from(states).where(eq(states.projectId, projectId));
    expect(seededStates.length).toBe(5);

    // Verify labels
    const seededLabels = await db.select().from(labels).where(eq(labels.projectId, projectId));
    expect(seededLabels.length).toBe(5);

    // Verify cycles
    const seededCycles = await db.select().from(cycles).where(eq(cycles.projectId, projectId));
    expect(seededCycles.length).toBe(2);

    // Verify modules
    const seededModules = await db.select().from(modules).where(eq(modules.projectId, projectId));
    expect(seededModules.length).toBe(2);

    // Verify issues
    const seededIssues = await db.select().from(issues).where(eq(issues.projectId, projectId));
    expect(seededIssues.length).toBe(10);

    // Verify views
    const seededViews = await db.select().from(views).where(eq(views.projectId, projectId));
    expect(seededViews.length).toBe(2);

    // Verify pages
    const seededPages = await db.select().from(pages).where(eq(pages.workspaceId, workspaceId));
    expect(seededPages.length).toBeGreaterThanOrEqual(2);

    // Verify project member was added
    const seededMembers = await db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId));
    expect(seededMembers.length).toBeGreaterThanOrEqual(1);
    expect(seededMembers[0].memberId).toBe(adminUserId);
  });

  test("returns 404 for non-existent workspace", async () => {
    const app = createTestApp(adminUserId);
    const res = await app.request("/api/instances/seed/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: "non-existent-id" }),
    });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.detail).toBe("Workspace not found");
  });
});

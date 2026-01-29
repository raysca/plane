import { describe, test, expect, beforeAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as schema from "../../db/schema";
import {
  users,
  sessions,
} from "../../db/schema/user";
import {
  workspaces,
  workspaceMembers,
  workspaceInvitations,
} from "../../db/schema/workspace";
import type { Variables } from "../../app";

// --- In-memory test database ---

const sqlite = new BunSQLite(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(sqlite, { schema });

// --- Test users ---

const adminUser = {
  id: createId(),
  email: "admin@test.com",
  name: "Admin User",
  firstName: "Admin",
  lastName: "User",
  isActive: true,
};

const memberUser = {
  id: createId(),
  email: "member@test.com",
  name: "Member User",
  firstName: "Member",
  lastName: "User",
  isActive: true,
};

const invitedUser = {
  id: createId(),
  email: "invited@test.com",
  name: "Invited User",
  firstName: "Invited",
  lastName: "User",
  isActive: true,
};

const outsideUser = {
  id: createId(),
  email: "outside@test.com",
  name: "Outside User",
  firstName: "Outside",
  lastName: "User",
  isActive: true,
};

const testWorkspace = {
  id: createId(),
  name: "Test Workspace",
  slug: "test-ws",
  ownerId: adminUser.id,
};

// --- Build a test app that mirrors the real routes but uses the test DB and skips Better Auth ---

function buildTestApp() {
  const app = new Hono<{ Variables: Variables }>();

  // Fake auth middleware: reads X-Test-User-Id header to set user context
  app.use("*", async (c, next) => {
    const userId = c.req.header("X-Test-User-Id");
    if (!userId) {
      return c.json({ detail: "Authentication credentials were not provided." }, 401);
    }

    // Join users with profiles
    const user = await testDb.select({
      user: users,
      profile: schema.userProfiles,
    })
      .from(users)
      .leftJoin(schema.userProfiles, eq(users.id, schema.userProfiles.userId))
      .where(eq(users.id, userId))
      .get();

    if (!user) {
      return c.json({ detail: "Authentication credentials were not provided." }, 401);
    }

    c.set("user", {
      id: user.user.id,
      email: user.user.email,
      name: user.user.name,
      username: user.user.username || null,
      displayName: user.user.displayName || null,
      avatar: user.user.avatar || null,
      isOnboarded: user.profile?.isOnboarded || false,
      isActive: user.user.isActive ?? true,
      createdAt: user.user.createdAt ?? new Date(),
      updatedAt: user.user.updatedAt ?? new Date(),
    });
    c.set("session", { id: "test-session", userId: user.user.id, expiresAt: new Date(Date.now() + 86400000) });
    await next();
  });

  // --- Validation schemas (copied from routes to keep tests self-contained) ---
  const createInvitationSchema = z.object({
    emails: z.array(z.object({
      email: z.string().email(),
      role: z.number().int().refine((v) => [5, 10, 15, 20].includes(v)),
    })).min(1),
    message: z.string().max(500).optional(),
  });

  const updateInvitationSchema = z.object({
    role: z.number().int().refine((v) => [5, 10, 15, 20].includes(v)).optional(),
  });

  const joinInvitationSchema = z.object({
    email: z.string().email(),
    accepted: z.boolean().default(false),
  });

  // --- Helpers ---
  const { desc, asc, inArray } = require("drizzle-orm");

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

  function formatMember(m: typeof workspaceMembers.$inferSelect, user: typeof schema.users.$inferSelect) {
    return {
      id: m.id,
      member: { id: user.id, email: user.email, first_name: user.firstName ?? "", last_name: user.lastName ?? "" },
      role: m.role,
      is_active: m.isActive ?? true,
    };
  }

  // Workspace middleware
  const workspaceMiddleware = async (c: any, next: any) => {
    const slug = c.req.param("slug");
    const user = c.get("user");
    if (!user) return c.json({ detail: "Authentication credentials were not provided." }, 401);

    const workspace = await testDb.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const membership = await testDb.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, user.id)),
    });
    if (!membership) return c.json({ detail: "You are not a member of this workspace." }, 403);
    if (!membership.isActive) return c.json({ detail: "Your workspace membership is inactive." }, 403);

    c.set("workspace", workspace);
    c.set("workspaceMembership", membership);
    await next();
  };

  const requireAdmin = async (c: any, next: any) => {
    const membership = c.get("workspaceMembership");
    if (!membership || membership.role < 20) {
      return c.json({ detail: "You do not have permission to perform this action." }, 403);
    }
    await next();
  };

  // ============ Join routes (before workspace middleware) ============

  // GET /ws/:slug/invitations/:id/join/
  app.get("/api/workspaces/:slug/invitations/:id/join/", async (c) => {
    const slug = c.req.param("slug");
    const invitationId = c.req.param("id");

    const workspace = await testDb.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const invitation = await testDb.query.workspaceInvitations.findFirst({
      where: and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.workspaceId, workspace.id)),
    });
    if (!invitation) return c.json({ detail: "Invitation not found." }, 404);

    return c.json({
      ...formatInvitation(invitation),
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, logo: (workspace as any).logo ?? "" },
    });
  });

  // POST /ws/:slug/invitations/:id/join/
  app.post("/api/workspaces/:slug/invitations/:id/join/", zValidator("json", joinInvitationSchema), async (c) => {
    const slug = c.req.param("slug");
    const invitationId = c.req.param("id");
    const body = c.req.valid("json");

    const workspace = await testDb.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    const invitation = await testDb.query.workspaceInvitations.findFirst({
      where: and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.workspaceId, workspace.id)),
    });
    if (!invitation) return c.json({ detail: "Invitation not found." }, 404);

    if (!body.email || invitation.email !== body.email) {
      return c.json({ error: "You do not have permission to join the workspace" }, 403);
    }
    if (invitation.respondedAt) {
      return c.json({ error: "You have already responded to the invitation request" }, 400);
    }

    await testDb.update(workspaceInvitations).set({
      accepted: body.accepted,
      respondedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(workspaceInvitations.id, invitationId));

    if (body.accepted) {
      const invitedU = await testDb.query.users.findFirst({ where: eq(users.email, body.email) });
      if (invitedU) {
        const existing = await testDb.query.workspaceMembers.findFirst({
          where: and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, invitedU.id)),
        });
        if (existing) {
          await testDb.update(workspaceMembers).set({ isActive: true, role: invitation.role, updatedAt: new Date() }).where(eq(workspaceMembers.id, existing.id));
        } else {
          await testDb.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: invitedU.id, role: invitation.role });
        }
        await testDb.delete(workspaceInvitations).where(eq(workspaceInvitations.id, invitationId));
      }
      return c.json({ message: "Workspace Invitation Accepted" });
    }
    return c.json({ message: "Workspace Invitation was not accepted" });
  });

  // ============ Workspace-scoped routes (require membership) ============

  // Apply workspace middleware
  app.use("/api/workspaces/:slug/invitations/*", workspaceMiddleware);
  app.use("/api/workspaces/:slug/invitations", workspaceMiddleware);

  // GET /ws/:slug/invitations/
  app.get("/api/workspaces/:slug/invitations/", requireAdmin, async (c) => {
    const workspace = c.get("workspace")!;
    const invitations = await testDb.query.workspaceInvitations.findMany({
      where: eq(workspaceInvitations.workspaceId, workspace.id),
      orderBy: [desc(workspaceInvitations.createdAt)],
    });
    return c.json(invitations.map(formatInvitation));
  });

  // POST /ws/:slug/invitations/
  app.post("/api/workspaces/:slug/invitations/", requireAdmin, zValidator("json", createInvitationSchema), async (c) => {
    const workspace = c.get("workspace")!;
    const user = c.get("user")!;
    const membership = c.get("workspaceMembership")!;
    const body = c.req.valid("json");

    const higherRoleInvites = body.emails.filter((e) => e.role > membership.role);
    if (higherRoleInvites.length > 0) {
      return c.json({ error: "You cannot invite a user with higher role" }, 400);
    }

    const emailList = body.emails.map((e) => e.email.trim().toLowerCase());
    const existingMembers = await testDb
      .select({ user: users, membership: workspaceMembers })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(and(
        eq(workspaceMembers.workspaceId, workspace.id),
        inArray(users.email, emailList),
        eq(workspaceMembers.isActive, true)
      ));

    if (existingMembers.length > 0) {
      return c.json({
        error: "Some users are already member of workspace",
        workspace_users: existingMembers.map((m: any) => formatMember(m.membership, m.user)),
      }, 400);
    }

    const created = [];
    for (const invite of body.emails) {
      const normalizedEmail = invite.email.trim().toLowerCase();
      const existingInvite = await testDb.query.workspaceInvitations.findFirst({
        where: and(eq(workspaceInvitations.workspaceId, workspace.id), eq(workspaceInvitations.email, normalizedEmail)),
      });
      if (existingInvite && !existingInvite.respondedAt) continue;

      const invResult = await testDb.insert(workspaceInvitations).values({
        workspaceId: workspace.id,
        email: normalizedEmail,
        role: invite.role,
        token: crypto.randomUUID(),
        message: body.message,
        createdById: user.id,
      }).returning();
      created.push(formatInvitation(invResult[0]!));
    }
    return c.json(created, 201);
  });

  // PATCH /ws/:slug/invitations/:id/
  app.patch("/api/workspaces/:slug/invitations/:id/", requireAdmin, zValidator("json", updateInvitationSchema), async (c) => {
    const workspace = c.get("workspace")!;
    const invitationId = c.req.param("id");
    const body = c.req.valid("json");

    const invitation = await testDb.query.workspaceInvitations.findFirst({
      where: and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.workspaceId, workspace.id)),
    });
    if (!invitation) return c.json({ detail: "Invitation not found." }, 404);
    if (invitation.accepted || invitation.respondedAt) {
      return c.json({ detail: "Cannot update an invitation that has already been responded to." }, 400);
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.role !== undefined) updateData.role = body.role;

    await testDb.update(workspaceInvitations).set(updateData).where(eq(workspaceInvitations.id, invitationId));
    const updated = await testDb.query.workspaceInvitations.findFirst({ where: eq(workspaceInvitations.id, invitationId) });
    return c.json(formatInvitation(updated!));
  });

  // DELETE /ws/:slug/invitations/:id/
  app.delete("/api/workspaces/:slug/invitations/:id/", requireAdmin, async (c) => {
    const workspace = c.get("workspace")!;
    const invitationId = c.req.param("id");

    const invitation = await testDb.query.workspaceInvitations.findFirst({
      where: and(eq(workspaceInvitations.id, invitationId), eq(workspaceInvitations.workspaceId, workspace.id)),
    });
    if (!invitation) return c.json({ detail: "Invitation not found." }, 404);

    await testDb.delete(workspaceInvitations).where(eq(workspaceInvitations.id, invitationId));
    return new Response(null, { status: 204 });
  });

  // ============ User invitation routes ============

  // GET /api/users/me/workspaces/invitations/
  app.get("/api/users/me/workspaces/invitations/", async (c) => {
    const user = c.get("user")!;
    const dbUser = await testDb.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!dbUser) return c.json({ detail: "User not found." }, 404);

    const invitations = await testDb
      .select({ invitation: workspaceInvitations, workspace: workspaces })
      .from(workspaceInvitations)
      .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
      .where(eq(workspaceInvitations.email, dbUser.email))
      .orderBy(desc(workspaceInvitations.createdAt));

    return c.json(invitations.map((row) => ({
      ...formatInvitation(row.invitation),
      workspace: { id: row.workspace.id, name: row.workspace.name, slug: row.workspace.slug, logo: (row.workspace as any).logo ?? "" },
    })));
  });

  // POST /api/users/me/workspaces/invitations/
  app.post("/api/users/me/workspaces/invitations/", zValidator("json", z.object({ invitations: z.array(z.string()).min(1) })), async (c) => {
    const user = c.get("user")!;
    const dbUser = await testDb.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!dbUser) return c.json({ detail: "User not found." }, 404);

    const { invitations: invitationIds } = c.req.valid("json");

    const matching = await testDb
      .select({ invitation: workspaceInvitations, workspace: workspaces })
      .from(workspaceInvitations)
      .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
      .where(and(inArray(workspaceInvitations.id, invitationIds), eq(workspaceInvitations.email, dbUser.email)))
      .orderBy(desc(workspaceInvitations.createdAt));

    for (const row of matching) {
      const inv = row.invitation;
      const existing = await testDb.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, inv.workspaceId), eq(workspaceMembers.userId, user.id)),
      });
      if (existing) {
        await testDb.update(workspaceMembers).set({ isActive: true, role: inv.role, updatedAt: new Date() }).where(eq(workspaceMembers.id, existing.id));
      } else {
        await testDb.insert(workspaceMembers).values({ workspaceId: inv.workspaceId, userId: user.id, role: inv.role });
      }
    }

    if (matching.length > 0) {
      const idsToDelete = matching.map((r) => r.invitation.id);
      await testDb.delete(workspaceInvitations).where(inArray(workspaceInvitations.id, idsToDelete));
    }

    return new Response(null, { status: 204 });
  });

  return app;
}

// --- Test helpers ---

function makeRequest(app: Hono<{ Variables: Variables }>, method: string, path: string, userId?: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (userId) headers["X-Test-User-Id"] = userId;
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return app.request(`http://localhost${path}`, opts);
}

// --- Setup ---

let app: ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  // Create tables in the in-memory database
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER DEFAULT 0,
      name TEXT,
      image TEXT,
      username TEXT UNIQUE,
      display_name TEXT,
      avatar TEXT,
      cover_image TEXT,
      first_name TEXT,
      last_name TEXT,
      is_active INTEGER DEFAULT 1,
      is_password_autoset INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_onboarded INTEGER DEFAULT 0,
      is_tour_completed INTEGER DEFAULT 0,
      onboarding_step TEXT DEFAULT '{}',
      role TEXT,
      use_case TEXT,
      billing_address TEXT,
      billing_address_country TEXT,
      company_name TEXT,
      has_marketing_email_consent INTEGER DEFAULT 0,
      theme TEXT DEFAULT '{}',
      language TEXT DEFAULT 'en',
      timezone TEXT DEFAULT 'UTC',
      date_format TEXT DEFAULT 'MM/DD/YYYY',
      time_format TEXT DEFAULT '12h',
      last_workspace_id TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id),
      organization_size TEXT,
      timezone TEXT DEFAULT 'UTC',
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role INTEGER NOT NULL DEFAULT 15,
      company_role TEXT,
      is_active INTEGER DEFAULT 1,
      view_props TEXT,
      default_props TEXT,
      issue_props TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(workspace_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS workspace_invitations (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role INTEGER NOT NULL DEFAULT 15,
      token TEXT NOT NULL UNIQUE,
      message TEXT,
      responded_at INTEGER,
      accepted INTEGER,
      created_by_id TEXT REFERENCES users(id),
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  // Seed test data
  const now = Date.now();
  for (const u of [adminUser, memberUser, invitedUser, outsideUser]) {
    await testDb.insert(users).values({ ...u, createdAt: new Date(now), updatedAt: new Date(now) });
    await testDb.insert(schema.userProfiles).values({
      id: createId(),
      userId: u.id,
      isOnboarded: true,
      onboardingStep: { profile_complete: true, workspace_create: true, workspace_invite: true, workspace_join: true },
      createdAt: new Date(now),
      updatedAt: new Date(now)
    });
  }

  await testDb.insert(workspaces).values({ ...testWorkspace, createdAt: new Date(now), updatedAt: new Date(now) });

  // Admin membership (role=20)
  await testDb.insert(workspaceMembers).values({
    id: createId(), workspaceId: testWorkspace.id, userId: adminUser.id, role: 20,
    createdAt: new Date(now), updatedAt: new Date(now),
  });

  // Member membership (role=15)
  await testDb.insert(workspaceMembers).values({
    id: createId(), workspaceId: testWorkspace.id, userId: memberUser.id, role: 15,
    createdAt: new Date(now), updatedAt: new Date(now),
  });

  app = buildTestApp();
});

// --- Tests ---

describe("Workspace Invitations", () => {
  let createdInvitationId: string;

  describe("POST /api/workspaces/:slug/invitations/ - Create invitations", () => {
    test("admin can create invitation", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [{ email: "newuser@test.com", role: 15 }],
      });
      expect(res.status).toBe(201);
      const data = await res.json() as any[];
      expect(data.length).toBe(1);
      expect(data[0].email).toBe("newuser@test.com");
      expect(data[0].role).toBe(15);
      expect(data[0].id).toBeDefined();
      createdInvitationId = data[0].id;
    });

    test("admin can create multiple invitations", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [
          { email: "batch1@test.com", role: 15 },
          { email: "batch2@test.com", role: 5 },
        ],
      });
      expect(res.status).toBe(201);
      const data = await res.json() as any[];
      expect(data.length).toBe(2);
    });

    test("admin can invite with admin role", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [{ email: "admin-invite@test.com", role: 20 }],
      });
      expect(res.status).toBe(201);
    });

    test("member cannot create invitations (requires admin)", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, memberUser.id, {
        emails: [{ email: "another@test.com", role: 5 }],
      });
      expect(res.status).toBe(403);
    });

    test("rejects if email is already a workspace member", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [{ email: adminUser.email, role: 15 }],
      });
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("already member");
    });

    test("skips duplicate pending invitations", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [{ email: "newuser@test.com", role: 15 }],
      });
      expect(res.status).toBe(201);
      const data = await res.json() as any[];
      expect(data.length).toBe(0);
    });

    test("rejects invalid email format", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [{ email: "not-an-email", role: 15 }],
      });
      expect(res.status).toBe(400);
    });

    test("rejects invalid role value", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [{ email: "valid@test.com", role: 99 }],
      });
      expect(res.status).toBe(400);
    });

    test("rejects empty emails array", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [],
      });
      expect(res.status).toBe(400);
    });

    test("non-member cannot create invitations", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, outsideUser.id, {
        emails: [{ email: "someone@test.com", role: 15 }],
      });
      expect(res.status).toBe(403);
    });

    test("unauthenticated request returns 401", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, undefined, {
        emails: [{ email: "someone@test.com", role: 15 }],
      });
      expect(res.status).toBe(401);
    });

    test("normalizes email to lowercase", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [{ email: "CaseTest@Test.COM", role: 15 }],
      });
      expect(res.status).toBe(201);
      const data = await res.json() as any[];
      expect(data.length).toBe(1);
      expect(data[0].email).toBe("casetest@test.com");
    });

    test("includes message in invitation", async () => {
      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id, {
        emails: [{ email: "withmsg@test.com", role: 15 }],
        message: "Welcome aboard!",
      });
      expect(res.status).toBe(201);
      const data = await res.json() as any[];
      expect(data[0].message).toBe("Welcome aboard!");
    });
  });

  describe("GET /api/workspaces/:slug/invitations/ - List invitations", () => {
    test("admin can list invitations", async () => {
      const res = await makeRequest(app, "GET", `/api/workspaces/${testWorkspace.slug}/invitations/`, adminUser.id);
      expect(res.status).toBe(200);
      const data = await res.json() as any[];
      expect(data.length).toBeGreaterThanOrEqual(1);
      const inv = data.find((i: any) => i.email === "newuser@test.com");
      expect(inv).toBeDefined();
      expect(inv.role).toBe(15);
    });

    test("member cannot list invitations", async () => {
      const res = await makeRequest(app, "GET", `/api/workspaces/${testWorkspace.slug}/invitations/`, memberUser.id);
      expect(res.status).toBe(403);
    });

    test("non-member cannot list invitations", async () => {
      const res = await makeRequest(app, "GET", `/api/workspaces/${testWorkspace.slug}/invitations/`, outsideUser.id);
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/workspaces/:slug/invitations/:id/ - Update invitation", () => {
    test("admin can update invitation role", async () => {
      const res = await makeRequest(app, "PATCH", `/api/workspaces/${testWorkspace.slug}/invitations/${createdInvitationId}/`, adminUser.id, { role: 5 });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.role).toBe(5);
    });

    test("member cannot update invitation", async () => {
      const res = await makeRequest(app, "PATCH", `/api/workspaces/${testWorkspace.slug}/invitations/${createdInvitationId}/`, memberUser.id, { role: 15 });
      expect(res.status).toBe(403);
    });

    test("returns 404 for non-existent invitation", async () => {
      const res = await makeRequest(app, "PATCH", `/api/workspaces/${testWorkspace.slug}/invitations/nonexistent/`, adminUser.id, { role: 15 });
      expect(res.status).toBe(404);
    });

    test("rejects update on already responded invitation", async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: "responded@test.com",
        role: 15, token: crypto.randomUUID(), respondedAt: new Date(), accepted: true,
      }).returning();

      const res = await makeRequest(app, "PATCH", `/api/workspaces/${testWorkspace.slug}/invitations/${inv[0]!.id}/`, adminUser.id, { role: 5 });
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.detail).toContain("already been responded");
    });
  });

  describe("DELETE /api/workspaces/:slug/invitations/:id/ - Delete invitation", () => {
    test("admin can delete invitation", async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: `del-${Date.now()}@test.com`,
        role: 15, token: crypto.randomUUID(),
      }).returning();

      const res = await makeRequest(app, "DELETE", `/api/workspaces/${testWorkspace.slug}/invitations/${inv[0]!.id}/`, adminUser.id);
      expect(res.status).toBe(204);

      const deleted = await testDb.query.workspaceInvitations.findFirst({ where: eq(workspaceInvitations.id, inv[0]!.id) });
      expect(deleted).toBeUndefined();
    });

    test("member cannot delete invitation", async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: `del2-${Date.now()}@test.com`,
        role: 15, token: crypto.randomUUID(),
      }).returning();

      const res = await makeRequest(app, "DELETE", `/api/workspaces/${testWorkspace.slug}/invitations/${inv[0]!.id}/`, memberUser.id);
      expect(res.status).toBe(403);
    });

    test("returns 404 for non-existent invitation", async () => {
      const res = await makeRequest(app, "DELETE", `/api/workspaces/${testWorkspace.slug}/invitations/nonexistent/`, adminUser.id);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/workspaces/:slug/invitations/:id/join/ - Get invitation details", () => {
    let joinInvId: string;

    beforeAll(async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: invitedUser.email,
        role: 15, token: crypto.randomUUID(),
      }).returning();
      joinInvId = inv[0]!.id;
    });

    test("returns invitation details with workspace info", async () => {
      const res = await makeRequest(app, "GET", `/api/workspaces/${testWorkspace.slug}/invitations/${joinInvId}/join/`, invitedUser.id);
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.id).toBe(joinInvId);
      expect(data.email).toBe(invitedUser.email);
      expect(data.workspace).toBeDefined();
      expect(data.workspace.slug).toBe(testWorkspace.slug);
      expect(data.workspace.name).toBe(testWorkspace.name);
    });

    test("returns 404 for non-existent invitation", async () => {
      const res = await makeRequest(app, "GET", `/api/workspaces/${testWorkspace.slug}/invitations/nonexistent/join/`, invitedUser.id);
      expect(res.status).toBe(404);
    });

    test("returns 404 for wrong workspace slug", async () => {
      const res = await makeRequest(app, "GET", `/api/workspaces/wrong-slug/invitations/${joinInvId}/join/`, invitedUser.id);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/workspaces/:slug/invitations/:id/join/ - Accept/reject invitation", () => {
    test("user can accept invitation with matching email", async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: invitedUser.email,
        role: 15, token: crypto.randomUUID(),
      }).returning();

      // Remove any existing membership for invited user
      await testDb.delete(workspaceMembers).where(
        and(eq(workspaceMembers.workspaceId, testWorkspace.id), eq(workspaceMembers.userId, invitedUser.id))
      );

      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/${inv[0]!.id}/join/`, invitedUser.id, {
        email: invitedUser.email, accepted: true,
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.message).toContain("Accepted");

      // Verify membership was created
      const membership = await testDb.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, testWorkspace.id), eq(workspaceMembers.userId, invitedUser.id)),
      });
      expect(membership).toBeDefined();
      expect(membership!.role).toBe(15);

      // Verify invitation was deleted
      const deleted = await testDb.query.workspaceInvitations.findFirst({ where: eq(workspaceInvitations.id, inv[0]!.id) });
      expect(deleted).toBeUndefined();
    });

    test("user can reject invitation", async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: outsideUser.email,
        role: 5, token: crypto.randomUUID(),
      }).returning();

      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/${inv[0]!.id}/join/`, outsideUser.id, {
        email: outsideUser.email, accepted: false,
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.message).toContain("not accepted");
    });

    test("rejects if email does not match", async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: invitedUser.email,
        role: 15, token: crypto.randomUUID(),
      }).returning();

      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/${inv[0]!.id}/join/`, invitedUser.id, {
        email: "wrong@test.com", accepted: true,
      });
      expect(res.status).toBe(403);
    });

    test("rejects if already responded", async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: invitedUser.email,
        role: 15, token: crypto.randomUUID(), respondedAt: new Date(), accepted: false,
      }).returning();

      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/${inv[0]!.id}/join/`, invitedUser.id, {
        email: invitedUser.email, accepted: true,
      });
      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("already responded");
    });

    test("reactivates deactivated member on accept", async () => {
      // Clean up and create deactivated membership
      await testDb.delete(workspaceMembers).where(
        and(eq(workspaceMembers.workspaceId, testWorkspace.id), eq(workspaceMembers.userId, invitedUser.id))
      );
      await testDb.insert(workspaceMembers).values({
        id: createId(), workspaceId: testWorkspace.id, userId: invitedUser.id, role: 5, isActive: false,
      });

      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: invitedUser.email,
        role: 20, token: crypto.randomUUID(),
      }).returning();

      const res = await makeRequest(app, "POST", `/api/workspaces/${testWorkspace.slug}/invitations/${inv[0]!.id}/join/`, invitedUser.id, {
        email: invitedUser.email, accepted: true,
      });
      expect(res.status).toBe(200);

      const membership = await testDb.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, testWorkspace.id), eq(workspaceMembers.userId, invitedUser.id)),
      });
      expect(membership).toBeDefined();
      expect(membership!.isActive).toBe(true);
      expect(membership!.role).toBe(20);
    });
  });
});

describe("User Workspace Invitations", () => {
  let userInvIds: string[] = [];

  beforeAll(async () => {
    // Clean up outsideUser memberships (may have been created by join tests)
    await testDb.delete(workspaceMembers).where(eq(workspaceMembers.userId, outsideUser.id));

    // Create a second workspace
    const ws2Id = createId();
    try {
      await testDb.insert(workspaces).values({ id: ws2Id, name: "Second Workspace", slug: "second-ws", ownerId: adminUser.id });
      await testDb.insert(workspaceMembers).values({ id: createId(), workspaceId: ws2Id, userId: adminUser.id, role: 20 });
    } catch { /* may already exist */ }

    // Create invitations for outsideUser
    const inv1 = await testDb.insert(workspaceInvitations).values({
      id: createId(), workspaceId: testWorkspace.id, email: outsideUser.email, role: 15, token: crypto.randomUUID(),
    }).returning();
    const inv2 = await testDb.insert(workspaceInvitations).values({
      id: createId(), workspaceId: ws2Id, email: outsideUser.email, role: 5, token: crypto.randomUUID(),
    }).returning();

    userInvIds = [inv1[0]!.id, inv2[0]!.id];
  });

  describe("GET /api/users/me/workspaces/invitations/", () => {
    test("returns pending invitations for current user", async () => {
      const res = await makeRequest(app, "GET", "/api/users/me/workspaces/invitations/", outsideUser.id);
      expect(res.status).toBe(200);
      const data = await res.json() as any[];
      expect(data.length).toBeGreaterThanOrEqual(2);
      for (const inv of data) {
        expect(inv.email).toBe(outsideUser.email);
        expect(inv.workspace).toBeDefined();
        expect(inv.workspace.slug).toBeDefined();
      }
    });

    test("returns empty for user with no invitations", async () => {
      const res = await makeRequest(app, "GET", "/api/users/me/workspaces/invitations/", adminUser.id);
      expect(res.status).toBe(200);
      const data = await res.json() as any[];
      // Admin shouldn't have invitations to themselves
      const adminInvs = data.filter((i: any) => i.email === adminUser.email);
      expect(adminInvs.length).toBe(0);
    });

    test("requires authentication", async () => {
      const res = await makeRequest(app, "GET", "/api/users/me/workspaces/invitations/");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/users/me/workspaces/invitations/", () => {
    test("user can accept multiple invitations at once", async () => {
      const res = await makeRequest(app, "POST", "/api/users/me/workspaces/invitations/", outsideUser.id, {
        invitations: userInvIds,
      });
      expect(res.status).toBe(204);

      // Verify memberships were created
      const memberships = await testDb.select().from(workspaceMembers).where(eq(workspaceMembers.userId, outsideUser.id));
      expect(memberships.length).toBeGreaterThanOrEqual(2);

      // Verify invitations were deleted
      for (const id of userInvIds) {
        const inv = await testDb.query.workspaceInvitations.findFirst({ where: eq(workspaceInvitations.id, id) });
        expect(inv).toBeUndefined();
      }
    });

    test("reactivates deactivated membership on bulk accept", async () => {
      // Set outsideUser's membership in testWorkspace to inactive
      await testDb.update(workspaceMembers).set({ isActive: false, role: 5 }).where(
        and(eq(workspaceMembers.workspaceId, testWorkspace.id), eq(workspaceMembers.userId, outsideUser.id))
      );

      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: outsideUser.email, role: 20, token: crypto.randomUUID(),
      }).returning();

      const res = await makeRequest(app, "POST", "/api/users/me/workspaces/invitations/", outsideUser.id, {
        invitations: [inv[0]!.id],
      });
      expect(res.status).toBe(204);

      const membership = await testDb.query.workspaceMembers.findFirst({
        where: and(eq(workspaceMembers.workspaceId, testWorkspace.id), eq(workspaceMembers.userId, outsideUser.id)),
      });
      expect(membership!.isActive).toBe(true);
      expect(membership!.role).toBe(20);
    });

    test("ignores invitations for other users' emails", async () => {
      const inv = await testDb.insert(workspaceInvitations).values({
        id: createId(), workspaceId: testWorkspace.id, email: "someone-else@test.com", role: 15, token: crypto.randomUUID(),
      }).returning();

      const res = await makeRequest(app, "POST", "/api/users/me/workspaces/invitations/", outsideUser.id, {
        invitations: [inv[0]!.id],
      });
      expect(res.status).toBe(204);

      // Invitation should still exist (it wasn't for outsideUser)
      const remaining = await testDb.query.workspaceInvitations.findFirst({ where: eq(workspaceInvitations.id, inv[0]!.id) });
      expect(remaining).toBeDefined();
    });

    test("rejects empty invitations array", async () => {
      const res = await makeRequest(app, "POST", "/api/users/me/workspaces/invitations/", outsideUser.id, {
        invitations: [],
      });
      expect(res.status).toBe(400);
    });

    test("requires authentication", async () => {
      const res = await makeRequest(app, "POST", "/api/users/me/workspaces/invitations/", undefined, {
        invitations: ["some-id"],
      });
      expect(res.status).toBe(401);
    });
  });
});

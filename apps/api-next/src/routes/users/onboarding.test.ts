import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as schema from "../../db/schema";
import { users, userProfiles } from "../../db/schema/user";
import { workspaces, workspaceMembers, workspaceInvitations } from "../../db/schema/workspace";

const sqlite = new BunSQLite(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(sqlite, { schema });

const testUser = {
  id: createId(),
  email: "test@test.com",
  name: "Test User",
  isActive: true,
};

// --- Helpers matching users/index.ts ---

function formatProfileResponse(profile: typeof userProfiles.$inferSelect) {
  return {
    id: profile.id,
    user_id: profile.userId,
    timezone: profile.timezone ?? "UTC",
    date_format: profile.dateFormat ?? "MM/DD/YYYY",
    time_format: profile.timeFormat ?? "12h",
    theme: profile.theme ?? "system",
    language: profile.language ?? "en",
    role: profile.role ?? "",
    use_case: profile.useCase ?? "",
    last_workspace_id: profile.lastWorkspaceId ?? null,
    onboarding_step: profile.onboardingStep ?? {
      profile_complete: false,
      workspace_create: false,
      workspace_invite: false,
      workspace_join: false,
    },
    is_onboarded: profile.isOnboarded ?? false,
    is_tour_completed: profile.isTourCompleted ?? false,
    billing_address_country: profile.billingAddressCountry ?? "INDIA",
    billing_address: profile.billingAddress ?? null,
    company_name: profile.companyName ?? "",
    has_marketing_email_consent: profile.hasMarketingEmailConsent ?? false,
    created_at: profile.createdAt?.toISOString() ?? null,
    updated_at: profile.updatedAt?.toISOString() ?? null,
  };
}

async function getOrCreateProfile(userId: string) {
  let profile = await testDb.query.userProfiles.findFirst({
    where: eq(userProfiles.userId, userId),
  });
  if (!profile) {
    const result = await testDb.insert(userProfiles).values({ userId }).returning();
    profile = result[0];
  }
  return profile!;
}

const updateProfileSchema = z.object({
  timezone: z.string().max(50).optional(),
  date_format: z.string().max(20).optional(),
  time_format: z.enum(["12h", "24h"]).optional(),
  theme: z.string().max(50).optional(),
  language: z.string().max(10).optional(),
  role: z.string().max(300).optional(),
  use_case: z.string().optional(),
  last_workspace_id: z.string().optional().nullable(),
  onboarding_step: z.object({
    profile_complete: z.boolean().optional(),
    workspace_create: z.boolean().optional(),
    workspace_invite: z.boolean().optional(),
    workspace_join: z.boolean().optional(),
  }).optional(),
  is_onboarded: z.boolean().optional(),
  is_tour_completed: z.boolean().optional(),
  billing_address_country: z.string().max(100).optional(),
  billing_address: z.any().optional(),
  company_name: z.string().max(255).optional(),
  has_marketing_email_consent: z.boolean().optional(),
});

const updateUserSchema = z.object({
  first_name: z.string().max(50).optional(),
  last_name: z.string().max(50).optional(),
  display_name: z.string().max(100).optional(),
  avatar: z.string().url().optional().nullable(),
  onboarding_step: z.object({
    profile_complete: z.boolean().optional(),
    workspace_create: z.boolean().optional(),
    workspace_invite: z.boolean().optional(),
    workspace_join: z.boolean().optional(),
  }).optional(),
});

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(3).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  organization_size: z.string().max(20).optional(),
});

function buildTestApp() {
  const app = new Hono<{ Variables: any }>();

  // Fake auth middleware
  app.use("*", async (c, next) => {
    const userId = c.req.header("X-Test-User-Id") || testUser.id;
    const user = await testDb.query.users.findFirst({ where: eq(users.id, userId) });
    if (user) {
      c.set("user", user);
    } else {
      c.set("user", testUser);
    }
    await next();
  });

  // PATCH /api/users/me/ - Update user with onboarding step support
  app.patch("/api/users/me/", zValidator("json", updateUserSchema), async (c) => {
    const contextUser = c.get("user") as any;
    const body = c.req.valid("json");

    const updateData: Record<string, unknown> = {
      ...(body.first_name !== undefined && { firstName: body.first_name }),
      ...(body.last_name !== undefined && { lastName: body.last_name }),
      ...(body.display_name !== undefined && { displayName: body.display_name }),
      ...(body.avatar !== undefined && { avatar: body.avatar }),
      updatedAt: new Date(),
    };

    if (Object.keys(updateData).length > 1) {
      await testDb.update(users).set(updateData).where(eq(users.id, contextUser.id));
    }

    if (body.onboarding_step) {
      const profile = await getOrCreateProfile(contextUser.id);
      const currentStep = (profile.onboardingStep as Record<string, boolean>) || {
        profile_complete: false,
        workspace_create: false,
        workspace_invite: false,
        workspace_join: false,
      };
      await testDb.update(userProfiles).set({
        onboardingStep: { ...currentStep, ...body.onboarding_step } as {
          profile_complete: boolean;
          workspace_create: boolean;
          workspace_invite: boolean;
          workspace_join: boolean;
        },
        updatedAt: new Date(),
      }).where(eq(userProfiles.userId, contextUser.id));
    }

    const updatedUser = await testDb.query.users.findFirst({
      where: eq(users.id, contextUser.id),
      with: { profile: true },
    });

    return c.json({
      id: updatedUser!.id,
      email: updatedUser!.email,
      first_name: updatedUser!.firstName ?? "",
      last_name: updatedUser!.lastName ?? "",
      display_name: updatedUser!.displayName ?? updatedUser!.name ?? "",
      avatar: updatedUser!.avatar ?? "",
      is_onboarded: updatedUser!.profile?.isOnboarded ?? false,
      onboarding_step: updatedUser!.profile?.onboardingStep ?? {},
    });
  });

  // GET /api/users/me/profile/ - Get profile
  app.get("/api/users/me/profile/", async (c) => {
    const contextUser = c.get("user") as any;
    const profile = await getOrCreateProfile(contextUser.id);
    return c.json(formatProfileResponse(profile));
  });

  // PATCH /api/users/me/profile/ - Update profile (with onboarding fields)
  app.patch("/api/users/me/profile/", zValidator("json", updateProfileSchema), async (c) => {
    const contextUser = c.get("user") as any;
    const body = c.req.valid("json");
    const existingProfile = await getOrCreateProfile(contextUser.id);

    const updateData: Record<string, unknown> = {
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.date_format !== undefined && { dateFormat: body.date_format }),
      ...(body.time_format !== undefined && { timeFormat: body.time_format }),
      ...(body.theme !== undefined && { theme: body.theme }),
      ...(body.language !== undefined && { language: body.language }),
      ...(body.role !== undefined && { role: body.role }),
      ...(body.use_case !== undefined && { useCase: body.use_case }),
      ...(body.last_workspace_id !== undefined && { lastWorkspaceId: body.last_workspace_id }),
      ...(body.is_onboarded !== undefined && { isOnboarded: body.is_onboarded }),
      ...(body.is_tour_completed !== undefined && { isTourCompleted: body.is_tour_completed }),
      ...(body.has_marketing_email_consent !== undefined && { hasMarketingEmailConsent: body.has_marketing_email_consent }),
      ...(body.company_name !== undefined && { companyName: body.company_name }),
      updatedAt: new Date(),
    };

    if (body.onboarding_step) {
      const currentStep = (existingProfile.onboardingStep as Record<string, boolean>) || {
        profile_complete: false,
        workspace_create: false,
        workspace_invite: false,
        workspace_join: false,
      };
      updateData.onboardingStep = { ...currentStep, ...body.onboarding_step };
    }

    await testDb.update(userProfiles).set(updateData).where(eq(userProfiles.userId, contextUser.id));

    const profile = await testDb.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, contextUser.id),
    });

    return c.json(formatProfileResponse(profile!));
  });

  // GET /api/users/me/settings/ - Get settings (matching Django's UserMeSettingsSerializer)
  app.get("/api/users/me/settings/", async (c) => {
    const contextUser = c.get("user") as any;
    const user = await testDb.query.users.findFirst({
      where: eq(users.id, contextUser.id),
    });
    const profile = await getOrCreateProfile(contextUser.id);

    // Count pending invitations
    const invitations = await testDb.select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.email, user!.email));
    const inviteCount = invitations.length;

    // Get last workspace info
    let lastWorkspace = null;
    if (profile.lastWorkspaceId) {
      const membership = await testDb.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, profile.lastWorkspaceId),
          eq(workspaceMembers.userId, contextUser.id),
          eq(workspaceMembers.isActive, true)
        ),
      });
      if (membership) {
        lastWorkspace = await testDb.query.workspaces.findFirst({
          where: eq(workspaces.id, profile.lastWorkspaceId),
        });
      }
    }

    return c.json({
      id: user!.id,
      email: user!.email,
      workspace: {
        last_workspace_id: lastWorkspace?.id ?? null,
        last_workspace_slug: lastWorkspace?.slug ?? null,
        last_workspace_name: lastWorkspace?.name ?? null,
        last_workspace_logo: lastWorkspace?.logo ?? null,
        fallback_workspace_id: lastWorkspace?.id ?? null,
        fallback_workspace_slug: lastWorkspace?.slug ?? null,
        invites: inviteCount,
      },
    });
  });

  // PATCH /api/users/me/onboard/ - Mark onboarded
  app.patch("/api/users/me/onboard/", zValidator("json", z.object({ is_onboarded: z.boolean().default(true) })), async (c) => {
    const contextUser = c.get("user") as any;
    const { is_onboarded } = c.req.valid("json");
    await getOrCreateProfile(contextUser.id);

    await testDb.update(userProfiles).set({
      isOnboarded: is_onboarded,
      updatedAt: new Date(),
    }).where(eq(userProfiles.userId, contextUser.id));

    return c.json({ message: "Updated successfully" }, 200);
  });

  // PATCH /api/users/me/tour-completed/ - Mark tour completed
  app.patch("/api/users/me/tour-completed/", zValidator("json", z.object({ is_tour_completed: z.boolean().default(true) })), async (c) => {
    const contextUser = c.get("user") as any;
    const { is_tour_completed } = c.req.valid("json");
    await getOrCreateProfile(contextUser.id);

    await testDb.update(userProfiles).set({
      isTourCompleted: is_tour_completed,
      updatedAt: new Date(),
    }).where(eq(userProfiles.userId, contextUser.id));

    return c.json({ message: "Updated successfully" }, 200);
  });

  // POST /api/workspaces/ - Create workspace
  app.post("/api/workspaces/", zValidator("json", createWorkspaceSchema), async (c) => {
    const contextUser = c.get("user") as any;
    const body = c.req.valid("json");

    const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const existing = await testDb.query.workspaces.findFirst({
      where: eq(workspaces.slug, slug),
    });
    if (existing) {
      return c.json({ slug: ["Workspace with this slug already exists."] }, 400);
    }

    const result = await testDb.insert(workspaces).values({
      name: body.name,
      slug,
      ownerId: contextUser.id,
      organizationSize: body.organization_size,
    }).returning();

    const workspace = result[0]!;

    await testDb.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: contextUser.id,
      role: 20,
    });

    return c.json({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      owner_id: workspace.ownerId,
      organization_size: workspace.organizationSize,
      role: 20,
      total_members: 1,
    }, 201);
  });

  // POST /api/workspaces/:slug/invitations/ - Send invitations
  app.post("/api/workspaces/:slug/invitations/", async (c) => {
    const contextUser = c.get("user") as any;
    const slug = c.req.param("slug");
    const body = await c.req.json();

    const workspace = await testDb.query.workspaces.findFirst({
      where: eq(workspaces.slug, slug),
    });
    if (!workspace) return c.json({ detail: "Workspace not found" }, 404);

    const emails = body.emails || [];
    const created = [];

    for (const item of emails) {
      const inv = await testDb.insert(workspaceInvitations).values({
        workspaceId: workspace.id,
        email: item.email,
        role: item.role || 15,
        token: crypto.randomUUID(),
        createdById: contextUser.id,
      }).returning();
      created.push(inv[0]);
    }

    return c.json(created, 200);
  });

  return app;
}

// --- Helper for JSON requests ---
function jsonRequest(app: any, method: string, path: string, body?: unknown, userId?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (userId) headers["X-Test-User-Id"] = userId;
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
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
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      timezone TEXT DEFAULT 'UTC',
      date_format TEXT DEFAULT 'MM/DD/YYYY',
      time_format TEXT DEFAULT '12h',
      theme TEXT DEFAULT 'system',
      language TEXT DEFAULT 'en',
      last_workspace_id TEXT,
      role TEXT,
      use_case TEXT,
      onboarding_step TEXT,
      is_tour_completed INTEGER DEFAULT 0,
      is_onboarded INTEGER DEFAULT 0,
      billing_address TEXT,
      billing_address_country TEXT DEFAULT 'INDIA',
      company_name TEXT,
      has_marketing_email_consent INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
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

  // Seed user and profile
  await testDb.insert(users).values(testUser);
  await testDb.insert(userProfiles).values({
    id: createId(),
    userId: testUser.id,
    isOnboarded: false,
  });
});

// =====================================================
// Tests
// =====================================================

const app = buildTestApp();

describe("Step 1: Profile Setup (PATCH /api/users/me/)", () => {
  test("updates first_name and last_name", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/", {
      first_name: "Test",
      last_name: "User",
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.first_name).toBe("Test");
    expect(data.last_name).toBe("User");
  });

  test("updates display_name", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/", {
      display_name: "TestUser",
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.display_name).toBe("TestUser");
  });
});

describe("Step 2: Role Setup (PATCH /api/users/me/profile/)", () => {
  test("sets role on profile", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      role: "product_manager",
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.role).toBe("product_manager");
  });
});

describe("Step 3: Use Case Setup (PATCH /api/users/me/profile/)", () => {
  test("sets use_case on profile", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      use_case: "Bug Tracking. Sprint Planning",
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.use_case).toBe("Bug Tracking. Sprint Planning");
  });
});

describe("Step 4: Workspace Creation (POST /api/workspaces/)", () => {
  test("creates workspace and returns it", async () => {
    const res = await jsonRequest(app, "POST", "/api/workspaces/", {
      name: "My Workspace",
      slug: "my-workspace",
      organization_size: "2-10",
    });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.name).toBe("My Workspace");
    expect(data.slug).toBe("my-workspace");
    expect(data.role).toBe(20);
    expect(data.total_members).toBe(1);
  });

  test("rejects duplicate slug", async () => {
    const res = await jsonRequest(app, "POST", "/api/workspaces/", {
      name: "My Workspace",
      slug: "my-workspace",
    });
    expect(res.status).toBe(400);
  });

  test("updates last_workspace_id after creation", async () => {
    // Get the workspace ID from the DB
    const ws = await testDb.query.workspaces.findFirst({
      where: eq(workspaces.slug, "my-workspace"),
    });
    expect(ws).toBeDefined();

    const res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      last_workspace_id: ws!.id,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.last_workspace_id).toBe(ws!.id);
  });
});

describe("Step 5: Invite Members (POST /api/workspaces/:slug/invitations/)", () => {
  test("sends invitations to team members", async () => {
    const res = await jsonRequest(app, "POST", "/api/workspaces/my-workspace/invitations/", {
      emails: [
        { email: "alice@test.com", role: 15 },
        { email: "bob@test.com", role: 10 },
      ],
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveLength(2);
  });
});

describe("Onboarding Step Tracking (PATCH /api/users/me/profile/)", () => {
  test("partial update merges with existing onboarding_step", async () => {
    // Set profile_complete
    let res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      onboarding_step: { profile_complete: true },
    });
    expect(res.status).toBe(200);
    let data = await res.json() as any;
    expect(data.onboarding_step.profile_complete).toBe(true);
    expect(data.onboarding_step.workspace_create).toBe(false);

    // Set workspace_create without losing profile_complete
    res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      onboarding_step: { workspace_create: true },
    });
    expect(res.status).toBe(200);
    data = await res.json() as any;
    expect(data.onboarding_step.profile_complete).toBe(true);
    expect(data.onboarding_step.workspace_create).toBe(true);
    expect(data.onboarding_step.workspace_invite).toBe(false);
    expect(data.onboarding_step.workspace_join).toBe(false);
  });

  test("sets all steps to true at end of onboarding", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      onboarding_step: {
        profile_complete: true,
        workspace_create: true,
        workspace_invite: true,
        workspace_join: true,
      },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.onboarding_step.profile_complete).toBe(true);
    expect(data.onboarding_step.workspace_create).toBe(true);
    expect(data.onboarding_step.workspace_invite).toBe(true);
    expect(data.onboarding_step.workspace_join).toBe(true);
  });
});

describe("PATCH /api/users/me/onboard/ - Mark onboarded", () => {
  test("marks user as onboarded", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/onboard/", {
      is_onboarded: true,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.message).toBe("Updated successfully");

    // Verify in DB
    const profile = await testDb.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, testUser.id),
    });
    expect(profile!.isOnboarded).toBe(true);
  });

  test("can set back to false", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/onboard/", {
      is_onboarded: false,
    });
    expect(res.status).toBe(200);

    const profile = await testDb.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, testUser.id),
    });
    expect(profile!.isOnboarded).toBe(false);
  });
});

describe("PATCH /api/users/me/tour-completed/", () => {
  test("marks tour as completed", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/tour-completed/", {
      is_tour_completed: true,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.message).toBe("Updated successfully");

    const profile = await testDb.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, testUser.id),
    });
    expect(profile!.isTourCompleted).toBe(true);
  });
});

describe("GET /api/users/me/profile/ - Profile response includes onboarding fields", () => {
  test("returns full profile with onboarding data", async () => {
    const res = await jsonRequest(app, "GET", "/api/users/me/profile/");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("role");
    expect(data).toHaveProperty("use_case");
    expect(data).toHaveProperty("last_workspace_id");
    expect(data).toHaveProperty("onboarding_step");
    expect(data).toHaveProperty("is_onboarded");
    expect(data).toHaveProperty("is_tour_completed");
    expect(data).toHaveProperty("has_marketing_email_consent");
    expect(data).toHaveProperty("company_name");
    expect(data).toHaveProperty("billing_address_country");
    expect(data.role).toBe("product_manager");
    expect(data.use_case).toBe("Bug Tracking. Sprint Planning");
  });
});

describe("GET /api/users/me/settings/ - Settings response matches IUserSettings", () => {
  test("returns workspace info with last_workspace and invites", async () => {
    const res = await jsonRequest(app, "GET", "/api/users/me/settings/");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("email");
    expect(data).toHaveProperty("workspace");
    expect(data.workspace).toHaveProperty("last_workspace_id");
    expect(data.workspace).toHaveProperty("last_workspace_slug");
    expect(data.workspace).toHaveProperty("fallback_workspace_id");
    expect(data.workspace).toHaveProperty("fallback_workspace_slug");
    expect(data.workspace).toHaveProperty("invites");
  });
});

describe("Marketing consent (PATCH /api/users/me/profile/)", () => {
  test("sets marketing email consent", async () => {
    const res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      has_marketing_email_consent: true,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.has_marketing_email_consent).toBe(true);
  });
});

describe("Full onboarding flow end-to-end", () => {
  const flowUser = {
    id: createId(),
    email: "flow@test.com",
    name: "Flow User",
    isActive: true,
  };

  test("complete onboarding simulation", async () => {
    // Setup user
    await testDb.insert(users).values(flowUser);
    await testDb.insert(userProfiles).values({
      id: createId(),
      userId: flowUser.id,
      isOnboarded: false,
    });

    // Step 1: Profile setup
    let res = await jsonRequest(app, "PATCH", "/api/users/me/", {
      first_name: "Flow",
      last_name: "User",
    }, flowUser.id);
    expect(res.status).toBe(200);

    // Step 2: Role
    res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      role: "developer",
    }, flowUser.id);
    expect(res.status).toBe(200);

    // Step 3: Use case
    res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      use_case: "Bug Tracking",
    }, flowUser.id);
    expect(res.status).toBe(200);

    // Step 4: Create workspace
    res = await jsonRequest(app, "POST", "/api/workspaces/", {
      name: "Flow WS",
      slug: "flow-ws",
      organization_size: "2-10",
    }, flowUser.id);
    expect(res.status).toBe(201);
    const ws = await res.json() as any;

    // Update last_workspace_id
    res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      last_workspace_id: ws.id,
    }, flowUser.id);
    expect(res.status).toBe(200);

    // Step 5: Invite members
    res = await jsonRequest(app, "POST", "/api/workspaces/flow-ws/invitations/", {
      emails: [{ email: "teammate@test.com", role: 15 }],
    }, flowUser.id);
    expect(res.status).toBe(200);

    // Finish: Set all steps complete
    res = await jsonRequest(app, "PATCH", "/api/users/me/profile/", {
      onboarding_step: {
        profile_complete: true,
        workspace_create: true,
        workspace_invite: true,
        workspace_join: true,
      },
    }, flowUser.id);
    expect(res.status).toBe(200);

    // Mark onboarded
    res = await jsonRequest(app, "PATCH", "/api/users/me/onboard/", {
      is_onboarded: true,
    }, flowUser.id);
    expect(res.status).toBe(200);

    // Verify final state
    const profile = await testDb.query.userProfiles.findFirst({
      where: eq(userProfiles.userId, flowUser.id),
    });
    expect(profile!.isOnboarded).toBe(true);
    expect(profile!.role).toBe("developer");
    expect(profile!.useCase).toBe("Bug Tracking");
    expect(profile!.lastWorkspaceId).toBe(ws.id);
    const step = profile!.onboardingStep as any;
    expect(step.profile_complete).toBe(true);
    expect(step.workspace_create).toBe(true);
    expect(step.workspace_invite).toBe(true);
    expect(step.workspace_join).toBe(true);

    // Settings should reflect workspace info
    res = await jsonRequest(app, "GET", "/api/users/me/settings/", undefined, flowUser.id);
    expect(res.status).toBe(200);
    const settings = await res.json() as any;
    expect(settings.id).toBe(flowUser.id);
    expect(settings.workspace).toBeDefined();
    expect(settings.workspace.last_workspace_id).toBe(ws.id);
    expect(settings.workspace.last_workspace_slug).toBe("flow-ws");
  });
});

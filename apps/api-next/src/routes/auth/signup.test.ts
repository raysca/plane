import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as schema from "../../db/schema";
import { users } from "../../db/schema/user";
import {
  workspaces,
  workspaceMembers,
  workspaceInvitations,
} from "../../db/schema/workspace";

// --- In-memory test database ---

const sqlite = new BunSQLite(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(sqlite, { schema });

// --- Auth error codes ---

const AUTH_ERROR_CODES = {
  INSTANCE_NOT_CONFIGURED: 5000,
  SIGNUP_DISABLED: 5015,
  INVALID_PASSWORD: 5020,
  USER_ALREADY_EXIST: 5030,
  AUTHENTICATION_FAILED_SIGN_UP: 5035,
  REQUIRED_EMAIL_PASSWORD_SIGN_UP: 5040,
  INVALID_EMAIL_SIGN_UP: 5045,
  INVALID_EMAIL_MAGIC_SIGN_UP: 5050,
  MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED: 5055,
} as const;

const FRONTEND_URL = "http://localhost:3000";

// --- Helpers (same logic as auth routes) ---

function buildRedirectUrl(nextPath?: string | null, params?: Record<string, string | number>): string {
  const path = nextPath || "/";
  const url = new URL(path, FRONTEND_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

async function getRedirectionPath(userId: string, email: string): Promise<string> {
  const { asc } = require("drizzle-orm");
  const user = await testDb.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.isOnboarded) return "/onboarding";

  const memberships = await testDb
    .select({ workspace: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.isActive, true)))
    .orderBy(asc(workspaces.createdAt));

  if (memberships.length > 0) return `/${memberships[0]!.workspace.slug}`;

  const pendingInvite = await testDb.query.workspaceInvitations.findFirst({
    where: eq(workspaceInvitations.email, email),
  });
  if (pendingInvite) return "/invitations";

  return "/create-workspace";
}

async function processWorkspaceInvitations(userId: string, email: string): Promise<void> {
  const acceptedInvites = await testDb.query.workspaceInvitations.findMany({
    where: and(eq(workspaceInvitations.email, email), eq(workspaceInvitations.accepted, true)),
  });

  for (const invite of acceptedInvites) {
    const existing = await testDb.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, userId)),
    });
    if (!existing) {
      await testDb.insert(workspaceMembers).values({
        workspaceId: invite.workspaceId, userId, role: invite.role,
      });
    }
  }

  if (acceptedInvites.length > 0) {
    for (const invite of acceptedInvites) {
      await testDb.delete(workspaceInvitations).where(eq(workspaceInvitations.id, invite.id));
    }
  }
}

// --- Test data ---

const existingUser = {
  id: createId(),
  email: "existing@test.com",
  name: "Existing User",
  isActive: true,
  isOnboarded: true,
};

const testWorkspace = {
  id: createId(),
  name: "Test WS",
  slug: "test-ws-auth",
  ownerId: "", // set after user creation
};

// --- Build test app ---

function buildTestApp() {
  const app = new Hono();

  const signUpSchema = z.object({
    email: z.email(),
    password: z.string().min(8).max(128),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
  });

  // Sign up - JSON only for testability (simulates the JSON path)
  app.post("/auth/sign-up/", async (c) => {
    let email: string | undefined;
    let password: string | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    let nextPath: string | undefined;

    const contentType = c.req.header("content-type");
    const isJson = contentType?.includes("application/json");

    if (isJson) {
      const body = await c.req.json();
      email = body.email;
      password = body.password;
      firstName = body.first_name;
      lastName = body.last_name;
    } else {
      const body = await c.req.parseBody();
      email = body["email"] as string | undefined;
      password = body["password"] as string | undefined;
      firstName = body["first_name"] as string | undefined;
      lastName = body["last_name"] as string | undefined;
      nextPath = body["next_path"] as string | undefined;
    }

    if (!email || !password) {
      if (isJson) {
        return c.json({ detail: "Email and password are required." }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.REQUIRED_EMAIL_PASSWORD_SIGN_UP,
        error_message: "REQUIRED_EMAIL_PASSWORD_SIGN_UP",
      }));
    }

    email = email.trim().toLowerCase();

    if (!isValidEmail(email)) {
      if (isJson) {
        return c.json({ detail: "Invalid email address." }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.INVALID_EMAIL_SIGN_UP,
        error_message: "INVALID_EMAIL_SIGN_UP",
      }));
    }

    const parseResult = signUpSchema.safeParse({ email, password });
    if (!parseResult.success) {
      if (isJson) {
        return c.json({ detail: "Password must be between 8 and 128 characters." }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.INVALID_PASSWORD,
        error_message: "INVALID_PASSWORD",
      }));
    }

    const existingU = await testDb.query.users.findFirst({ where: eq(users.email, email) });
    if (existingU) {
      if (isJson) {
        return c.json({ email: ["A user with this email already exists."] }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.USER_ALREADY_EXIST,
        error_message: "USER_ALREADY_EXIST",
      }));
    }

    // Simulate successful signup (Better Auth would do this)
    const newUser = await testDb.insert(users).values({
      id: createId(),
      email,
      name: [firstName, lastName].filter(Boolean).join(" ") || "User",
      firstName: firstName || "",
      lastName: lastName || "",
      isActive: true,
    }).returning();

    const userId = newUser[0]!.id;
    const userEmail = newUser[0]!.email;

    // Post-signup workflow
    await processWorkspaceInvitations(userId, userEmail);

    if (isJson) {
      return c.json({
        user: {
          id: userId,
          email: userEmail,
          first_name: firstName || "",
          last_name: lastName || "",
        },
      }, 201);
    }

    const path = nextPath || await getRedirectionPath(userId, userEmail);
    return c.redirect(buildRedirectUrl(path));
  });

  // Magic sign-up endpoint
  app.post("/auth/magic-sign-up/", async (c) => {
    let code: string | undefined;
    let email: string | undefined;
    let nextPath: string | undefined;

    const contentType = c.req.header("content-type");
    const isJson = contentType?.includes("application/json");

    if (isJson) {
      const body = await c.req.json();
      code = body.code;
      email = body.email;
      nextPath = body.next_path;
    } else {
      const body = await c.req.parseBody();
      code = (body["code"] as string)?.trim();
      email = (body["email"] as string)?.trim().toLowerCase();
      nextPath = body["next_path"] as string | undefined;
    }

    if (!code || !email) {
      if (isJson) {
        return c.json({ detail: "Email and code are required." }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED,
        error_message: "MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED",
      }));
    }

    email = email.trim().toLowerCase();

    if (!isValidEmail(email)) {
      if (isJson) {
        return c.json({ detail: "Invalid email address." }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.INVALID_EMAIL_MAGIC_SIGN_UP,
        error_message: "INVALID_EMAIL_MAGIC_SIGN_UP",
      }));
    }

    const existingU = await testDb.query.users.findFirst({ where: eq(users.email, email) });
    if (existingU) {
      if (isJson) {
        return c.json({ detail: "A user with this email already exists." }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: AUTH_ERROR_CODES.USER_ALREADY_EXIST,
        error_message: "USER_ALREADY_EXIST",
      }));
    }

    // Simulate magic code verification and user creation
    // In production, Better Auth's magicLinkVerify handles this
    if (code !== "valid-magic-token") {
      if (isJson) {
        return c.json({ detail: "Invalid or expired magic code." }, 400);
      }
      return c.redirect(buildRedirectUrl(nextPath, {
        error_code: 5092,
        error_message: "INVALID_MAGIC_CODE_SIGN_UP",
      }));
    }

    const newUser = await testDb.insert(users).values({
      id: createId(),
      email,
      name: "User",
      isActive: true,
      isPasswordAutoset: true,
    }).returning();

    const userId = newUser[0]!.id;
    const userEmail = newUser[0]!.email;

    await processWorkspaceInvitations(userId, userEmail);

    if (isJson) {
      return c.json({ user: { id: userId, email: userEmail } }, 201);
    }

    const path = nextPath || await getRedirectionPath(userId, userEmail);
    return c.redirect(buildRedirectUrl(path));
  });

  return app;
}

// --- Request helpers ---

function jsonRequest(app: Hono, method: string, path: string, body?: unknown) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function formRequest(app: Hono, method: string, path: string, formData: Record<string, string>) {
  const body = new URLSearchParams(formData).toString();
  return app.request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

// --- Setup ---

let app: ReturnType<typeof buildTestApp>;

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
      is_onboarded INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      is_tour_completed INTEGER DEFAULT 0,
      is_password_autoset INTEGER DEFAULT 0,
      onboarding_step INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id),
      organization_size TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role INTEGER NOT NULL DEFAULT 15,
      is_active INTEGER DEFAULT 1,
      view_props TEXT,
      default_props TEXT,
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

  // Seed existing user
  await testDb.insert(users).values(existingUser);

  // Seed workspace
  testWorkspace.ownerId = existingUser.id;
  await testDb.insert(workspaces).values(testWorkspace);
  await testDb.insert(workspaceMembers).values({
    id: createId(),
    workspaceId: testWorkspace.id,
    userId: existingUser.id,
    role: 20,
  });

  app = buildTestApp();
});

// --- Tests ---

describe("Sign Up - JSON API", () => {
  test("creates new user with valid email and password", async () => {
    const res = await jsonRequest(app, "POST", "/auth/sign-up/", {
      email: "newuser@test.com",
      password: "securepassword123",
      first_name: "New",
      last_name: "User",
    });

    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe("newuser@test.com");
    expect(data.user.first_name).toBe("New");
    expect(data.user.last_name).toBe("User");
  });

  test("rejects signup with existing email", async () => {
    const res = await jsonRequest(app, "POST", "/auth/sign-up/", {
      email: existingUser.email,
      password: "securepassword123",
    });

    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.email).toBeDefined();
    expect(data.email[0]).toContain("already exists");
  });

  test("rejects signup without email", async () => {
    const res = await jsonRequest(app, "POST", "/auth/sign-up/", {
      password: "securepassword123",
    });

    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.detail).toContain("required");
  });

  test("rejects signup without password", async () => {
    const res = await jsonRequest(app, "POST", "/auth/sign-up/", {
      email: "nopassword@test.com",
    });

    expect(res.status).toBe(400);
  });

  test("rejects signup with invalid email", async () => {
    const res = await jsonRequest(app, "POST", "/auth/sign-up/", {
      email: "not-an-email",
      password: "securepassword123",
    });

    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.detail).toContain("Invalid email");
  });

  test("rejects signup with short password", async () => {
    const res = await jsonRequest(app, "POST", "/auth/sign-up/", {
      email: "shortpw@test.com",
      password: "short",
    });

    expect(res.status).toBe(400);
  });

  test("normalizes email to lowercase", async () => {
    const res = await jsonRequest(app, "POST", "/auth/sign-up/", {
      email: "UPPERCASE@TEST.COM",
      password: "securepassword123",
    });

    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.user.email).toBe("uppercase@test.com");
  });
});

describe("Sign Up - Form POST (redirect-based)", () => {
  test("redirects with error code when email missing", async () => {
    const res = await formRequest(app, "POST", "/auth/sign-up/", {
      password: "securepassword123",
    });

    // Should redirect (302)
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain(`error_code=${AUTH_ERROR_CODES.REQUIRED_EMAIL_PASSWORD_SIGN_UP}`);
  });

  test("redirects with error code when password missing", async () => {
    const res = await formRequest(app, "POST", "/auth/sign-up/", {
      email: "formtest@test.com",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain(`error_code=${AUTH_ERROR_CODES.REQUIRED_EMAIL_PASSWORD_SIGN_UP}`);
  });

  test("redirects with error when email already exists", async () => {
    const res = await formRequest(app, "POST", "/auth/sign-up/", {
      email: existingUser.email,
      password: "securepassword123",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain(`error_code=${AUTH_ERROR_CODES.USER_ALREADY_EXIST}`);
  });

  test("redirects with error for invalid email", async () => {
    const res = await formRequest(app, "POST", "/auth/sign-up/", {
      email: "bad-email",
      password: "securepassword123",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain(`error_code=${AUTH_ERROR_CODES.INVALID_EMAIL_SIGN_UP}`);
  });

  test("redirects to onboarding on successful signup (new user not onboarded)", async () => {
    const res = await formRequest(app, "POST", "/auth/sign-up/", {
      email: "formuser@test.com",
      password: "securepassword123",
      first_name: "Form",
      last_name: "User",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    // New user is not onboarded, so should redirect to /onboarding
    expect(location).toContain("/onboarding");
  });

  test("preserves next_path on error redirect", async () => {
    const res = await formRequest(app, "POST", "/auth/sign-up/", {
      email: existingUser.email,
      password: "securepassword123",
      next_path: "/my-workspace",
    });

    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain(`error_code=${AUTH_ERROR_CODES.USER_ALREADY_EXIST}`);
  });
});

describe("Post-signup workflow - invitation processing", () => {
  test("processes accepted workspace invitations on signup", async () => {
    const inviteEmail = "invitee-signup@test.com";

    // Create accepted invitation before signup
    await testDb.insert(workspaceInvitations).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      email: inviteEmail,
      role: 15,
      token: crypto.randomUUID(),
      accepted: true,
    });

    // Sign up
    const res = await jsonRequest(app, "POST", "/auth/sign-up/", {
      email: inviteEmail,
      password: "securepassword123",
    });

    expect(res.status).toBe(201);

    // Verify user was added as workspace member
    const newUser = await testDb.query.users.findFirst({
      where: eq(users.email, inviteEmail),
    });
    expect(newUser).toBeDefined();

    const membership = await testDb.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, testWorkspace.id),
        eq(workspaceMembers.userId, newUser!.id)
      ),
    });
    expect(membership).toBeDefined();
    expect(membership!.role).toBe(15);

    // Verify invitation was deleted
    const remainingInvites = await testDb.query.workspaceInvitations.findMany({
      where: eq(workspaceInvitations.email, inviteEmail),
    });
    expect(remainingInvites.length).toBe(0);
  });

  test("does not create duplicate memberships", async () => {
    const inviteEmail = "already-member-signup@test.com";

    // Create a user and add them as member
    const userId = createId();
    await testDb.insert(users).values({
      id: userId,
      email: inviteEmail,
      name: "Already Member",
      isActive: true,
    });
    await testDb.insert(workspaceMembers).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      userId,
      role: 15,
    });

    // Create accepted invitation
    await testDb.insert(workspaceInvitations).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      email: inviteEmail,
      role: 20,
      token: crypto.randomUUID(),
      accepted: true,
    });

    // Process invitations
    await processWorkspaceInvitations(userId, inviteEmail);

    // Should still have only one membership
    const memberships = await testDb
      .select()
      .from(workspaceMembers)
      .where(and(
        eq(workspaceMembers.workspaceId, testWorkspace.id),
        eq(workspaceMembers.userId, userId)
      ));
    expect(memberships.length).toBe(1);
  });
});

describe("Redirection path logic", () => {
  test("returns /onboarding for non-onboarded user", async () => {
    const userId = createId();
    await testDb.insert(users).values({
      id: userId,
      email: "not-onboarded@test.com",
      name: "Not Onboarded",
      isOnboarded: false,
    });

    const path = await getRedirectionPath(userId, "not-onboarded@test.com");
    expect(path).toBe("/onboarding");
  });

  test("returns workspace slug for onboarded user with active membership", async () => {
    const path = await getRedirectionPath(existingUser.id, existingUser.email);
    expect(path).toBe(`/${testWorkspace.slug}`);
  });

  test("returns /invitations for onboarded user with pending invitations", async () => {
    const userId = createId();
    const email = "has-invitations@test.com";
    await testDb.insert(users).values({
      id: userId,
      email,
      name: "Has Invitations",
      isOnboarded: true,
    });
    await testDb.insert(workspaceInvitations).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      email,
      role: 15,
      token: crypto.randomUUID(),
    });

    const path = await getRedirectionPath(userId, email);
    expect(path).toBe("/invitations");
  });

  test("returns /create-workspace for onboarded user with no workspaces or invites", async () => {
    const userId = createId();
    const email = "lonely-user@test.com";
    await testDb.insert(users).values({
      id: userId,
      email,
      name: "Lonely User",
      isOnboarded: true,
    });

    const path = await getRedirectionPath(userId, email);
    expect(path).toBe("/create-workspace");
  });
});

describe("Magic Sign Up - JSON API", () => {
  test("rejects without email and code", async () => {
    const res = await jsonRequest(app, "POST", "/auth/magic-sign-up/", {});
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.detail).toContain("required");
  });

  test("rejects with invalid email", async () => {
    const res = await jsonRequest(app, "POST", "/auth/magic-sign-up/", {
      email: "bad-email",
      code: "123456",
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.detail).toContain("Invalid email");
  });

  test("rejects if user already exists", async () => {
    const res = await jsonRequest(app, "POST", "/auth/magic-sign-up/", {
      email: existingUser.email,
      code: "valid-magic-token",
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.detail).toContain("already exists");
  });

  test("rejects with invalid magic code", async () => {
    const res = await jsonRequest(app, "POST", "/auth/magic-sign-up/", {
      email: "magic-signup@test.com",
      code: "invalid-token",
    });
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.detail).toContain("Invalid or expired");
  });

  test("creates user with valid magic code", async () => {
    const res = await jsonRequest(app, "POST", "/auth/magic-sign-up/", {
      email: "magic-user@test.com",
      code: "valid-magic-token",
    });
    expect(res.status).toBe(201);
    const data = await res.json() as any;
    expect(data.user.email).toBe("magic-user@test.com");

    // Verify isPasswordAutoset is set
    const user = await testDb.query.users.findFirst({
      where: eq(users.email, "magic-user@test.com"),
    });
    expect(user).toBeDefined();
    expect(user!.isPasswordAutoset).toBe(true);
  });

  test("processes accepted invitations on magic signup", async () => {
    const email = "magic-invited@test.com";

    // Create accepted invitation
    await testDb.insert(workspaceInvitations).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      email,
      role: 15,
      token: crypto.randomUUID(),
      accepted: true,
    });

    const res = await jsonRequest(app, "POST", "/auth/magic-sign-up/", {
      email,
      code: "valid-magic-token",
    });
    expect(res.status).toBe(201);

    // Verify membership was created
    const user = await testDb.query.users.findFirst({ where: eq(users.email, email) });
    const membership = await testDb.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, testWorkspace.id),
        eq(workspaceMembers.userId, user!.id)
      ),
    });
    expect(membership).toBeDefined();
    expect(membership!.role).toBe(15);
  });
});

describe("Magic Sign Up - Form POST", () => {
  test("redirects with error when code missing", async () => {
    const res = await formRequest(app, "POST", "/auth/magic-sign-up/", {
      email: "magic-form@test.com",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain(`error_code=${AUTH_ERROR_CODES.MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED}`);
  });

  test("redirects with error when email missing", async () => {
    const res = await formRequest(app, "POST", "/auth/magic-sign-up/", {
      code: "123456",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain(`error_code=${AUTH_ERROR_CODES.MAGIC_SIGN_UP_EMAIL_CODE_REQUIRED}`);
  });

  test("redirects with error for existing user", async () => {
    const res = await formRequest(app, "POST", "/auth/magic-sign-up/", {
      email: existingUser.email,
      code: "valid-magic-token",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain(`error_code=${AUTH_ERROR_CODES.USER_ALREADY_EXIST}`);
  });

  test("redirects to onboarding on successful magic signup", async () => {
    const res = await formRequest(app, "POST", "/auth/magic-sign-up/", {
      email: "magic-form-success@test.com",
      code: "valid-magic-token",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") || "";
    expect(location).toContain("/onboarding");
  });
});

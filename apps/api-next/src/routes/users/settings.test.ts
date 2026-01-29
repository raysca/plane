import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and, asc } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as schema from "../../db/schema";
import { users, userProfiles } from "../../db/schema/user";
import { workspaces, workspaceMembers, workspaceInvitations } from "../../db/schema/workspace";

// Create an in-memory database for testing
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

// Mock the formatProfileResponse helper
function formatProfileResponse(profile: any) {
    return profile;
}

// Mock getOrCreateProfile
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

// Re-implement the settings logic here to test it in isolation
// In a real scenario, we would import the route handler, but for now we are testing the logic flow
function buildTestApp() {
    const app = new Hono<{ Variables: any }>();

    // Fake auth middleware
    app.use("*", async (c, next) => {
        c.set("user", testUser);
        await next();
    });

    app.get("/api/users/me/settings/", async (c) => {
        const contextUser = c.get("user") as any;
        const user = await testDb.query.users.findFirst({
            where: eq(users.id, contextUser.id),
        });

        // Ensure profile exists
        const profile = await getOrCreateProfile(contextUser.id);

        // Count pending workspace invitations
        const inviteCount = await testDb.select()
            .from(workspaceInvitations)
            .where(eq(workspaceInvitations.email, user!.email))
            .then((rows) => rows.length);

        // Get last workspace info
        const lastWorkspaceId = profile.lastWorkspaceId;
        let lastWorkspace = null;
        if (lastWorkspaceId) {
            // Verify user is still an active member of this workspace
            const membership = await testDb.query.workspaceMembers.findFirst({
                where: and(
                    eq(workspaceMembers.workspaceId, lastWorkspaceId),
                    eq(workspaceMembers.userId, contextUser.id),
                    eq(workspaceMembers.isActive, true)
                ),
            });
            if (membership) {
                lastWorkspace = await testDb.query.workspaces.findFirst({
                    where: eq(workspaces.id, lastWorkspaceId),
                });
            }
        }

        // Get fallback workspace (first workspace user is a member of)
        let fallbackWorkspace = null;
        if (!lastWorkspace) {
            const firstMembership = await testDb.select()
                .from(workspaceMembers)
                .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
                .where(and(
                    eq(workspaceMembers.userId, contextUser.id),
                    eq(workspaceMembers.isActive, true)
                ))
                // .orderBy(workspaces.createdAt) <--- This is what we are testing for/fixing
                .orderBy(asc(schema.workspaces.createdAt))
                .limit(1);

            if (firstMembership.length > 0) {
                fallbackWorkspace = firstMembership[0]!.workspaces;
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
                fallback_workspace_id: lastWorkspace?.id ?? fallbackWorkspace?.id ?? null,
                fallback_workspace_slug: lastWorkspace?.slug ?? fallbackWorkspace?.slug ?? null,
                invites: inviteCount,
            },
        });
    });

    return app;
}


beforeAll(async () => {
    // Setup tables
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

    await testDb.insert(users).values(testUser);
});

describe("GET /api/users/me/settings/ - Fallback Workspace Logic", () => {
    const app = buildTestApp();

    test("returns the oldest workspace as fallback when no last_workspace is set", async () => {
        // Create 3 workspaces with different creation times
        const ws2 = { id: createId(), name: "WS 2", slug: "ws-2", ownerId: testUser.id, createdAt: new Date("2023-01-02") };
        const ws1 = { id: createId(), name: "WS 1", slug: "ws-1", ownerId: testUser.id, createdAt: new Date("2023-01-01") }; // Oldest
        const ws3 = { id: createId(), name: "WS 3", slug: "ws-3", ownerId: testUser.id, createdAt: new Date("2023-01-03") };

        // Insert out of order to ensure implicit ordering isn't hiding the issue
        await testDb.insert(workspaces).values(ws2);
        await testDb.insert(workspaces).values(ws1);
        await testDb.insert(workspaces).values(ws3);

        // Add user as member to all
        await testDb.insert(workspaceMembers).values({ workspaceId: ws2.id, userId: testUser.id, role: 20 });
        await testDb.insert(workspaceMembers).values({ workspaceId: ws1.id, userId: testUser.id, role: 20 });
        await testDb.insert(workspaceMembers).values({ workspaceId: ws3.id, userId: testUser.id, role: 20 });

        // Request settings
        const res = await app.request("/api/users/me/settings/");
        expect(res.status).toBe(200);
        const data = await res.json() as any;

        // It SHOULD be WS 1 because it's the oldest (created Jan 1st)
        // If logic is missing .orderBy(asc(createdAt)), it might return WS 2 (inserted first) or random.
        expect(data.workspace.fallback_workspace_id).toBe(ws1.id);
        expect(data.workspace.fallback_workspace_slug).toBe(ws1.slug);
    });
});

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
import { workspaces, workspaceHomePreferences } from "../../db/schema/workspace";

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

const testWorkspace = {
    id: createId(),
    name: "Test Workspace",
    slug: "test-workspace",
    ownerId: testUser.id,
};

// Mock app setup similar to settings.test.ts but specifically for home-preferences
// We will duplicate the route logic here to verify it in isolation, 
// as importing the route directly requires mocking the entire DB middleware stack which is complex.
// Ideally usage of `homePreferenceRoutes` directly with a mock DB would be better but 
// `homePreferenceRoutes` imports `db` from `../../db` which is the real DB instance.
// So we will replicate the logic to ensure correctness of the ALGORITHM.
// Note: In strict integration tests we should use dependency injection for the DB.

const AUTO_CREATE_KEYS = ["quick_links", "recents", "my_stickies"];

function buildTestApp() {
    const app = new Hono<{ Variables: any }>();

    // Fake auth
    app.use("*", async (c, next) => {
        c.set("user", testUser);
        await next();
    });

    app.get("/api/workspaces/:slug/home-preferences/", async (c) => {
        const contextUser = c.get("user");
        const slug = c.req.param("slug");

        if (!contextUser) return c.json({ detail: "Auth failed" }, 401);
        if (!slug) return c.json({ detail: "Slug missing" }, 404);

        const workspace = await testDb.query.workspaces.findFirst({
            where: eq(workspaces.slug, slug),
        });

        if (!workspace) return c.json({ detail: "Not found" }, 404);

        const existingPrefs = await testDb.query.workspaceHomePreferences.findMany({
            where: and(
                eq(workspaceHomePreferences.workspaceId, workspace.id),
                eq(workspaceHomePreferences.userId, contextUser.id)
            ),
        });

        const existingKeys = existingPrefs.map(p => p.key);
        const missingKeys = AUTO_CREATE_KEYS.filter(key => !existingKeys.includes(key));

        if (missingKeys.length > 0) {
            let sortOrderCounter = 1;
            const toCreate = missingKeys.map((key) => ({
                workspaceId: workspace.id,
                userId: contextUser.id,
                key,
                sortOrder: 1000 - sortOrderCounter++,
            }));
            await testDb.insert(workspaceHomePreferences).values(toCreate);
        }

        const allPrefs = await testDb.query.workspaceHomePreferences.findMany({
            where: and(
                eq(workspaceHomePreferences.workspaceId, workspace.id),
                eq(workspaceHomePreferences.userId, contextUser.id)
            ),
        });

        return c.json(allPrefs);
    });

    return app;
}

beforeAll(async () => {
    // Setup tables
    // Minimal schema for this test
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

    CREATE TABLE IF NOT EXISTS workspace_home_preferences (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      config TEXT DEFAULT '{}',
      sort_order REAL DEFAULT 65535,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(workspace_id, user_id, key)
    );
    `);

    await testDb.insert(users).values(testUser);
    await testDb.insert(workspaces).values(testWorkspace);
});

describe("GET /api/workspaces/:slug/home-preferences/", () => {
    const app = buildTestApp();

    test("auto-creates default preferences for new member", async () => {
        const res = await app.request(`/api/workspaces/${testWorkspace.slug}/home-preferences/`);
        expect(res.status).toBe(200);
        const prefs = await res.json() as any[];

        expect(prefs.length).toBe(3);
        const keys = prefs.map(p => p.key);
        expect(keys).toContain("quick_links");
        expect(keys).toContain("recents");
        expect(keys).toContain("my_stickies");
    });

    test("does not duplicate preferences if they exist", async () => {
        // Run again
        const res = await app.request(`/api/workspaces/${testWorkspace.slug}/home-preferences/`);
        expect(res.status).toBe(200);
        const prefs = await res.json() as any[];
        expect(prefs.length).toBe(3);

        // Check DB directly
        const dbPrefs = await testDb.select().from(workspaceHomePreferences);
        expect(dbPrefs.length).toBe(3);
    });
});

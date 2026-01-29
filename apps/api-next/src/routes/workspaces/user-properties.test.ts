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
import { workspaces, workspaceUserProperties } from "../../db/schema/workspace";

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

// Mock app setup
const updateUserPropertiesSchema = z.object({
    filters: z.record(z.string(), z.any()).optional(),
    display_filters: z.record(z.string(), z.any()).optional(),
    display_properties: z.record(z.string(), z.any()).optional(),
    rich_filters: z.record(z.string(), z.any()).optional(),
    navigation_project_limit: z.number().int().optional(),
    navigation_control_preference: z.enum(["ACCORDION", "TABBED"]).optional(),
    product_tour: z.record(z.string(), z.any()).optional(),
});

function buildTestApp() {
    const app = new Hono<{ Variables: any }>();

    // Fake auth
    app.use("*", async (c, next) => {
        c.set("user", testUser);
        await next();
    });

    // GET /api/workspaces/:slug/user-properties/
    app.get("/api/workspaces/:slug/user-properties/", async (c) => {
        const contextUser = c.get("user");
        const slug = c.req.param("slug");

        if (!contextUser) return c.json({ detail: "Authentication required" }, 401);
        if (!slug) return c.json({ detail: "Workspace not found" }, 404);

        const workspace = await testDb.query.workspaces.findFirst({
            where: eq(workspaces.slug, slug),
        });

        if (!workspace) return c.json({ detail: "Workspace not found" }, 404);

        let properties = await testDb.query.workspaceUserProperties.findFirst({
            where: and(
                eq(workspaceUserProperties.workspaceId, workspace.id),
                eq(workspaceUserProperties.userId, contextUser.id)
            ),
        });

        if (!properties) {
            const result = await testDb.insert(workspaceUserProperties).values({
                workspaceId: workspace.id,
                userId: contextUser.id,
            }).returning();
            properties = result[0];
        }

        return c.json({
            id: properties!.id,
            workspace: properties!.workspaceId,
            user: properties!.userId,
            filters: properties!.filters ?? {},
            display_filters: properties!.displayFilters ?? {},
            display_properties: properties!.displayProperties ?? {},
            rich_filters: properties!.richFilters ?? {},
            navigation_project_limit: properties!.navigationProjectLimit ?? 10,
            navigation_control_preference: properties!.navigationControlPreference ?? "ACCORDION",
            product_tour: properties!.productTour ?? {},
        });
    });

    // PATCH /api/workspaces/:slug/user-properties/
    app.patch("/api/workspaces/:slug/user-properties/", zValidator("json", updateUserPropertiesSchema), async (c) => {
        const contextUser = c.get("user");
        const slug = c.req.param("slug");
        const body = c.req.valid("json");

        const workspace = await testDb.query.workspaces.findFirst({
            where: eq(workspaces.slug, slug),
        });

        if (!workspace) return c.json({ detail: "Workspace not found" }, 404);

        let properties = await testDb.query.workspaceUserProperties.findFirst({
            where: and(
                eq(workspaceUserProperties.workspaceId, workspace.id),
                eq(workspaceUserProperties.userId, contextUser.id)
            ),
        });

        if (!properties) {
            const result = await testDb.insert(workspaceUserProperties).values({
                workspaceId: workspace.id,
                userId: contextUser.id,
            }).returning();
            properties = result[0];
        }

        const updateData: any = {
            updatedAt: new Date(),
        };

        if (body.filters !== undefined) updateData.filters = body.filters;
        if (body.display_filters !== undefined) updateData.displayFilters = body.display_filters;
        if (body.display_properties !== undefined) updateData.displayProperties = body.display_properties;
        if (body.rich_filters !== undefined) updateData.richFilters = body.rich_filters;
        if (body.navigation_project_limit !== undefined) updateData.navigationProjectLimit = body.navigation_project_limit;
        if (body.navigation_control_preference !== undefined) updateData.navigationControlPreference = body.navigation_control_preference;
        if (body.product_tour !== undefined) updateData.productTour = body.product_tour;

        await testDb.update(workspaceUserProperties)
            .set(updateData)
            .where(eq(workspaceUserProperties.id, properties!.id));

        const updatedProperties = await testDb.query.workspaceUserProperties.findFirst({
            where: eq(workspaceUserProperties.id, properties!.id),
        });

        return c.json({
            id: updatedProperties!.id,
            filters: updatedProperties!.filters ?? {},
            navigation_project_limit: updatedProperties!.navigationProjectLimit,
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

    CREATE TABLE IF NOT EXISTS workspace_user_properties (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      filters TEXT DEFAULT '{}',
      display_filters TEXT DEFAULT '{}',
      display_properties TEXT DEFAULT '{}',
      rich_filters TEXT DEFAULT '{}',
      navigation_project_limit INTEGER DEFAULT 10,
      navigation_control_preference TEXT DEFAULT 'ACCORDION',
      product_tour TEXT DEFAULT '{}',
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(workspace_id, user_id)
    );
    `);

    await testDb.insert(users).values(testUser);
    await testDb.insert(workspaces).values(testWorkspace);
});

describe("API /api/workspaces/:slug/user-properties/", () => {
    const app = buildTestApp();

    test("GET - auto-creates default properties", async () => {
        const res = await app.request(`/api/workspaces/${testWorkspace.slug}/user-properties/`);
        expect(res.status).toBe(200);
        const props = await res.json() as any;

        expect(props.navigation_project_limit).toBe(10);
        expect(props.navigation_control_preference).toBe("ACCORDION");
        // Check default filter structure existence (simplified check)
        // Since we insert with just values({}) in logic, defaults come from schema.
        // In this mock test, schema defaults apply?
        // SQLite: defaults apply if not provided.
    });

    test("PATCH - updates properties", async () => {
        const payload = {
            navigation_project_limit: 20,
            filters: { priority: ["high"] }
        };

        const res = await app.request(`/api/workspaces/${testWorkspace.slug}/user-properties/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        expect(res.status).toBe(200);
        const props = await res.json() as any;
        expect(props.navigation_project_limit).toBe(20);
        expect(props.filters).toEqual({ priority: ["high"] });

        // Verify persistence
        const getRes = await app.request(`/api/workspaces/${testWorkspace.slug}/user-properties/`);
        const getProps = await getRes.json() as any;
        expect(getProps.navigation_project_limit).toBe(20);
    });
});

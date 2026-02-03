import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and, desc, isNull, max } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as schema from "../../db/schema";
import { users } from "../../db/schema/user";
import { workspaces, favorites } from "../../db/schema/workspace";
import { projects } from "../../db/schema/project";

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

const testProject = {
  id: createId(),
  workspaceId: testWorkspace.id,
  name: "Test Project",
  identifier: "TST",
};

const createFavoriteSchema = z.object({
  entity_type: z.string().min(1),
  entity_identifier: z.string().optional().nullable(),
  name: z.string().max(255).optional().nullable(),
  is_folder: z.boolean().optional(),
  parent: z.string().optional().nullable(),
  project_id: z.string().optional().nullable(),
  sequence: z.number().optional(),
});

const updateFavoriteSchema = z.object({
  name: z.string().max(255).optional().nullable(),
  parent: z.string().optional().nullable(),
  sequence: z.number().optional(),
  is_folder: z.boolean().optional(),
  sort_order: z.number().optional(),
});

async function formatFavoriteResponse(fav: typeof favorites.$inferSelect) {
  // Simplified entity data lookup for tests (project only)
  let entityData: Record<string, unknown> | null = null;
  if (fav.entityType === "project" && fav.entityId) {
    const project = await testDb.query.projects.findFirst({
      where: eq(projects.id, fav.entityId),
    });
    if (project) {
      entityData = {
        id: project.id,
        name: project.name,
        logo_props: project.iconProp ?? {},
      };
    }
  }

  return {
    id: fav.id,
    entity_type: fav.entityType,
    entity_identifier: fav.entityId ?? null,
    entity_data: entityData,
    name: fav.name ?? "",
    is_folder: fav.isFolder ?? false,
    sequence: fav.sequence ?? 65535,
    parent: fav.parentId ?? null,
    workspace_id: fav.workspaceId,
    project_id: fav.projectId ?? null,
  };
}

function buildTestApp() {
  const app = new Hono<{ Variables: any }>();

  app.use("*", async (c, next) => {
    c.set("user", testUser);
    c.set("workspace", testWorkspace);
    await next();
  });

  // LIST
  app.get("/api/workspaces/:slug/user-favorites/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");

    const userFavorites = await testDb
      .select()
      .from(favorites)
      .where(
        and(
          eq(favorites.userId, user.id),
          eq(favorites.workspaceId, workspace.id),
          isNull(favorites.parentId)
        )
      )
      .orderBy(desc(favorites.createdAt));

    const results = await Promise.all(
      userFavorites.map((fav) => formatFavoriteResponse(fav))
    );
    return c.json(results);
  });

  // CREATE
  app.post(
    "/api/workspaces/:slug/user-favorites/",
    zValidator("json", createFavoriteSchema),
    async (c) => {
      const user = c.get("user");
      const workspace = c.get("workspace");
      const body = c.req.valid("json");

      if (body.entity_identifier) {
        const existing = await testDb.query.favorites.findFirst({
          where: and(
            eq(favorites.workspaceId, workspace.id),
            eq(favorites.userId, user.id),
            eq(favorites.entityType, body.entity_type),
            eq(favorites.entityId, body.entity_identifier)
          ),
        });
        if (existing) {
          return c.json(await formatFavoriteResponse(existing));
        }
      }

      const maxSeqResult = await testDb
        .select({ maxSeq: max(favorites.sequence) })
        .from(favorites)
        .where(eq(favorites.workspaceId, workspace.id));
      const maxSeq = maxSeqResult[0]?.maxSeq ?? 65535;
      const newSequence = body.sequence ?? (typeof maxSeq === "number" ? maxSeq + 10000 : 75535);

      const result = await testDb
        .insert(favorites)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          projectId: body.project_id ?? null,
          entityType: body.entity_type,
          entityId: body.entity_identifier ?? null,
          name: body.name ?? null,
          isFolder: body.is_folder ?? false,
          sequence: newSequence,
          parentId: body.parent ?? null,
        })
        .returning();

      return c.json(await formatFavoriteResponse(result[0]!));
    }
  );

  // PATCH
  app.patch(
    "/api/workspaces/:slug/user-favorites/:id/",
    zValidator("json", updateFavoriteSchema),
    async (c) => {
      const user = c.get("user");
      const workspace = c.get("workspace");
      const favoriteId = c.req.param("id");
      const body = c.req.valid("json");

      const existing = await testDb.query.favorites.findFirst({
        where: and(
          eq(favorites.id, favoriteId),
          eq(favorites.userId, user.id),
          eq(favorites.workspaceId, workspace.id)
        ),
      });
      if (!existing) return c.json({ detail: "Favorite not found." }, 404);

      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) updateData.name = body.name;
      if (body.parent !== undefined) updateData.parentId = body.parent;
      if (body.sequence !== undefined) updateData.sequence = body.sequence;
      if (body.is_folder !== undefined) updateData.isFolder = body.is_folder;
      if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

      if (Object.keys(updateData).length > 0) {
        await testDb.update(favorites).set(updateData).where(eq(favorites.id, favoriteId));
      }

      const updated = await testDb.query.favorites.findFirst({
        where: eq(favorites.id, favoriteId),
      });
      return c.json(await formatFavoriteResponse(updated!));
    }
  );

  // DELETE
  app.delete("/api/workspaces/:slug/user-favorites/:id/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    const favoriteId = c.req.param("id");

    const existing = await testDb.query.favorites.findFirst({
      where: and(
        eq(favorites.id, favoriteId),
        eq(favorites.userId, user.id),
        eq(favorites.workspaceId, workspace.id)
      ),
    });
    if (!existing) return c.json({ detail: "Favorite not found." }, 404);

    await testDb.delete(favorites).where(eq(favorites.parentId, favoriteId));
    await testDb.delete(favorites).where(eq(favorites.id, favoriteId));
    return new Response(null, { status: 204 });
  });

  // GROUP
  app.get("/api/workspaces/:slug/user-favorites/:id/group/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    const favoriteId = c.req.param("id");

    const children = await testDb
      .select()
      .from(favorites)
      .where(
        and(
          eq(favorites.userId, user.id),
          eq(favorites.workspaceId, workspace.id),
          eq(favorites.parentId, favoriteId)
        )
      )
      .orderBy(desc(favorites.createdAt));

    const results = await Promise.all(
      children.map((fav) => formatFavoriteResponse(fav))
    );
    return c.json(results);
  });

  return app;
}

beforeAll(async () => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER DEFAULT 0,
      name TEXT,
      image TEXT,
      username TEXT,
      display_name TEXT,
      avatar TEXT,
      cover_image TEXT,
      first_name TEXT,
      last_name TEXT,
      is_active INTEGER DEFAULT 1,
      is_password_autoset INTEGER DEFAULT 0,
      last_login_at INTEGER,
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

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      description_text TEXT,
      description_html TEXT,
      network INTEGER DEFAULT 2,
      identifier TEXT NOT NULL,
      emoji TEXT,
      icon_prop TEXT,
      cover_image TEXT,
      archive_in INTEGER DEFAULT 0,
      close_in INTEGER DEFAULT 0,
      default_assignee_id TEXT,
      default_state_id TEXT,
      project_lead_id TEXT,
      estimate_id TEXT,
      sort_order REAL DEFAULT 65535,
      created_by_id TEXT,
      logo_props TEXT,
      cycle_view INTEGER DEFAULT 1,
      module_view INTEGER DEFAULT 1,
      issue_views_view INTEGER DEFAULT 1,
      page_view INTEGER DEFAULT 1,
      intake_view INTEGER DEFAULT 0,
      guest_view_all_features INTEGER DEFAULT 0,
      is_time_tracking_enabled INTEGER DEFAULT 0,
      is_issue_type_enabled INTEGER DEFAULT 0,
      archived_at INTEGER,
      is_member_added INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER,
      deleted_at INTEGER,
      UNIQUE(workspace_id, identifier)
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      name TEXT,
      is_folder INTEGER DEFAULT 0,
      sequence REAL DEFAULT 65535,
      parent_id TEXT,
      sort_order REAL DEFAULT 65535,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS favorite_user_workspace_idx ON favorites (user_id, workspace_id);
    CREATE INDEX IF NOT EXISTS favorite_entity_idx ON favorites (entity_type, entity_id);
  `);

  await testDb.insert(users).values(testUser);
  await testDb.insert(workspaces).values(testWorkspace);
  await testDb.insert(projects).values(testProject);
});

describe("Favorites CRUD", () => {
  const app = buildTestApp();
  let createdFavoriteId: string;
  let folderId: string;

  test("GET /user-favorites/ returns empty list initially", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("POST /user-favorites/ creates a project favorite", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "project",
          entity_identifier: testProject.id,
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entity_type).toBe("project");
    expect(body.entity_identifier).toBe(testProject.id);
    expect(body.entity_data).not.toBeNull();
    expect(body.entity_data.name).toBe("Test Project");
    expect(body.is_folder).toBe(false);
    expect(body.workspace_id).toBe(testWorkspace.id);
    createdFavoriteId = body.id;
  });

  test("POST /user-favorites/ returns existing if duplicate", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "project",
          entity_identifier: testProject.id,
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(createdFavoriteId);
  });

  test("POST /user-favorites/ creates a folder", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "folder",
          name: "My Folder",
          is_folder: true,
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.entity_type).toBe("folder");
    expect(body.is_folder).toBe(true);
    expect(body.name).toBe("My Folder");
    folderId = body.id;
  });

  test("POST /user-favorites/ auto-increments sequence", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "cycle",
          entity_identifier: createId(),
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Should be larger than the previous favorites' sequence
    expect(body.sequence).toBeGreaterThan(65535);
  });

  test("GET /user-favorites/ returns top-level favorites only", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    // All should have no parent
    for (const fav of body) {
      expect(fav.parent).toBeNull();
    }
    expect(body.length).toBe(3);
  });

  test("PATCH /user-favorites/:id/ moves favorite into folder", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/${createdFavoriteId}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: folderId }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.parent).toBe(folderId);
  });

  test("GET /user-favorites/:id/group/ returns folder children", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/${folderId}/group/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(createdFavoriteId);
    expect(body[0].entity_type).toBe("project");
  });

  test("PATCH /user-favorites/:id/ updates sequence", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/${createdFavoriteId}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequence: 100 }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.sequence).toBe(100);
  });

  test("PATCH /user-favorites/:id/ returns 404 for non-existent", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/nonexistent/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nope" }),
      }
    );
    expect(res.status).toBe(404);
  });

  test("DELETE /user-favorites/:id/ deletes a favorite", async () => {
    // Remove from folder first
    await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/${createdFavoriteId}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: null }),
      }
    );

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/${createdFavoriteId}/`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(204);
  });

  test("DELETE /user-favorites/:id/ deletes folder and children", async () => {
    // Add a child to the folder
    const childRes = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity_type: "module",
          entity_identifier: createId(),
          parent: folderId,
        }),
      }
    );
    expect(childRes.status).toBe(200);

    // Delete the folder
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/${folderId}/`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(204);

    // Children should also be deleted
    const groupRes = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/${folderId}/group/`
    );
    const body = (await groupRes.json()) as any[];
    expect(body.length).toBe(0);
  });

  test("DELETE /user-favorites/:id/ returns 404 for non-existent", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/user-favorites/nonexistent/`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(404);
  });
});

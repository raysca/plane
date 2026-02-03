import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and, desc, not } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as schema from "../../db/schema";
import { users } from "../../db/schema/user";
import { workspaces, quickLinks } from "../../db/schema/workspace";

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

// Replicate the route logic for isolated testing

const createQuickLinkSchema = z.object({
  title: z.string().max(255).optional().nullable(),
  url: z.string().min(1),
  metadata: z.any().optional(),
});

const updateQuickLinkSchema = z.object({
  title: z.string().max(255).optional().nullable(),
  url: z.string().min(1).optional(),
  metadata: z.any().optional(),
});

function normalizeUrl(url: string): string {
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    return "http://" + url;
  }
  return url;
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function formatQuickLinkResponse(
  link: typeof quickLinks.$inferSelect,
  workspaceSlug: string
) {
  return {
    id: link.id,
    title: link.name ?? "",
    url: link.url,
    metadata: link.description ? { description: link.description } : {},
    created_by_id: link.userId,
    workspace_slug: workspaceSlug,
    created_at: link.createdAt?.toISOString() ?? null,
    sort_order: link.sortOrder ?? 65535,
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
  app.get("/api/workspaces/:slug/quick-links/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");

    const links = await testDb
      .select()
      .from(quickLinks)
      .where(
        and(
          eq(quickLinks.workspaceId, workspace.id),
          eq(quickLinks.userId, user.id)
        )
      )
      .orderBy(desc(quickLinks.createdAt));

    return c.json(
      links.map((link) => formatQuickLinkResponse(link, workspace.slug))
    );
  });

  // CREATE
  app.post(
    "/api/workspaces/:slug/quick-links/",
    zValidator("json", createQuickLinkSchema),
    async (c) => {
      const user = c.get("user");
      const workspace = c.get("workspace");
      const body = c.req.valid("json");

      const url = normalizeUrl(body.url);

      if (!isValidUrl(url)) {
        return c.json({ url: ["Invalid URL format."] }, 400);
      }

      const existing = await testDb.query.quickLinks.findFirst({
        where: and(
          eq(quickLinks.url, url),
          eq(quickLinks.workspaceId, workspace.id),
          eq(quickLinks.userId, user.id)
        ),
      });

      if (existing) {
        return c.json(
          { error: "URL already exists for this workspace and owner" },
          400
        );
      }

      const result = await testDb
        .insert(quickLinks)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          name: body.title ?? "",
          url,
          description: body.metadata
            ? JSON.stringify(body.metadata)
            : null,
        })
        .returning();

      return c.json(
        formatQuickLinkResponse(result[0]!, workspace.slug),
        201
      );
    }
  );

  // RETRIEVE
  app.get("/api/workspaces/:slug/quick-links/:id/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    const linkId = c.req.param("id");

    const link = await testDb.query.quickLinks.findFirst({
      where: and(
        eq(quickLinks.id, linkId),
        eq(quickLinks.workspaceId, workspace.id),
        eq(quickLinks.userId, user.id)
      ),
    });

    if (!link) return c.json({ error: "Quick link not found." }, 404);

    return c.json(formatQuickLinkResponse(link, workspace.slug));
  });

  // UPDATE
  app.patch(
    "/api/workspaces/:slug/quick-links/:id/",
    zValidator("json", updateQuickLinkSchema),
    async (c) => {
      const user = c.get("user");
      const workspace = c.get("workspace");
      const linkId = c.req.param("id");
      const body = c.req.valid("json");

      const existing = await testDb.query.quickLinks.findFirst({
        where: and(
          eq(quickLinks.id, linkId),
          eq(quickLinks.workspaceId, workspace.id),
          eq(quickLinks.userId, user.id)
        ),
      });

      if (!existing) return c.json({ detail: "Quick link not found." }, 404);

      let url = body.url;
      if (url !== undefined) {
        url = normalizeUrl(url);
        if (!isValidUrl(url)) {
          return c.json({ url: ["Invalid URL format."] }, 400);
        }

        const duplicate = await testDb.query.quickLinks.findFirst({
          where: and(
            eq(quickLinks.url, url),
            eq(quickLinks.workspaceId, workspace.id),
            eq(quickLinks.userId, user.id),
            not(eq(quickLinks.id, linkId))
          ),
        });

        if (duplicate) {
          return c.json(
            { error: "URL already exists for this workspace and owner" },
            400
          );
        }
      }

      const updateData: Record<string, unknown> = {};
      if (body.title !== undefined) updateData.name = body.title ?? "";
      if (url !== undefined) updateData.url = url;
      if (body.metadata !== undefined) {
        updateData.description = body.metadata
          ? JSON.stringify(body.metadata)
          : null;
      }

      if (Object.keys(updateData).length > 0) {
        await testDb
          .update(quickLinks)
          .set(updateData)
          .where(eq(quickLinks.id, linkId));
      }

      const updated = await testDb.query.quickLinks.findFirst({
        where: eq(quickLinks.id, linkId),
      });

      return c.json(formatQuickLinkResponse(updated!, workspace.slug));
    }
  );

  // DELETE
  app.delete("/api/workspaces/:slug/quick-links/:id/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    const linkId = c.req.param("id");

    const link = await testDb.query.quickLinks.findFirst({
      where: and(
        eq(quickLinks.id, linkId),
        eq(quickLinks.workspaceId, workspace.id),
        eq(quickLinks.userId, user.id)
      ),
    });

    if (!link) return c.json({ detail: "Quick link not found." }, 404);

    await testDb.delete(quickLinks).where(eq(quickLinks.id, linkId));

    return new Response(null, { status: 204 });
  });

  return app;
}

// Create tables
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

    CREATE TABLE IF NOT EXISTS quick_links (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      description TEXT,
      sort_order REAL DEFAULT 65535,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS quick_link_user_workspace_idx ON quick_links (user_id, workspace_id);
  `);

  await testDb.insert(users).values(testUser);
  await testDb.insert(workspaces).values(testWorkspace);
});

describe("Quick Links CRUD", () => {
  const app = buildTestApp();
  let createdLinkId: string;

  test("GET /quick-links/ returns empty list initially", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("POST /quick-links/ creates a quick link", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Plane Docs",
          url: "https://docs.plane.so",
        }),
      }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Plane Docs");
    expect(body.url).toBe("https://docs.plane.so");
    expect(body.created_by_id).toBe(testUser.id);
    expect(body.workspace_slug).toBe(testWorkspace.slug);
    expect(body.id).toBeDefined();
    createdLinkId = body.id;
  });

  test("POST /quick-links/ auto-prefixes http:// if missing", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Example",
          url: "example.com",
        }),
      }
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toBe("http://example.com");
  });

  test("POST /quick-links/ rejects duplicate URL", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Duplicate",
          url: "https://docs.plane.so",
        }),
      }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });

  test("POST /quick-links/ rejects invalid URL", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Bad",
          url: "not a valid url",
        }),
      }
    );
    expect(res.status).toBe(400);
  });

  test("GET /quick-links/ returns created links", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(2);
  });

  test("GET /quick-links/:id/ retrieves a specific link", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/${createdLinkId}/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(createdLinkId);
    expect(body.title).toBe("Plane Docs");
  });

  test("GET /quick-links/:id/ returns 404 for non-existent link", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/nonexistent/`
    );
    expect(res.status).toBe(404);
  });

  test("PATCH /quick-links/:id/ updates title", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/${createdLinkId}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated Docs" }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Updated Docs");
    expect(body.url).toBe("https://docs.plane.so");
  });

  test("PATCH /quick-links/:id/ updates URL with normalization", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/${createdLinkId}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "plane.so/docs" }),
      }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("http://plane.so/docs");
  });

  test("PATCH /quick-links/:id/ rejects duplicate URL on update", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/${createdLinkId}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://example.com" }),
      }
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });

  test("PATCH /quick-links/:id/ returns 404 for non-existent link", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/nonexistent/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Nope" }),
      }
    );
    expect(res.status).toBe(404);
  });

  test("DELETE /quick-links/:id/ removes a link", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/${createdLinkId}/`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(204);

    // Confirm it's gone
    const getRes = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/${createdLinkId}/`
    );
    expect(getRes.status).toBe(404);
  });

  test("DELETE /quick-links/:id/ returns 404 for non-existent link", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/quick-links/nonexistent/`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(404);
  });
});

import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and, desc, like, count, lt } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import * as schema from "../../db/schema";
import { users } from "../../db/schema/user";
import { workspaces, stickies } from "../../db/schema/workspace";

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

const createStickySchema = z.object({
  name: z.string().optional().nullable(),
  description: z.any().optional(),
  description_html: z.string().optional(),
  description_binary: z.string().optional().nullable(),
  logo_props: z.any().optional(),
  color: z.string().max(255).optional().nullable(),
  background_color: z.string().max(255).optional().nullable(),
  sort_order: z.number().optional(),
});

const updateStickySchema = createStickySchema;

function formatStickyResponse(sticky: typeof stickies.$inferSelect) {
  return {
    id: sticky.id,
    name: sticky.name ?? "",
    description: sticky.description ?? {},
    description_html: sticky.descriptionHtml ?? "<p></p>",
    description_stripped: sticky.descriptionStripped ?? "",
    description_binary: sticky.descriptionBinary ?? null,
    logo_props: sticky.logoProps ?? {},
    color: sticky.color ?? null,
    background_color: sticky.backgroundColor ?? null,
    sort_order: sticky.sortOrder ?? 65535,
    workspace: sticky.workspaceId,
    created_by: sticky.userId,
    updated_by: sticky.userId,
    created_at: sticky.createdAt?.toISOString() ?? null,
    updated_at: sticky.updatedAt?.toISOString() ?? null,
  };
}

function buildTestApp() {
  const app = new Hono<{ Variables: any }>();

  app.use("*", async (c, next) => {
    c.set("user", testUser);
    c.set("workspace", testWorkspace);
    await next();
  });

  // LIST with cursor pagination
  app.get("/api/workspaces/:slug/stickies/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");

    const query = c.req.query("query");
    const perPageParam = c.req.query("per_page");
    const cursor = c.req.query("cursor");
    const perPage = Math.min(Math.max(parseInt(perPageParam || "20", 10) || 20, 1), 100);

    const conditions: any[] = [
      eq(stickies.workspaceId, workspace.id),
      eq(stickies.userId, user.id),
    ];

    if (query) {
      conditions.push(like(stickies.descriptionStripped, `%${query}%`));
    }

    if (cursor) {
      const cursorValue = parseFloat(cursor);
      if (!isNaN(cursorValue)) {
        conditions.push(lt(stickies.sortOrder, cursorValue));
      }
    }

    const baseConditions: any[] = [
      eq(stickies.workspaceId, workspace.id),
      eq(stickies.userId, user.id),
    ];
    if (query) {
      baseConditions.push(like(stickies.descriptionStripped, `%${query}%`));
    }

    const totalResult = await testDb
      .select({ total: count() })
      .from(stickies)
      .where(and(...baseConditions));
    const totalCount = Number(totalResult[0]?.total ?? 0);

    const results = await testDb
      .select()
      .from(stickies)
      .where(and(...conditions))
      .orderBy(desc(stickies.sortOrder))
      .limit(perPage + 1);

    const hasNext = results.length > perPage;
    const pageResults = results.slice(0, perPage);
    const nextCursor = hasNext && pageResults.length > 0
      ? String(pageResults[pageResults.length - 1]!.sortOrder)
      : null;

    return c.json({
      next_cursor: nextCursor,
      prev_cursor: cursor ?? null,
      next_page_results: hasNext,
      prev_page_results: !!cursor,
      total_pages: Math.ceil(totalCount / perPage),
      total_count: totalCount,
      results: pageResults.map(formatStickyResponse),
    });
  });

  // CREATE
  app.post(
    "/api/workspaces/:slug/stickies/",
    zValidator("json", createStickySchema),
    async (c) => {
      const user = c.get("user");
      const workspace = c.get("workspace");
      const body = c.req.valid("json");

      const result = await testDb
        .insert(stickies)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          name: body.name ?? null,
          description: body.description ?? {},
          descriptionHtml: body.description_html ?? "<p></p>",
          descriptionStripped: typeof body.description_html === "string"
            ? body.description_html.replace(/<[^>]*>/g, "").trim()
            : null,
          descriptionBinary: body.description_binary ?? null,
          logoProps: body.logo_props ?? {},
          color: body.color ?? null,
          backgroundColor: body.background_color ?? null,
          sortOrder: body.sort_order ?? 65535,
        })
        .returning();

      return c.json(formatStickyResponse(result[0]!), 201);
    }
  );

  // RETRIEVE
  app.get("/api/workspaces/:slug/stickies/:id/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    const stickyId = c.req.param("id");

    const sticky = await testDb.query.stickies.findFirst({
      where: and(
        eq(stickies.id, stickyId),
        eq(stickies.workspaceId, workspace.id),
        eq(stickies.userId, user.id)
      ),
    });

    if (!sticky) return c.json({ detail: "Sticky not found." }, 404);
    return c.json(formatStickyResponse(sticky));
  });

  // UPDATE
  app.patch(
    "/api/workspaces/:slug/stickies/:id/",
    zValidator("json", updateStickySchema),
    async (c) => {
      const user = c.get("user");
      const workspace = c.get("workspace");
      const stickyId = c.req.param("id");
      const body = c.req.valid("json");

      const existing = await testDb.query.stickies.findFirst({
        where: and(
          eq(stickies.id, stickyId),
          eq(stickies.workspaceId, workspace.id),
          eq(stickies.userId, user.id)
        ),
      });

      if (!existing) return c.json({ detail: "Sticky not found." }, 404);

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (body.name !== undefined) updateData.name = body.name;
      if (body.description !== undefined) updateData.description = body.description;
      if (body.description_html !== undefined) {
        updateData.descriptionHtml = body.description_html;
        updateData.descriptionStripped = body.description_html.replace(/<[^>]*>/g, "").trim();
      }
      if (body.description_binary !== undefined) updateData.descriptionBinary = body.description_binary;
      if (body.logo_props !== undefined) updateData.logoProps = body.logo_props;
      if (body.color !== undefined) updateData.color = body.color;
      if (body.background_color !== undefined) updateData.backgroundColor = body.background_color;
      if (body.sort_order !== undefined) updateData.sortOrder = body.sort_order;

      await testDb.update(stickies).set(updateData).where(eq(stickies.id, stickyId));

      const updated = await testDb.query.stickies.findFirst({
        where: eq(stickies.id, stickyId),
      });

      return c.json(formatStickyResponse(updated!));
    }
  );

  // DELETE
  app.delete("/api/workspaces/:slug/stickies/:id/", async (c) => {
    const user = c.get("user");
    const workspace = c.get("workspace");
    const stickyId = c.req.param("id");

    const sticky = await testDb.query.stickies.findFirst({
      where: and(
        eq(stickies.id, stickyId),
        eq(stickies.workspaceId, workspace.id),
        eq(stickies.userId, user.id)
      ),
    });

    if (!sticky) return c.json({ detail: "Sticky not found." }, 404);
    await testDb.delete(stickies).where(eq(stickies.id, stickyId));
    return new Response(null, { status: 204 });
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

    CREATE TABLE IF NOT EXISTS stickies (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      description TEXT,
      description_html TEXT DEFAULT '<p></p>',
      description_stripped TEXT,
      description_binary TEXT,
      logo_props TEXT,
      color TEXT,
      background_color TEXT,
      sort_order REAL DEFAULT 65535,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS sticky_user_workspace_idx ON stickies (user_id, workspace_id);
  `);

  await testDb.insert(users).values(testUser);
  await testDb.insert(workspaces).values(testWorkspace);
});

describe("Stickies CRUD", () => {
  const app = buildTestApp();
  let createdStickyId: string;

  test("GET /stickies/ returns empty paginated result initially", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results).toEqual([]);
    expect(body.total_count).toBe(0);
    expect(body.next_page_results).toBe(false);
  });

  test("POST /stickies/ creates a sticky", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Sticky",
          description_html: "<p>Hello world</p>",
          color: "#FF0000",
          background_color: "#FEF3C7",
          sort_order: 50000,
        }),
      }
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("My Sticky");
    expect(body.description_html).toBe("<p>Hello world</p>");
    expect(body.description_stripped).toBe("Hello world");
    expect(body.color).toBe("#FF0000");
    expect(body.background_color).toBe("#FEF3C7");
    expect(body.sort_order).toBe(50000);
    expect(body.workspace).toBe(testWorkspace.id);
    expect(body.created_by).toBe(testUser.id);
    createdStickyId = body.id;
  });

  test("POST /stickies/ creates with defaults for missing fields", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("");
    expect(body.description_html).toBe("<p></p>");
    expect(body.sort_order).toBe(65535);
  });

  test("GET /stickies/ returns created stickies with pagination", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results.length).toBe(2);
    expect(body.total_count).toBe(2);
    // Ordered by sort_order desc, so 65535 comes first
    expect(body.results[0].sort_order).toBe(65535);
    expect(body.results[1].sort_order).toBe(50000);
  });

  test("GET /stickies/:id/ retrieves a specific sticky", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/${createdStickyId}/`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(createdStickyId);
    expect(body.name).toBe("My Sticky");
  });

  test("GET /stickies/:id/ returns 404 for non-existent sticky", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/nonexistent/`
    );
    expect(res.status).toBe(404);
  });

  test("PATCH /stickies/:id/ updates a sticky", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/${createdStickyId}/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Sticky",
          description_html: "<p>Updated content</p>",
          background_color: "#E0F2FE",
        }),
      }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Updated Sticky");
    expect(body.description_html).toBe("<p>Updated content</p>");
    expect(body.description_stripped).toBe("Updated content");
    expect(body.background_color).toBe("#E0F2FE");
    // color should remain unchanged
    expect(body.color).toBe("#FF0000");
  });

  test("PATCH /stickies/:id/ returns 404 for non-existent sticky", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/nonexistent/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Nope" }),
      }
    );
    expect(res.status).toBe(404);
  });

  test("GET /stickies/?query= filters by description content", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/?query=Updated`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results.length).toBe(1);
    expect(body.results[0].name).toBe("Updated Sticky");
  });

  test("DELETE /stickies/:id/ removes a sticky", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/${createdStickyId}/`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(204);

    // Confirm gone
    const getRes = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/${createdStickyId}/`
    );
    expect(getRes.status).toBe(404);
  });

  test("DELETE /stickies/:id/ returns 404 for non-existent sticky", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/nonexistent/`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(404);
  });

  test("pagination works with per_page and cursor", async () => {
    // Create 5 stickies with distinct sort_orders
    for (let i = 0; i < 5; i++) {
      await testDb.insert(stickies).values({
        workspaceId: testWorkspace.id,
        userId: testUser.id,
        name: `Paginated ${i}`,
        descriptionStripped: `paginated ${i}`,
        sortOrder: 10000 + i * 1000,
      });
    }

    // Get first page of 3
    const res1 = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/?per_page=3`
    );
    expect(res1.status).toBe(200);
    const page1 = (await res1.json()) as any;
    expect(page1.results.length).toBe(3);
    expect(page1.next_page_results).toBe(true);
    expect(page1.next_cursor).toBeDefined();

    // Get second page using cursor
    const res2 = await app.request(
      `/api/workspaces/${testWorkspace.slug}/stickies/?per_page=3&cursor=${page1.next_cursor}`
    );
    expect(res2.status).toBe(200);
    const page2 = (await res2.json()) as any;
    // Should get remaining stickies (the default one + some paginated ones)
    expect(page2.results.length).toBeGreaterThan(0);
    expect(page2.prev_page_results).toBe(true);

    // Ensure no overlap between pages
    const page1Ids = page1.results.map((r: any) => r.id);
    const page2Ids = page2.results.map((r: any) => r.id);
    for (const id of page2Ids) {
      expect(page1Ids).not.toContain(id);
    }
  });
});

import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and, isNull, not, like, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as schema from "../../db/schema";
import { users } from "../../db/schema/user";
import { workspaces } from "../../db/schema/workspace";
import { notifications } from "../../db/schema/notification";

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

function buildTestApp() {
  const app = new Hono<{ Variables: any }>();

  // Fake auth middleware
  app.use("*", async (c, next) => {
    c.set("user", testUser);
    await next();
  });

  // Replicate the unread notifications endpoint logic
  app.get("/api/workspaces/:slug/users/notifications/unread/", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ detail: "Authentication required." }, 401);

    const slug = c.req.param("slug");
    const workspace = await testDb.query.workspaces.findFirst({
      where: eq(workspaces.slug, slug),
    });

    if (!workspace) return c.json({ detail: "Workspace not found." }, 404);

    // Count unread notifications excluding mentions
    const unreadResult = await testDb
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, workspace.id),
          eq(notifications.receiverId, user.id),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
          isNull(notifications.snoozedTill),
          not(like(notifications.sender, "%mentioned%"))
        )
      );

    // Count unread mention notifications
    const mentionResult = await testDb
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, workspace.id),
          eq(notifications.receiverId, user.id),
          isNull(notifications.readAt),
          isNull(notifications.archivedAt),
          isNull(notifications.snoozedTill),
          like(notifications.sender, "%mentioned%")
        )
      );

    return c.json({
      total_unread_notifications_count: Number(unreadResult[0]?.count ?? 0),
      mention_unread_notifications_count: Number(mentionResult[0]?.count ?? 0),
    });
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

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      identifier TEXT NOT NULL,
      description TEXT,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      default_assignee_id TEXT,
      project_lead_id TEXT,
      network INTEGER DEFAULT 2,
      emoji TEXT,
      icon_prop TEXT,
      module_view INTEGER DEFAULT 1,
      cycle_view INTEGER DEFAULT 1,
      issue_views_view INTEGER DEFAULT 1,
      page_view INTEGER DEFAULT 1,
      inbox_view INTEGER DEFAULT 0,
      cover_image TEXT,
      archive_in INTEGER DEFAULT 0,
      close_in INTEGER DEFAULT 0,
      default_state_id TEXT,
      group_by TEXT,
      order_by TEXT,
      logo_props TEXT,
      is_member_added_by_default INTEGER DEFAULT 1,
      guest_view_all_features INTEGER DEFAULT 1,
      is_deployed INTEGER DEFAULT 0,
      sort_order REAL DEFAULT 65535,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      triggered_by_id TEXT REFERENCES users(id),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      entity_name TEXT,
      title TEXT NOT NULL,
      message TEXT,
      message_html TEXT,
      message_stripped TEXT,
      sender TEXT NOT NULL DEFAULT '',
      data TEXT,
      read_at INTEGER,
      archived_at INTEGER,
      snoozed_till INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  // Seed test data
  await testDb.insert(users).values(testUser);
  await testDb.insert(workspaces).values(testWorkspace);
});

describe("GET /api/workspaces/:slug/users/notifications/unread/", () => {
  const app = buildTestApp();

  test("returns zero counts when no notifications exist", async () => {
    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/users/notifications/unread/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      total_unread_notifications_count: 0,
      mention_unread_notifications_count: 0,
    });
  });

  test("returns 404 for non-existent workspace", async () => {
    const res = await app.request(
      `/api/workspaces/non-existent/users/notifications/unread/`
    );
    expect(res.status).toBe(404);
  });

  test("counts unread notifications correctly", async () => {
    // Add some unread non-mention notifications
    await testDb.insert(notifications).values([
      {
        id: createId(),
        workspaceId: testWorkspace.id,
        receiverId: testUser.id,
        entityType: "issue",
        entityId: createId(),
        title: "Issue updated",
        sender: "activity",
      },
      {
        id: createId(),
        workspaceId: testWorkspace.id,
        receiverId: testUser.id,
        entityType: "issue",
        entityId: createId(),
        title: "Issue assigned",
        sender: "activity",
      },
    ]);

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/users/notifications/unread/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_unread_notifications_count).toBe(2);
    expect(body.mention_unread_notifications_count).toBe(0);
  });

  test("counts mention notifications separately", async () => {
    // Add mention notifications
    await testDb.insert(notifications).values([
      {
        id: createId(),
        workspaceId: testWorkspace.id,
        receiverId: testUser.id,
        entityType: "issue",
        entityId: createId(),
        title: "You were mentioned",
        sender: "mentioned_in_comment",
      },
      {
        id: createId(),
        workspaceId: testWorkspace.id,
        receiverId: testUser.id,
        entityType: "issue",
        entityId: createId(),
        title: "You were mentioned again",
        sender: "mentioned_in_description",
      },
    ]);

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/users/notifications/unread/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_unread_notifications_count).toBe(2);
    expect(body.mention_unread_notifications_count).toBe(2);
  });

  test("excludes read notifications from counts", async () => {
    // Add a read notification
    await testDb.insert(notifications).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      receiverId: testUser.id,
      entityType: "issue",
      entityId: createId(),
      title: "Already read",
      sender: "activity",
      readAt: new Date(),
    });

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/users/notifications/unread/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Counts should not increase (still 2 non-mention, 2 mention from previous test)
    expect(body.total_unread_notifications_count).toBe(2);
    expect(body.mention_unread_notifications_count).toBe(2);
  });

  test("excludes archived notifications from counts", async () => {
    await testDb.insert(notifications).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      receiverId: testUser.id,
      entityType: "issue",
      entityId: createId(),
      title: "Archived notification",
      sender: "activity",
      archivedAt: new Date(),
    });

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/users/notifications/unread/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_unread_notifications_count).toBe(2);
    expect(body.mention_unread_notifications_count).toBe(2);
  });

  test("excludes snoozed notifications from counts", async () => {
    await testDb.insert(notifications).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      receiverId: testUser.id,
      entityType: "issue",
      entityId: createId(),
      title: "Snoozed notification",
      sender: "activity",
      snoozedTill: new Date(Date.now() + 86400000), // tomorrow
    });

    const res = await app.request(
      `/api/workspaces/${testWorkspace.slug}/users/notifications/unread/`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_unread_notifications_count).toBe(2);
    expect(body.mention_unread_notifications_count).toBe(2);
  });
});

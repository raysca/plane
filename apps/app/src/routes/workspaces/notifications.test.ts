import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database as BunSQLite } from "bun:sqlite";
import { eq, and, isNull, isNotNull, not, like, sql, desc, asc, or, lte, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as schema from "../../db/schema";
import { users } from "../../db/schema/user";
import { workspaces } from "../../db/schema/workspace";
import { notifications } from "../../db/schema/notification";

const sqlite = new BunSQLite(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
const db = drizzle(sqlite, { schema });

const testUser = { id: createId(), email: "test@test.com", name: "Test User", displayName: "Test User" };
const otherUser = { id: createId(), email: "other@test.com", name: "Other User", displayName: "Other User" };
const testWorkspace = { id: createId(), name: "Test Workspace", slug: "test-ws", ownerId: testUser.id };

function formatNotification(n: typeof notifications.$inferSelect, extra?: { triggeredByDetails?: any; isMentionedNotification?: boolean }) {
  return {
    id: n.id,
    workspace: n.workspaceId,
    project: n.projectId ?? null,
    entity_identifier: n.entityId ?? null,
    entity_name: n.entityName ?? null,
    title: n.title,
    data: n.data ?? null,
    message: n.message ?? null,
    message_html: n.messageHtml ?? null,
    message_stripped: n.messageStripped ?? null,
    sender: n.sender ?? "",
    triggered_by: n.triggeredById ?? null,
    receiver: n.receiverId,
    read_at: n.readAt?.toISOString() ?? null,
    archived_at: n.archivedAt?.toISOString() ?? null,
    snoozed_till: n.snoozedTill?.toISOString() ?? null,
    triggered_by_details: extra?.triggeredByDetails ?? null,
    is_inbox_issue: false,
    is_intake_issue: false,
    is_mentioned_notification: extra?.isMentionedNotification ?? (n.sender?.includes("mentioned") ?? false),
    created_by: n.createdById ?? null,
    updated_by: n.updatedById ?? null,
    created_at: n.createdAt?.toISOString() ?? null,
    updated_at: n.updatedAt?.toISOString() ?? null,
  };
}

function buildApp() {
  const app = new Hono<{ Variables: any }>();

  app.use("*", async (c, next) => {
    const userId = c.req.header("x-test-user-id") || testUser.id;
    const u = userId === otherUser.id ? otherUser : testUser;
    c.set("user", u);
    await next();
  });

  // List
  app.get("/api/workspaces/:slug/users/notifications/", async (c) => {
    const user = c.get("user");
    const slug = c.req.param("slug");
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
    if (!ws) return c.json({ detail: "Workspace not found." }, 404);

    const query = c.req.query();
    const cursorParam = query.cursor || `${query.per_page || "30"}:0:0`;
    const parts = cursorParam.split(":");
    const perPage = Math.min(parseInt(parts[0] || "30") || 30, 1000);
    const pageNumber = parseInt(parts[1] || "0") || 0;
    const offset = pageNumber * perPage;

    const conditions: any[] = [eq(notifications.workspaceId, ws.id), eq(notifications.receiverId, user.id)];

    if (query.snoozed === "true") {
      conditions.push(isNotNull(notifications.snoozedTill));
    } else {
      conditions.push(or(isNull(notifications.snoozedTill), lte(notifications.snoozedTill, new Date()))!);
    }

    if (query.archived === "true") {
      conditions.push(isNotNull(notifications.archivedAt));
    } else {
      conditions.push(isNull(notifications.archivedAt));
    }

    if (query.read === "true") conditions.push(isNotNull(notifications.readAt));
    else if (query.read === "false") conditions.push(isNull(notifications.readAt));

    if (query.mentioned === "true") conditions.push(like(notifications.sender, "%mentioned%"));

    const typeParam = query.type;
    if (typeParam && typeParam !== "all") {
      const types = typeParam.split(",");
      const tc: any[] = [];
      for (const t of types) {
        if (t === "assigned") tc.push(like(notifications.sender, "%assigned%"));
        else if (t === "created") tc.push(like(notifications.sender, "%created%"));
        else if (t === "subscribed") tc.push(like(notifications.sender, "%subscribed%"));
      }
      if (tc.length > 0) conditions.push(or(...tc)!);
    }

    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(notifications).where(and(...conditions));
    const totalCount = Number(totalResult[0]?.count ?? 0);

    const results = await db.select().from(notifications).where(and(...conditions)).orderBy(desc(notifications.createdAt)).limit(perPage).offset(offset);

    const trigIds = [...new Set(results.map((n) => n.triggeredById).filter(Boolean))] as string[];
    const trigRows = trigIds.length > 0 ? await db.select().from(users).where(inArray(users.id, trigIds)) : [];
    const trigMap = new Map(trigRows.map((u) => [u.id, { id: u.id, display_name: u.displayName ?? u.name ?? "", first_name: u.name ?? "", last_name: "", avatar_url: u.avatar ?? null, is_bot: false }]));

    const totalPages = Math.ceil(totalCount / perPage);

    return c.json({
      grouped_by: null,
      sub_grouped_by: null,
      next_cursor: `${perPage}:${pageNumber + 1}:0`,
      prev_cursor: `${perPage}:${Math.max(0, pageNumber - 1)}:0`,
      next_page_results: pageNumber + 1 < totalPages,
      prev_page_results: pageNumber > 0,
      total_count: totalCount,
      count: results.length,
      total_pages: totalPages,
      total_results: totalCount,
      extra_stats: null,
      results: results.map((n) => formatNotification(n, { triggeredByDetails: n.triggeredById ? trigMap.get(n.triggeredById) ?? null : null })),
    });
  });

  // Unread count
  app.get("/api/workspaces/:slug/users/notifications/unread/", async (c) => {
    const user = c.get("user");
    const slug = c.req.param("slug");
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
    if (!ws) return c.json({ detail: "Workspace not found." }, 404);

    const unread = await db.select({ count: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.workspaceId, ws.id), eq(notifications.receiverId, user.id), isNull(notifications.readAt), isNull(notifications.archivedAt), or(isNull(notifications.snoozedTill), lte(notifications.snoozedTill, new Date())), not(like(notifications.sender, "%mentioned%"))));
    const mentions = await db.select({ count: sql<number>`count(*)` }).from(notifications).where(and(eq(notifications.workspaceId, ws.id), eq(notifications.receiverId, user.id), isNull(notifications.readAt), isNull(notifications.archivedAt), or(isNull(notifications.snoozedTill), lte(notifications.snoozedTill, new Date())), like(notifications.sender, "%mentioned%")));

    return c.json({ total_unread_notifications_count: Number(unread[0]?.count ?? 0), mention_unread_notifications_count: Number(mentions[0]?.count ?? 0) });
  });

  // Mark all read
  app.post("/api/workspaces/:slug/users/notifications/mark-all-read/", async (c) => {
    const user = c.get("user");
    const slug = c.req.param("slug");
    const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.slug, slug) });
    if (!ws) return c.json({ detail: "Workspace not found." }, 404);

    await db.update(notifications).set({ readAt: new Date(), updatedAt: new Date() }).where(and(eq(notifications.workspaceId, ws.id), eq(notifications.receiverId, user.id), isNull(notifications.readAt), isNull(notifications.archivedAt)));

    return c.json({ message: "All notifications marked as read." });
  });

  // Get single
  app.get("/api/workspaces/:slug/users/notifications/:notificationId/", async (c) => {
    const user = c.get("user");
    const nid = c.req.param("notificationId");
    const n = await db.query.notifications.findFirst({ where: and(eq(notifications.id, nid), eq(notifications.receiverId, user.id)) });
    if (!n) return c.json({ detail: "Notification not found." }, 404);
    return c.json(formatNotification(n));
  });

  // PATCH (snooze)
  app.patch("/api/workspaces/:slug/users/notifications/:notificationId/", async (c) => {
    const user = c.get("user");
    const nid = c.req.param("notificationId");
    const n = await db.query.notifications.findFirst({ where: and(eq(notifications.id, nid), eq(notifications.receiverId, user.id)) });
    if (!n) return c.json({ detail: "Notification not found." }, 404);
    const body = await c.req.json();
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.snoozed_till !== undefined) updateData.snoozedTill = body.snoozed_till ? new Date(body.snoozed_till) : null;
    await db.update(notifications).set(updateData).where(eq(notifications.id, nid));
    const updated = await db.query.notifications.findFirst({ where: eq(notifications.id, nid) });
    return c.json(formatNotification(updated!));
  });

  // Mark read
  app.post("/api/workspaces/:slug/users/notifications/:notificationId/read/", async (c) => {
    const user = c.get("user");
    const nid = c.req.param("notificationId");
    const n = await db.query.notifications.findFirst({ where: and(eq(notifications.id, nid), eq(notifications.receiverId, user.id)) });
    if (!n) return c.json({ detail: "Notification not found." }, 404);
    await db.update(notifications).set({ readAt: new Date(), updatedAt: new Date() }).where(eq(notifications.id, nid));
    return c.json({ message: "Notification marked as read." });
  });

  // Mark unread
  app.delete("/api/workspaces/:slug/users/notifications/:notificationId/read/", async (c) => {
    const user = c.get("user");
    const nid = c.req.param("notificationId");
    const n = await db.query.notifications.findFirst({ where: and(eq(notifications.id, nid), eq(notifications.receiverId, user.id)) });
    if (!n) return c.json({ detail: "Notification not found." }, 404);
    await db.update(notifications).set({ readAt: null, updatedAt: new Date() }).where(eq(notifications.id, nid));
    return c.json({ message: "Notification marked as unread." });
  });

  // Archive
  app.post("/api/workspaces/:slug/users/notifications/:notificationId/archive/", async (c) => {
    const user = c.get("user");
    const nid = c.req.param("notificationId");
    const n = await db.query.notifications.findFirst({ where: and(eq(notifications.id, nid), eq(notifications.receiverId, user.id)) });
    if (!n) return c.json({ detail: "Notification not found." }, 404);
    await db.update(notifications).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(notifications.id, nid));
    return c.json({ message: "Notification archived." });
  });

  // Unarchive
  app.delete("/api/workspaces/:slug/users/notifications/:notificationId/archive/", async (c) => {
    const user = c.get("user");
    const nid = c.req.param("notificationId");
    const n = await db.query.notifications.findFirst({ where: and(eq(notifications.id, nid), eq(notifications.receiverId, user.id)) });
    if (!n) return c.json({ detail: "Notification not found." }, 404);
    await db.update(notifications).set({ archivedAt: null, updatedAt: new Date() }).where(eq(notifications.id, nid));
    return c.json({ message: "Notification unarchived." });
  });

  return app;
}

beforeAll(async () => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, email_verified INTEGER DEFAULT 0,
      name TEXT, image TEXT, username TEXT, display_name TEXT, avatar TEXT,
      cover_image TEXT, first_name TEXT, last_name TEXT,
      is_active INTEGER DEFAULT 1, is_password_autoset INTEGER DEFAULT 0,
      last_login_at INTEGER, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, logo TEXT,
      owner_id TEXT NOT NULL REFERENCES users(id), organization_size TEXT,
      timezone TEXT DEFAULT 'UTC', created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, identifier TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      network INTEGER DEFAULT 2, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      triggered_by_id TEXT REFERENCES users(id),
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, entity_name TEXT,
      title TEXT NOT NULL, message TEXT, message_html TEXT, message_stripped TEXT,
      sender TEXT NOT NULL DEFAULT '', data TEXT,
      read_at INTEGER, archived_at INTEGER, snoozed_till INTEGER,
      created_by_id TEXT, updated_by_id TEXT,
      created_at INTEGER, updated_at INTEGER
    );
  `);

  await db.insert(users).values([
    { id: testUser.id, email: testUser.email, name: testUser.name, displayName: testUser.displayName },
    { id: otherUser.id, email: otherUser.email, name: otherUser.name, displayName: otherUser.displayName },
  ]);
  await db.insert(workspaces).values(testWorkspace);
});

const baseUrl = () => `/api/workspaces/${testWorkspace.slug}/users/notifications`;

describe("Notification List", () => {
  const app = buildApp();
  let notifIds: string[] = [];

  beforeAll(async () => {
    // Create various notifications
    const vals = [
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, triggeredById: otherUser.id, entityType: "issue", entityId: createId(), title: "Assigned to you", sender: "in_app:issue_activities:assigned" },
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, triggeredById: otherUser.id, entityType: "issue", entityId: createId(), title: "You were mentioned", sender: "in_app:issue_activities:mentioned" },
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, triggeredById: otherUser.id, entityType: "issue", entityId: createId(), title: "Subscribed update", sender: "in_app:issue_activities:subscribed" },
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, triggeredById: otherUser.id, entityType: "issue", entityId: createId(), title: "You created", sender: "in_app:issue_activities:created" },
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, entityType: "issue", entityId: createId(), title: "Archived one", sender: "in_app:issue_activities:assigned", archivedAt: new Date() },
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, entityType: "issue", entityId: createId(), title: "Read one", sender: "in_app:issue_activities:assigned", readAt: new Date() },
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, entityType: "issue", entityId: createId(), title: "Snoozed (future)", sender: "in_app:issue_activities:assigned", snoozedTill: new Date(Date.now() + 86400000) },
    ];
    await db.insert(notifications).values(vals);
    notifIds = vals.map((v) => v.id);
  });

  test("lists notifications (excludes archived by default)", async () => {
    const res = await app.request(`${baseUrl()}/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toBeInstanceOf(Array);
    // Should not include archived notification
    const titles = data.results.map((n: any) => n.title);
    expect(titles).not.toContain("Archived one");
    // Should not include future snoozed
    expect(titles).not.toContain("Snoozed (future)");
  });

  test("includes triggered_by_details", async () => {
    const res = await app.request(`${baseUrl()}/`);
    const data = await res.json();
    const withTrigger = data.results.find((n: any) => n.triggered_by_details !== null);
    expect(withTrigger).toBeTruthy();
    expect(withTrigger.triggered_by_details.id).toBe(otherUser.id);
    expect(withTrigger.triggered_by_details.display_name).toBe("Other User");
  });

  test("filters by type=assigned", async () => {
    const res = await app.request(`${baseUrl()}/?type=assigned`);
    const data = await res.json();
    for (const n of data.results) {
      expect(n.sender).toContain("assigned");
    }
  });

  test("filters by type=created", async () => {
    const res = await app.request(`${baseUrl()}/?type=created`);
    const data = await res.json();
    for (const n of data.results) {
      expect(n.sender).toContain("created");
    }
  });

  test("filters by mentioned=true", async () => {
    const res = await app.request(`${baseUrl()}/?mentioned=true`);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    for (const n of data.results) {
      expect(n.sender).toContain("mentioned");
      expect(n.is_mentioned_notification).toBe(true);
    }
  });

  test("filters by read=false (unread only)", async () => {
    const res = await app.request(`${baseUrl()}/?read=false`);
    const data = await res.json();
    for (const n of data.results) {
      expect(n.read_at).toBeNull();
    }
  });

  test("filters by read=true (read only)", async () => {
    const res = await app.request(`${baseUrl()}/?read=true`);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    for (const n of data.results) {
      expect(n.read_at).not.toBeNull();
    }
  });

  test("filters by archived=true", async () => {
    const res = await app.request(`${baseUrl()}/?archived=true`);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    for (const n of data.results) {
      expect(n.archived_at).not.toBeNull();
    }
  });

  test("returns paginated response format", async () => {
    const res = await app.request(`${baseUrl()}/`);
    const data = await res.json();
    expect(data).toHaveProperty("next_cursor");
    expect(data).toHaveProperty("prev_cursor");
    expect(data).toHaveProperty("next_page_results");
    expect(data).toHaveProperty("prev_page_results");
    expect(data).toHaveProperty("total_count");
    expect(data).toHaveProperty("count");
    expect(data).toHaveProperty("total_pages");
    expect(data).toHaveProperty("results");
  });

  test("pagination works", async () => {
    const res = await app.request(`${baseUrl()}/?cursor=2:0:0`);
    const data = await res.json();
    expect(data.count).toBeLessThanOrEqual(2);
    expect(data.next_page_results).toBe(true);
  });
});

describe("Notification Read/Unread", () => {
  const app = buildApp();
  let notifId: string;

  beforeAll(async () => {
    const [n] = await db.insert(notifications).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      receiverId: testUser.id,
      entityType: "issue",
      entityId: createId(),
      title: "Read/Unread test",
      sender: "in_app:issue_activities:assigned",
    }).returning();
    notifId = n.id;
  });

  test("marks notification as read", async () => {
    const res = await app.request(`${baseUrl()}/${notifId}/read/`, { method: "POST" });
    expect(res.status).toBe(200);

    const n = await db.query.notifications.findFirst({ where: eq(notifications.id, notifId) });
    expect(n!.readAt).not.toBeNull();
  });

  test("marks notification as unread", async () => {
    const res = await app.request(`${baseUrl()}/${notifId}/read/`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const n = await db.query.notifications.findFirst({ where: eq(notifications.id, notifId) });
    expect(n!.readAt).toBeNull();
  });

  test("returns 404 for non-existent notification", async () => {
    const res = await app.request(`${baseUrl()}/nonexistent/read/`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("Notification Archive/Unarchive", () => {
  const app = buildApp();
  let notifId: string;

  beforeAll(async () => {
    const [n] = await db.insert(notifications).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      receiverId: testUser.id,
      entityType: "issue",
      entityId: createId(),
      title: "Archive test",
      sender: "in_app:issue_activities:assigned",
    }).returning();
    notifId = n.id;
  });

  test("archives notification", async () => {
    const res = await app.request(`${baseUrl()}/${notifId}/archive/`, { method: "POST" });
    expect(res.status).toBe(200);

    const n = await db.query.notifications.findFirst({ where: eq(notifications.id, notifId) });
    expect(n!.archivedAt).not.toBeNull();
  });

  test("unarchives notification", async () => {
    const res = await app.request(`${baseUrl()}/${notifId}/archive/`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const n = await db.query.notifications.findFirst({ where: eq(notifications.id, notifId) });
    expect(n!.archivedAt).toBeNull();
  });

  test("returns 404 for non-existent notification", async () => {
    const res = await app.request(`${baseUrl()}/nonexistent/archive/`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("Notification Snooze", () => {
  const app = buildApp();
  let notifId: string;

  beforeAll(async () => {
    const [n] = await db.insert(notifications).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      receiverId: testUser.id,
      entityType: "issue",
      entityId: createId(),
      title: "Snooze test",
      sender: "in_app:issue_activities:assigned",
    }).returning();
    notifId = n.id;
  });

  test("snoozes notification", async () => {
    const snoozeTill = new Date(Date.now() + 86400000).toISOString();
    const res = await app.request(`${baseUrl()}/${notifId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snoozed_till: snoozeTill }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.snoozed_till).not.toBeNull();
  });

  test("unsnoozes notification", async () => {
    const res = await app.request(`${baseUrl()}/${notifId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snoozed_till: null }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.snoozed_till).toBeNull();
  });
});

describe("Mark All Read", () => {
  const app = buildApp();

  beforeAll(async () => {
    // Create some unread notifications
    await db.insert(notifications).values([
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, entityType: "issue", entityId: createId(), title: "Bulk 1", sender: "in_app:issue_activities:assigned" },
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, entityType: "issue", entityId: createId(), title: "Bulk 2", sender: "in_app:issue_activities:subscribed" },
      { id: createId(), workspaceId: testWorkspace.id, receiverId: testUser.id, entityType: "issue", entityId: createId(), title: "Bulk 3", sender: "in_app:issue_activities:mentioned" },
    ]);
  });

  test("marks all unread as read", async () => {
    // Check unread count first
    const beforeRes = await app.request(`${baseUrl()}/unread/`);
    const before = await beforeRes.json();
    const totalBefore = before.total_unread_notifications_count + before.mention_unread_notifications_count;
    expect(totalBefore).toBeGreaterThan(0);

    // Mark all read
    const res = await app.request(`${baseUrl()}/mark-all-read/`, { method: "POST" });
    expect(res.status).toBe(200);

    // Check unread count after
    const afterRes = await app.request(`${baseUrl()}/unread/`);
    const after = await afterRes.json();
    expect(after.total_unread_notifications_count).toBe(0);
    expect(after.mention_unread_notifications_count).toBe(0);
  });
});

describe("Get Single Notification", () => {
  const app = buildApp();
  let notifId: string;

  beforeAll(async () => {
    const [n] = await db.insert(notifications).values({
      id: createId(),
      workspaceId: testWorkspace.id,
      receiverId: testUser.id,
      triggeredById: otherUser.id,
      entityType: "issue",
      entityId: createId(),
      entityName: "issue",
      title: "Single fetch test",
      sender: "in_app:issue_activities:mentioned",
      data: { issue: { name: "Test Issue", id: "123" } },
    }).returning();
    notifId = n.id;
  });

  test("gets a single notification", async () => {
    const res = await app.request(`${baseUrl()}/${notifId}/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(notifId);
    expect(data.title).toBe("Single fetch test");
    expect(data.entity_name).toBe("issue");
    expect(data.is_mentioned_notification).toBe(true);
    expect(data.receiver).toBe(testUser.id);
    expect(data.workspace).toBe(testWorkspace.id);
  });

  test("returns 404 for other user's notification", async () => {
    const res = await app.request(`${baseUrl()}/${notifId}/`, {
      headers: { "x-test-user-id": otherUser.id },
    });
    expect(res.status).toBe(404);
  });

  test("returns 404 for non-existent notification", async () => {
    const res = await app.request(`${baseUrl()}/nonexistent/`);
    expect(res.status).toBe(404);
  });
});

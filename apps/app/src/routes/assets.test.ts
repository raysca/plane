import { describe, test, expect, beforeAll } from "bun:test";
import { Hono } from "hono";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, and } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import * as userSchema from "../db/schema/user";
import * as workspaceSchema from "../db/schema/workspace";
import * as projectSchema from "../db/schema/project";
import * as assetSchema from "../db/schema/asset";

// Create in-memory DB
const sqlite = new Database(":memory:");
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const db = drizzle(sqlite, {
  schema: { ...userSchema, ...workspaceSchema, ...projectSchema, ...assetSchema },
});

// Create tables
sqlite.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER,
    image TEXT,
    username TEXT UNIQUE,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    avatar TEXT,
    cover_image TEXT,
    is_active INTEGER DEFAULT 1,
    is_password_autoset INTEGER DEFAULT 0,
    last_login_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE workspaces (
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

  CREATE TABLE workspace_members (
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

  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    identifier TEXT NOT NULL,
    description TEXT,
    description_text TEXT,
    description_html TEXT,
    network INTEGER DEFAULT 2,
    emoji TEXT,
    icon_prop TEXT,
    cover_image TEXT,
    archive_in INTEGER DEFAULT 0,
    close_in INTEGER DEFAULT 0,
    estimate_id TEXT,
    default_state_id TEXT,
    default_assignee_id TEXT,
    project_lead_id TEXT,
    created_by_id TEXT,
    sort_order REAL DEFAULT 65535,
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
    inbox_view INTEGER DEFAULT 0,
    is_deployed INTEGER DEFAULT 0,
    deleted_at INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE file_assets (
    id TEXT PRIMARY KEY NOT NULL,
    attributes TEXT,
    asset TEXT NOT NULL,
    size REAL DEFAULT 0,
    user_id TEXT,
    workspace_id TEXT,
    project_id TEXT,
    entity_type TEXT,
    entity_identifier TEXT,
    is_uploaded INTEGER DEFAULT 0,
    storage_metadata TEXT,
    is_deleted INTEGER DEFAULT 0,
    deleted_at INTEGER,
    external_id TEXT,
    external_source TEXT,
    created_by_id TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE NO ACTION
  );
`);

// Test data
let testUser: { id: string; email: string };
let testWorkspace: { id: string; slug: string };
let testProject: { id: string };

// Setup test Hono app that mimics real routes but without auth middleware
const app = new Hono();

// POST /api/assets/v2/workspaces/:slug/
app.post("/api/assets/v2/workspaces/:slug/", async (c) => {
  const slug = c.req.param("slug");

  // Find workspace
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  const body = await c.req.json();
  const { name, type, size, entity_type, entity_identifier } = body;

  // Validate entity type
  const validTypes = Object.values(assetSchema.ENTITY_TYPES);
  if (!validTypes.includes(entity_type)) {
    return c.json({ error: "Invalid entity type.", status: false }, 400);
  }

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg", "image/gif"];
  if (!allowedTypes.includes(type)) {
    return c.json(
      { error: "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.", status: false },
      400
    );
  }

  const sizeLimit = Math.min(size, 5 * 1024 * 1024);
  const assetKey = `${workspace.id}/${createId()}-${name}`;
  const assetId = createId();

  await db.insert(assetSchema.fileAssets).values({
    id: assetId,
    attributes: { name, type, size: sizeLimit },
    asset: assetKey,
    size: sizeLimit,
    workspaceId: workspace.id,
    entityType: entity_type,
    entityIdentifier: entity_identifier || null,
    createdById: testUser.id,
    isUploaded: false,
    isDeleted: false,
  });

  return c.json({
    upload_data: { url: `http://localhost/upload/${assetKey}`, fields: { "Content-Type": type, key: assetKey } },
    asset_id: assetId,
    asset_url: `/api/assets/v2/static/${assetId}/`,
  });
});

// PATCH /api/assets/v2/workspaces/:slug/:assetId/
app.patch("/api/assets/v2/workspaces/:slug/:assetId/", async (c) => {
  const assetId = c.req.param("assetId");
  const slug = c.req.param("slug");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(assetSchema.fileAssets.id, assetId), eq(assetSchema.fileAssets.workspaceId, workspace.id)),
  });

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const body = await c.req.json();
  const updates: Record<string, unknown> = { isUploaded: true, updatedAt: new Date() };
  if (body.attributes) {
    updates.attributes = { ...((asset.attributes as Record<string, unknown>) || {}), ...body.attributes };
  }

  await db.update(assetSchema.fileAssets).set(updates).where(eq(assetSchema.fileAssets.id, assetId));

  return c.body(null, 204);
});

// DELETE /api/assets/v2/workspaces/:slug/:assetId/
app.delete("/api/assets/v2/workspaces/:slug/:assetId/", async (c) => {
  const assetId = c.req.param("assetId");
  const slug = c.req.param("slug");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(assetSchema.fileAssets.id, assetId), eq(assetSchema.fileAssets.workspaceId, workspace.id)),
  });

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  await db
    .update(assetSchema.fileAssets)
    .set({ isDeleted: true, deletedAt: new Date() })
    .where(eq(assetSchema.fileAssets.id, assetId));

  return c.body(null, 204);
});

// GET /api/assets/v2/workspaces/:slug/:assetId/ (download)
app.get("/api/assets/v2/workspaces/:slug/:assetId/", async (c) => {
  const assetId = c.req.param("assetId");
  const slug = c.req.param("slug");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(assetSchema.fileAssets.id, assetId), eq(assetSchema.fileAssets.workspaceId, workspace.id)),
  });

  if (!asset || !asset.isUploaded) {
    return c.json({ error: "The requested asset could not be found." }, 404);
  }

  // In tests we return a JSON response instead of redirect
  return c.json({ redirect: true, asset_id: assetId });
});

// GET /api/assets/v2/workspaces/:slug/check/:assetId/
app.get("/api/assets/v2/workspaces/:slug/check/:assetId/", async (c) => {
  const assetId = c.req.param("assetId");
  const slug = c.req.param("slug");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(assetSchema.fileAssets.id, assetId), eq(assetSchema.fileAssets.workspaceId, workspace.id)),
  });

  return c.json({ exists: !!asset && !asset.isDeleted });
});

// POST /api/assets/v2/workspaces/:slug/restore/:assetId/
app.post("/api/assets/v2/workspaces/:slug/restore/:assetId/", async (c) => {
  const assetId = c.req.param("assetId");
  const slug = c.req.param("slug");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  await db
    .update(assetSchema.fileAssets)
    .set({ isDeleted: false, deletedAt: null })
    .where(and(eq(assetSchema.fileAssets.id, assetId), eq(assetSchema.fileAssets.workspaceId, workspace.id)));

  return c.body(null, 204);
});

// GET /api/assets/v2/static/:assetId/
app.get("/api/assets/v2/static/:assetId/", async (c) => {
  const assetId = c.req.param("assetId");

  const asset = await db.query.fileAssets.findFirst({
    where: eq(assetSchema.fileAssets.id, assetId),
  });

  if (!asset || !asset.isUploaded) {
    return c.json({ error: "The requested asset could not be found." }, 404);
  }

  const staticTypes = ["USER_AVATAR", "USER_COVER", "WORKSPACE_LOGO", "PROJECT_COVER"];
  if (!staticTypes.includes(asset.entityType || "")) {
    return c.json({ error: "Invalid entity type.", status: false }, 400);
  }

  return c.json({ redirect: true, asset_id: assetId });
});

// POST /api/assets/v2/user-assets/
app.post("/api/assets/v2/user-assets/", async (c) => {
  const body = await c.req.json();
  const { name, type, size, entity_type } = body;

  if (!["USER_AVATAR", "USER_COVER"].includes(entity_type)) {
    return c.json({ error: "Invalid entity type.", status: false }, 400);
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg", "image/gif"];
  if (!allowedTypes.includes(type)) {
    return c.json(
      { error: "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.", status: false },
      400
    );
  }

  const sizeLimit = Math.min(size, 5 * 1024 * 1024);
  const assetKey = `user-${createId()}-${name}`;
  const assetId = createId();

  await db.insert(assetSchema.fileAssets).values({
    id: assetId,
    attributes: { name, type, size: sizeLimit },
    asset: assetKey,
    size: sizeLimit,
    userId: testUser.id,
    entityType: entity_type,
    createdById: testUser.id,
    isUploaded: false,
    isDeleted: false,
  });

  return c.json({
    upload_data: { url: `http://localhost/upload/${assetKey}`, fields: { "Content-Type": type, key: assetKey } },
    asset_id: assetId,
    asset_url: `/api/assets/v2/static/${assetId}/`,
  });
});

// POST /api/assets/v2/workspaces/:slug/projects/:projectId/
app.post("/api/assets/v2/workspaces/:slug/projects/:projectId/", async (c) => {
  const slug = c.req.param("slug");
  const projectId = c.req.param("projectId");

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaceSchema.workspaces.slug, slug),
  });

  if (!workspace) {
    return c.json({ detail: "Workspace not found." }, 404);
  }

  const body = await c.req.json();
  const { name, type, size, entity_type, entity_identifier } = body;

  const validTypes = Object.values(assetSchema.ENTITY_TYPES);
  if (!validTypes.includes(entity_type)) {
    return c.json({ error: "Invalid entity type.", status: false }, 400);
  }

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg", "image/gif"];
  if (!allowedTypes.includes(type)) {
    return c.json(
      { error: "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.", status: false },
      400
    );
  }

  const sizeLimit = Math.min(size, 5 * 1024 * 1024);
  const assetKey = `${workspace.id}/${createId()}-${name}`;
  const assetId = createId();

  await db.insert(assetSchema.fileAssets).values({
    id: assetId,
    attributes: { name, type, size: sizeLimit },
    asset: assetKey,
    size: sizeLimit,
    workspaceId: workspace.id,
    projectId,
    entityType: entity_type,
    entityIdentifier: entity_identifier || null,
    createdById: testUser.id,
    isUploaded: false,
    isDeleted: false,
  });

  return c.json({
    upload_data: { url: `http://localhost/upload/${assetKey}`, fields: { "Content-Type": type, key: assetKey } },
    asset_id: assetId,
    asset_url: `/api/assets/v2/workspaces/${slug}/projects/${projectId}/${assetId}/`,
  });
});

// Setup test data
beforeAll(async () => {
  testUser = { id: createId(), email: "test@example.com" };

  await db.insert(userSchema.users).values({
    id: testUser.id,
    email: testUser.email,
    name: "Test User",
  });

  testWorkspace = { id: createId(), slug: "test-workspace" };

  await db.insert(workspaceSchema.workspaces).values({
    id: testWorkspace.id,
    name: "Test Workspace",
    slug: testWorkspace.slug,
    ownerId: testUser.id,
  });

  await db.insert(workspaceSchema.workspaceMembers).values({
    workspaceId: testWorkspace.id,
    userId: testUser.id,
    role: 20,
    isActive: true,
  });

  testProject = { id: createId() };

  await db.insert(projectSchema.projects).values({
    id: testProject.id,
    workspaceId: testWorkspace.id,
    name: "Test Project",
    identifier: "TEST",
  });
});

describe("POST /api/assets/v2/workspaces/:slug/ (create workspace asset)", () => {
  test("creates asset and returns upload data", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "logo.png",
        type: "image/png",
        size: 1024,
        entity_type: "WORKSPACE_LOGO",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asset_id).toBeDefined();
    expect(data.upload_data).toBeDefined();
    expect(data.upload_data.url).toContain("logo.png");
    expect(data.upload_data.fields).toBeDefined();
    expect(data.upload_data.fields["Content-Type"]).toBe("image/png");
    expect(data.upload_data.fields.key).toBeDefined();
    expect(data.asset_url).toBe(`/api/assets/v2/static/${data.asset_id}/`);
  });

  test("rejects invalid entity type", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "file.png",
        type: "image/png",
        size: 1024,
        entity_type: "INVALID_TYPE",
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Invalid entity type.");
  });

  test("rejects invalid file type", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "script.js",
        type: "application/javascript",
        size: 1024,
        entity_type: "WORKSPACE_LOGO",
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid file type");
  });

  test("clamps file size to 5MB limit", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "big.png",
        type: "image/png",
        size: 50 * 1024 * 1024, // 50MB
        entity_type: "WORKSPACE_LOGO",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    // Verify the DB record has clamped size
    const asset = await db.query.fileAssets.findFirst({
      where: eq(assetSchema.fileAssets.id, data.asset_id),
    });
    expect(asset!.size).toBe(5 * 1024 * 1024);
  });

  test("returns 404 for non-existent workspace", async () => {
    const res = await app.request("/api/assets/v2/workspaces/nonexistent/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "logo.png",
        type: "image/png",
        size: 1024,
        entity_type: "WORKSPACE_LOGO",
      }),
    });

    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/assets/v2/workspaces/:slug/:assetId/ (mark uploaded)", () => {
  let assetId: string;

  beforeAll(async () => {
    // Create an asset to patch
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "cover.jpg",
        type: "image/jpeg",
        size: 2048,
        entity_type: "PROJECT_COVER",
      }),
    });
    const data = await res.json();
    assetId = data.asset_id;
  });

  test("marks asset as uploaded", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/${assetId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(204);

    const asset = await db.query.fileAssets.findFirst({
      where: eq(assetSchema.fileAssets.id, assetId),
    });
    expect(asset!.isUploaded).toBe(true);
  });

  test("updates attributes", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/${assetId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: { name: "renamed.jpg" } }),
    });

    expect(res.status).toBe(204);

    const asset = await db.query.fileAssets.findFirst({
      where: eq(assetSchema.fileAssets.id, assetId),
    });
    const attrs = asset!.attributes as { name?: string };
    expect(attrs.name).toBe("renamed.jpg");
  });

  test("returns 404 for non-existent asset", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/nonexistent-id/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/assets/v2/workspaces/:slug/:assetId/ (soft delete)", () => {
  let assetId: string;

  beforeAll(async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "delete-me.png",
        type: "image/png",
        size: 512,
        entity_type: "WORKSPACE_LOGO",
      }),
    });
    const data = await res.json();
    assetId = data.asset_id;
  });

  test("soft-deletes the asset", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/${assetId}/`, {
      method: "DELETE",
    });

    expect(res.status).toBe(204);

    const asset = await db.query.fileAssets.findFirst({
      where: eq(assetSchema.fileAssets.id, assetId),
    });
    expect(asset!.isDeleted).toBe(true);
    expect(asset!.deletedAt).toBeDefined();
  });

  test("check endpoint returns false for deleted asset", async () => {
    const res = await app.request(
      `/api/assets/v2/workspaces/${testWorkspace.slug}/check/${assetId}/`
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.exists).toBe(false);
  });
});

describe("POST /api/assets/v2/workspaces/:slug/restore/:assetId/ (restore)", () => {
  let assetId: string;

  beforeAll(async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "restore-me.png",
        type: "image/png",
        size: 256,
        entity_type: "WORKSPACE_LOGO",
      }),
    });
    const data = await res.json();
    assetId = data.asset_id;

    // Soft-delete it
    await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/${assetId}/`, {
      method: "DELETE",
    });
  });

  test("restores a soft-deleted asset", async () => {
    // Verify it's deleted
    let asset = await db.query.fileAssets.findFirst({
      where: eq(assetSchema.fileAssets.id, assetId),
    });
    expect(asset!.isDeleted).toBe(true);

    // Restore
    const res = await app.request(
      `/api/assets/v2/workspaces/${testWorkspace.slug}/restore/${assetId}/`,
      { method: "POST" }
    );
    expect(res.status).toBe(204);

    // Verify restored
    asset = await db.query.fileAssets.findFirst({
      where: eq(assetSchema.fileAssets.id, assetId),
    });
    expect(asset!.isDeleted).toBe(false);
    expect(asset!.deletedAt).toBeNull();
  });
});

describe("GET /api/assets/v2/workspaces/:slug/:assetId/ (download)", () => {
  let uploadedAssetId: string;
  let notUploadedAssetId: string;

  beforeAll(async () => {
    // Create and mark as uploaded
    let res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "download.png",
        type: "image/png",
        size: 1024,
        entity_type: "WORKSPACE_LOGO",
      }),
    });
    let data = await res.json();
    uploadedAssetId = data.asset_id;

    await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/${uploadedAssetId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Create but don't mark as uploaded
    res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "not-uploaded.png",
        type: "image/png",
        size: 1024,
        entity_type: "WORKSPACE_LOGO",
      }),
    });
    data = await res.json();
    notUploadedAssetId = data.asset_id;
  });

  test("returns download data for uploaded asset", async () => {
    const res = await app.request(
      `/api/assets/v2/workspaces/${testWorkspace.slug}/${uploadedAssetId}/`
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.redirect).toBe(true);
    expect(data.asset_id).toBe(uploadedAssetId);
  });

  test("returns 404 for non-uploaded asset", async () => {
    const res = await app.request(
      `/api/assets/v2/workspaces/${testWorkspace.slug}/${notUploadedAssetId}/`
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/assets/v2/workspaces/:slug/check/:assetId/ (check exists)", () => {
  let existingAssetId: string;

  beforeAll(async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "check-me.png",
        type: "image/png",
        size: 128,
        entity_type: "WORKSPACE_LOGO",
      }),
    });
    const data = await res.json();
    existingAssetId = data.asset_id;
  });

  test("returns true for existing asset", async () => {
    const res = await app.request(
      `/api/assets/v2/workspaces/${testWorkspace.slug}/check/${existingAssetId}/`
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.exists).toBe(true);
  });

  test("returns false for non-existent asset", async () => {
    const res = await app.request(
      `/api/assets/v2/workspaces/${testWorkspace.slug}/check/nonexistent-id/`
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.exists).toBe(false);
  });
});

describe("GET /api/assets/v2/static/:assetId/ (public static asset)", () => {
  let staticAssetId: string;
  let nonStaticAssetId: string;

  beforeAll(async () => {
    // Create a static-type asset and mark uploaded
    staticAssetId = createId();
    await db.insert(assetSchema.fileAssets).values({
      id: staticAssetId,
      attributes: { name: "avatar.png", type: "image/png", size: 512 },
      asset: `user-${createId()}-avatar.png`,
      size: 512,
      userId: testUser.id,
      entityType: "USER_AVATAR",
      createdById: testUser.id,
      isUploaded: true,
      isDeleted: false,
    });

    // Create a non-static-type asset
    nonStaticAssetId = createId();
    await db.insert(assetSchema.fileAssets).values({
      id: nonStaticAssetId,
      attributes: { name: "issue-desc.png", type: "image/png", size: 256 },
      asset: `${testWorkspace.id}/${createId()}-issue-desc.png`,
      size: 256,
      workspaceId: testWorkspace.id,
      entityType: "ISSUE_DESCRIPTION",
      createdById: testUser.id,
      isUploaded: true,
      isDeleted: false,
    });
  });

  test("returns redirect for static asset types", async () => {
    const res = await app.request(`/api/assets/v2/static/${staticAssetId}/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.redirect).toBe(true);
  });

  test("rejects non-static entity types", async () => {
    const res = await app.request(`/api/assets/v2/static/${nonStaticAssetId}/`);
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent asset", async () => {
    const res = await app.request("/api/assets/v2/static/nonexistent-id/");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/assets/v2/user-assets/ (user asset upload)", () => {
  test("creates user avatar asset", async () => {
    const res = await app.request("/api/assets/v2/user-assets/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "avatar.png",
        type: "image/png",
        size: 2048,
        entity_type: "USER_AVATAR",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asset_id).toBeDefined();
    expect(data.asset_url).toContain("/api/assets/v2/static/");
  });

  test("creates user cover asset", async () => {
    const res = await app.request("/api/assets/v2/user-assets/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "cover.jpg",
        type: "image/jpeg",
        size: 4096,
        entity_type: "USER_COVER",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asset_id).toBeDefined();
  });

  test("rejects invalid entity type for user assets", async () => {
    const res = await app.request("/api/assets/v2/user-assets/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "logo.png",
        type: "image/png",
        size: 1024,
        entity_type: "WORKSPACE_LOGO",
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/assets/v2/workspaces/:slug/projects/:projectId/ (project asset)", () => {
  test("creates project asset with project binding", async () => {
    const res = await app.request(
      `/api/assets/v2/workspaces/${testWorkspace.slug}/projects/${testProject.id}/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "issue-img.png",
          type: "image/png",
          size: 1024,
          entity_type: "ISSUE_DESCRIPTION",
          entity_identifier: "some-issue-id",
        }),
      }
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.asset_id).toBeDefined();
    expect(data.asset_url).toContain(`/projects/${testProject.id}/`);

    // Verify project_id is set in DB
    const asset = await db.query.fileAssets.findFirst({
      where: eq(assetSchema.fileAssets.id, data.asset_id),
    });
    expect(asset!.projectId).toBe(testProject.id);
    expect(asset!.workspaceId).toBe(testWorkspace.id);
    expect(asset!.entityIdentifier).toBe("some-issue-id");
  });
});

describe("asset record fields are correctly stored", () => {
  test("all fields persisted correctly", async () => {
    const res = await app.request(`/api/assets/v2/workspaces/${testWorkspace.slug}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-fields.gif",
        type: "image/gif",
        size: 3000,
        entity_type: "PROJECT_COVER",
        entity_identifier: "some-project-id",
      }),
    });

    const data = await res.json();
    const asset = await db.query.fileAssets.findFirst({
      where: eq(assetSchema.fileAssets.id, data.asset_id),
    });

    expect(asset).toBeDefined();
    expect(asset!.isUploaded).toBe(false);
    expect(asset!.isDeleted).toBe(false);
    expect(asset!.workspaceId).toBe(testWorkspace.id);
    expect(asset!.entityType).toBe("PROJECT_COVER");
    expect(asset!.entityIdentifier).toBe("some-project-id");
    expect(asset!.createdById).toBe(testUser.id);
    expect(asset!.size).toBe(3000);
    expect(asset!.asset).toContain(testWorkspace.id);
    expect(asset!.asset).toContain("test-fields.gif");

    const attrs = asset!.attributes as { name: string; type: string; size: number };
    expect(attrs.name).toBe("test-fields.gif");
    expect(attrs.type).toBe("image/gif");
    expect(attrs.size).toBe(3000);
  });
});

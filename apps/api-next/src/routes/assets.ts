import { Hono } from "hono";
import { z } from "zod/v4";
import { zValidator } from "@hono/zod-validator";
import type { Variables } from "../app";
import { db } from "../db";
import { fileAssets, ENTITY_TYPES, type EntityType } from "../db/schema/asset";
import { workspaces } from "../db/schema/workspace";
import { projects } from "../db/schema/project";
import { eq, and } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth";
import { workspaceMiddleware } from "../middleware/workspace";
import { getStorage, FILE_SIZE_LIMIT, isS3Configured } from "../lib/storage";
import { createId } from "@paralleldrive/cuid2";
import { join } from "path";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
  "image/gif",
];

const ENTITY_TYPE_VALUES = Object.values(ENTITY_TYPES);

const STATIC_ENTITY_TYPES: EntityType[] = [
  ENTITY_TYPES.USER_AVATAR,
  ENTITY_TYPES.USER_COVER,
  ENTITY_TYPES.WORKSPACE_LOGO,
  ENTITY_TYPES.PROJECT_COVER,
];

// --- Helpers ---

function getAssetUrl(entityType: string, assetId: string, workspaceSlug?: string, projectId?: string): string | null {
  if (
    entityType === ENTITY_TYPES.WORKSPACE_LOGO ||
    entityType === ENTITY_TYPES.USER_AVATAR ||
    entityType === ENTITY_TYPES.USER_COVER ||
    entityType === ENTITY_TYPES.PROJECT_COVER
  ) {
    return `/api/assets/v2/static/${assetId}/`;
  }

  if (entityType === ENTITY_TYPES.ISSUE_ATTACHMENT && workspaceSlug && projectId) {
    return `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/${assetId}/`;
  }

  if (
    [
      ENTITY_TYPES.ISSUE_DESCRIPTION,
      ENTITY_TYPES.COMMENT_DESCRIPTION,
      ENTITY_TYPES.PAGE_DESCRIPTION,
      ENTITY_TYPES.DRAFT_ISSUE_DESCRIPTION,
    ].includes(entityType as EntityType) &&
    workspaceSlug &&
    projectId
  ) {
    return `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/${assetId}/`;
  }

  return null;
}

// --- Schemas ---

const createAssetSchema = z.object({
  name: z.string(),
  type: z.string().default("image/jpeg"),
  size: z.coerce.number().int().positive(),
  entity_type: z.string(),
  entity_identifier: z.string().optional(),
});

const updateAssetSchema = z.object({
  attributes: z
    .object({
      name: z.string().optional(),
      type: z.string().optional(),
      size: z.number().optional(),
    })
    .optional(),
});

// --- Routes ---

// Workspace asset routes (require auth + workspace membership)
const workspaceAssetRoutes = new Hono<{ Variables: Variables }>();
workspaceAssetRoutes.use("*", authMiddleware, workspaceMiddleware);

// POST /api/assets/v2/workspaces/:slug/ — Create asset + presigned upload URL
workspaceAssetRoutes.post("/", zValidator("json", createAssetSchema), async (c) => {
  const user = c.get("user")!;
  const workspace = c.get("workspace")!;
  const body = c.req.valid("json");

  const { name, type, size, entity_type, entity_identifier } = body;

  // Validate entity type
  if (!ENTITY_TYPE_VALUES.includes(entity_type as EntityType)) {
    return c.json({ error: "Invalid entity type.", status: false }, 400);
  }

  // Validate file type
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    return c.json(
      {
        error: "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.",
        status: false,
      },
      400
    );
  }

  // Clamp size
  const sizeLimit = Math.min(size, FILE_SIZE_LIMIT);

  // Generate asset key
  const assetKey = `${workspace.id}/${createId()}-${name}`;

  // Create file asset record
  const assetId = createId();
  await db.insert(fileAssets).values({
    id: assetId,
    attributes: { name, type, size: sizeLimit },
    asset: assetKey,
    size: sizeLimit,
    workspaceId: workspace.id,
    entityType: entity_type,
    entityIdentifier: entity_identifier || null,
    createdById: user.id,
    isUploaded: false,
    isDeleted: false,
  });

  // Generate presigned upload URL
  const storage = getStorage();
  const uploadData = storage.generatePresignedUpload(assetKey, type, sizeLimit);

  const assetUrl = getAssetUrl(entity_type, assetId, workspace.slug);

  return c.json({
    upload_data: uploadData,
    asset_id: assetId,
    asset_url: assetUrl,
  });
});

// PATCH /api/assets/v2/workspaces/:slug/:assetId/ — Mark uploaded + bind entity
workspaceAssetRoutes.patch("/:assetId", zValidator("json", updateAssetSchema), async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;
  const body = c.req.valid("json");

  // Find asset
  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(fileAssets.id, assetId), eq(fileAssets.workspaceId, workspace.id)),
  });

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  // Mark as uploaded + update attributes
  const updates: Record<string, unknown> = {
    isUploaded: true,
    updatedAt: new Date(),
  };

  if (body.attributes) {
    updates.attributes = { ...((asset.attributes as Record<string, unknown>) || {}), ...body.attributes };
  }

  await db.update(fileAssets).set(updates).where(eq(fileAssets.id, assetId));

  // Fetch storage metadata asynchronously (best-effort)
  if (!asset.storageMetadata) {
    const storage = getStorage();
    storage.getObjectMetadata(asset.asset).then(async (metadata) => {
      if (metadata) {
        await db.update(fileAssets).set({ storageMetadata: metadata }).where(eq(fileAssets.id, assetId));
      }
    }).catch(() => { });
  }

  return c.body(null, 204);
});

// DELETE /api/assets/v2/workspaces/:slug/:assetId/ — Soft-delete
workspaceAssetRoutes.delete("/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;

  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(fileAssets.id, assetId), eq(fileAssets.workspaceId, workspace.id)),
  });

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  await db
    .update(fileAssets)
    .set({ isDeleted: true, deletedAt: new Date() })
    .where(eq(fileAssets.id, assetId));

  return c.body(null, 204);
});

// GET /api/assets/v2/workspaces/:slug/:assetId/ — Download (redirect to signed URL)
workspaceAssetRoutes.get("/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;

  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(fileAssets.id, assetId), eq(fileAssets.workspaceId, workspace.id)),
  });

  if (!asset || !asset.isUploaded) {
    return c.json({ error: "The requested asset could not be found." }, 404);
  }

  const storage = getStorage();
  const attrs = asset.attributes as { name?: string } | null;
  const signedUrl = storage.generatePresignedUrl(asset.asset, "attachment", attrs?.name);

  return c.redirect(signedUrl, 302);
});

// GET /api/assets/v2/workspaces/:slug/download/:assetId/ — Download with attachment header
workspaceAssetRoutes.get("/download/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;

  const asset = await db.query.fileAssets.findFirst({
    where: and(
      eq(fileAssets.id, assetId),
      eq(fileAssets.workspaceId, workspace.id),
      eq(fileAssets.isUploaded, true)
    ),
  });

  if (!asset) {
    return c.json({ error: "The requested asset could not be found." }, 404);
  }

  const storage = getStorage();
  const attrs = asset.attributes as { name?: string } | null;
  const signedUrl = storage.generatePresignedUrl(asset.asset, "attachment", attrs?.name || createId());

  return c.redirect(signedUrl, 302);
});

// GET /api/assets/v2/workspaces/:slug/check/:assetId/ — Check asset exists
workspaceAssetRoutes.get("/check/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;

  const asset = await db.query.fileAssets.findFirst({
    where: and(
      eq(fileAssets.id, assetId),
      eq(fileAssets.workspaceId, workspace.id)
    ),
  });

  return c.json({ exists: !!asset && !asset.isDeleted });
});

// POST /api/assets/v2/workspaces/:slug/restore/:assetId/ — Restore soft-deleted
workspaceAssetRoutes.post("/restore/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;

  await db
    .update(fileAssets)
    .set({ isDeleted: false, deletedAt: null })
    .where(and(eq(fileAssets.id, assetId), eq(fileAssets.workspaceId, workspace.id)));

  return c.body(null, 204);
});

// --- Project asset routes ---

const projectAssetRoutes = new Hono<{ Variables: Variables }>();
projectAssetRoutes.use("*", authMiddleware, workspaceMiddleware);

// POST /api/assets/v2/workspaces/:slug/projects/:projectId/ — Create project asset
projectAssetRoutes.post("/", zValidator("json", createAssetSchema), async (c) => {
  const user = c.get("user")!;
  const workspace = c.get("workspace")!;
  const projectId = c.req.param("projectId");
  const body = c.req.valid("json");

  const { name, type, size, entity_type, entity_identifier } = body;

  // Validate entity type
  if (!ENTITY_TYPE_VALUES.includes(entity_type as EntityType)) {
    return c.json({ error: "Invalid entity type.", status: false }, 400);
  }

  // Validate file type
  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    return c.json(
      {
        error: "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.",
        status: false,
      },
      400
    );
  }

  const sizeLimit = Math.min(size, FILE_SIZE_LIMIT);

  const assetKey = `${workspace.id}/${createId()}-${name}`;
  const assetId = createId();

  await db.insert(fileAssets).values({
    id: assetId,
    attributes: { name, type, size: sizeLimit },
    asset: assetKey,
    size: sizeLimit,
    workspaceId: workspace.id,
    projectId,
    entityType: entity_type,
    entityIdentifier: entity_identifier || null,
    createdById: user.id,
    isUploaded: false,
    isDeleted: false,
  });

  const storage = getStorage();
  const uploadData = storage.generatePresignedUpload(assetKey, type, sizeLimit);
  const assetUrl = getAssetUrl(entity_type, assetId, workspace.slug, projectId);

  return c.json({
    upload_data: uploadData,
    asset_id: assetId,
    asset_url: assetUrl,
  });
});

// PATCH /api/assets/v2/workspaces/:slug/projects/:projectId/:assetId/
projectAssetRoutes.patch("/:assetId", zValidator("json", updateAssetSchema), async (c) => {
  const assetId = c.req.param("assetId");

  const asset = await db.query.fileAssets.findFirst({
    where: eq(fileAssets.id, assetId),
  });

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const body = c.req.valid("json");
  const updates: Record<string, unknown> = {
    isUploaded: true,
    updatedAt: new Date(),
  };

  if (body.attributes) {
    updates.attributes = { ...((asset.attributes as Record<string, unknown>) || {}), ...body.attributes };
  }

  await db.update(fileAssets).set(updates).where(eq(fileAssets.id, assetId));

  // Best-effort metadata fetch
  if (!asset.storageMetadata) {
    const storage = getStorage();
    storage.getObjectMetadata(asset.asset).then(async (metadata) => {
      if (metadata) {
        await db.update(fileAssets).set({ storageMetadata: metadata }).where(eq(fileAssets.id, assetId));
      }
    }).catch(() => { });
  }

  return c.body(null, 204);
});

// DELETE /api/assets/v2/workspaces/:slug/projects/:projectId/:assetId/
projectAssetRoutes.delete("/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;
  const projectId = c.req.param("projectId");

  const asset = await db.query.fileAssets.findFirst({
    where: and(
      eq(fileAssets.id, assetId),
      eq(fileAssets.workspaceId, workspace.id),
      eq(fileAssets.projectId, projectId)
    ),
  });

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  await db
    .update(fileAssets)
    .set({ isDeleted: true, deletedAt: new Date() })
    .where(eq(fileAssets.id, assetId));

  return c.body(null, 204);
});

// GET /api/assets/v2/workspaces/:slug/projects/:projectId/:assetId/
projectAssetRoutes.get("/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;
  const projectId = c.req.param("projectId");

  const asset = await db.query.fileAssets.findFirst({
    where: and(
      eq(fileAssets.id, assetId),
      eq(fileAssets.workspaceId, workspace.id),
      eq(fileAssets.projectId, projectId)
    ),
  });

  if (!asset || !asset.isUploaded) {
    return c.json({ error: "The requested asset could not be found." }, 404);
  }

  const storage = getStorage();
  const attrs = asset.attributes as { name?: string } | null;
  const signedUrl = storage.generatePresignedUrl(asset.asset, "attachment", attrs?.name);

  return c.redirect(signedUrl, 302);
});

// GET /api/assets/v2/workspaces/:slug/projects/:projectId/download/:assetId/
projectAssetRoutes.get("/download/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const workspace = c.get("workspace")!;
  const projectId = c.req.param("projectId");

  const asset = await db.query.fileAssets.findFirst({
    where: and(
      eq(fileAssets.id, assetId),
      eq(fileAssets.workspaceId, workspace.id),
      eq(fileAssets.projectId, projectId),
      eq(fileAssets.isUploaded, true)
    ),
  });

  if (!asset) {
    return c.json({ error: "The requested asset could not be found." }, 404);
  }

  const storage = getStorage();
  const attrs = asset.attributes as { name?: string } | null;
  const signedUrl = storage.generatePresignedUrl(asset.asset, "attachment", attrs?.name || createId());

  return c.redirect(signedUrl, 302);
});

// --- Static asset route (public, no auth required) ---

const staticAssetRoutes = new Hono<{ Variables: Variables }>();

// GET /api/assets/v2/static/:assetId/ — Public static asset URL
staticAssetRoutes.get("/:assetId", async (c) => {
  const assetId = c.req.param("assetId");

  const asset = await db.query.fileAssets.findFirst({
    where: eq(fileAssets.id, assetId),
  });

  if (!asset || !asset.isUploaded) {
    return c.json({ error: "The requested asset could not be found." }, 404);
  }

  // Only allow static entity types
  if (!STATIC_ENTITY_TYPES.includes(asset.entityType as EntityType)) {
    return c.json({ error: "Invalid entity type.", status: false }, 400);
  }

  const storage = getStorage();
  const signedUrl = storage.generatePresignedUrl(asset.asset);

  return c.redirect(signedUrl, 302);
});

// --- User asset routes (auth required, no workspace) ---

const userAssetRoutes = new Hono<{ Variables: Variables }>();
userAssetRoutes.use("*", authMiddleware);

const createUserAssetSchema = z.object({
  name: z.string(),
  type: z.string().default("image/jpeg"),
  size: z.coerce.number().int().positive(),
  entity_type: z.enum(["USER_AVATAR", "USER_COVER"]),
});

// POST /api/assets/v2/user-assets/ — Create user asset
userAssetRoutes.post("/", zValidator("json", createUserAssetSchema), async (c) => {
  const user = c.get("user")!;
  const body = c.req.valid("json");

  const { name, type, size, entity_type } = body;

  if (!ALLOWED_IMAGE_TYPES.includes(type)) {
    return c.json(
      {
        error: "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.",
        status: false,
      },
      400
    );
  }

  const sizeLimit = Math.min(size, FILE_SIZE_LIMIT);
  const assetKey = `user-${createId()}-${name}`;
  const assetId = createId();

  await db.insert(fileAssets).values({
    id: assetId,
    attributes: { name, type, size: sizeLimit },
    asset: assetKey,
    size: sizeLimit,
    userId: user.id,
    entityType: entity_type,
    createdById: user.id,
    isUploaded: false,
    isDeleted: false,
  });

  const storage = getStorage();
  const uploadData = storage.generatePresignedUpload(assetKey, type, sizeLimit);
  const assetUrl = `/api/assets/v2/static/${assetId}/`;

  return c.json({
    upload_data: uploadData,
    asset_id: assetId,
    asset_url: assetUrl,
  });
});

// PATCH /api/assets/v2/user-assets/:assetId/ — Mark uploaded
userAssetRoutes.patch("/:assetId", zValidator("json", updateAssetSchema), async (c) => {
  const assetId = c.req.param("assetId");
  const user = c.get("user")!;

  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(fileAssets.id, assetId), eq(fileAssets.userId, user.id)),
  });

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  const body = c.req.valid("json");
  const updates: Record<string, unknown> = {
    isUploaded: true,
    updatedAt: new Date(),
  };

  if (body.attributes) {
    updates.attributes = { ...((asset.attributes as Record<string, unknown>) || {}), ...body.attributes };
  }

  await db.update(fileAssets).set(updates).where(eq(fileAssets.id, assetId));

  return c.body(null, 204);
});

// DELETE /api/assets/v2/user-assets/:assetId/ — Soft-delete user asset
userAssetRoutes.delete("/:assetId", async (c) => {
  const assetId = c.req.param("assetId");
  const user = c.get("user")!;

  const asset = await db.query.fileAssets.findFirst({
    where: and(eq(fileAssets.id, assetId), eq(fileAssets.userId, user.id)),
  });

  if (!asset) {
    return c.json({ error: "Asset not found." }, 404);
  }

  await db
    .update(fileAssets)
    .set({ isDeleted: true, deletedAt: new Date() })
    .where(eq(fileAssets.id, assetId));

  return c.body(null, 204);
});

// --- Local file upload/serve routes (when S3 is not configured) ---

const localAssetRoutes = new Hono<{ Variables: Variables }>();

// PUT /api/assets/v2/upload/:key — Direct file upload for local storage
localAssetRoutes.put("/upload/*", async (c) => {
  if (isS3Configured()) {
    return c.json({ error: "Local upload not available when S3 is configured." }, 400);
  }

  const key = c.req.path.replace("/api/assets/v2/upload/", "");
  const body = await c.req.blob();

  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
  const filePath = join(uploadDir, decodeURIComponent(key));

  // Ensure parent directory exists
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  try {
    const { mkdirSync } = require("fs");
    mkdirSync(dir, { recursive: true });
  } catch { }

  await Bun.write(filePath, body);

  return c.json({ status: "ok" });
});

// GET /api/assets/v2/local/:key — Serve local files
localAssetRoutes.get("/local/*", async (c) => {
  if (isS3Configured()) {
    return c.json({ error: "Local serve not available when S3 is configured." }, 400);
  }

  const key = c.req.path.replace("/api/assets/v2/local/", "");
  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), "uploads");
  const filePath = join(uploadDir, decodeURIComponent(key));

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return c.json({ error: "File not found." }, 404);
  }

  return new Response(file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
    },
  });
});

// --- Compose all asset routes ---

const assetRoutes = new Hono<{ Variables: Variables }>();

// Workspace-scoped
assetRoutes.route("/workspaces/:slug/projects/:projectId", projectAssetRoutes);
assetRoutes.route("/workspaces/:slug/", workspaceAssetRoutes);

// User-scoped
assetRoutes.route("/user-assets", userAssetRoutes);

// Public static
assetRoutes.route("/static", staticAssetRoutes);

// Local storage helpers
assetRoutes.route("/", localAssetRoutes);

export { assetRoutes };

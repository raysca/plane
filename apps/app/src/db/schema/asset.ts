import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects } from "./project";

// Entity type constants (match Django FileAsset.EntityTypeContext)
export const ENTITY_TYPES = {
  ISSUE_ATTACHMENT: "ISSUE_ATTACHMENT",
  ISSUE_DESCRIPTION: "ISSUE_DESCRIPTION",
  COMMENT_DESCRIPTION: "COMMENT_DESCRIPTION",
  PAGE_DESCRIPTION: "PAGE_DESCRIPTION",
  USER_COVER: "USER_COVER",
  USER_AVATAR: "USER_AVATAR",
  WORKSPACE_LOGO: "WORKSPACE_LOGO",
  PROJECT_COVER: "PROJECT_COVER",
  DRAFT_ISSUE_ATTACHMENT: "DRAFT_ISSUE_ATTACHMENT",
  DRAFT_ISSUE_DESCRIPTION: "DRAFT_ISSUE_DESCRIPTION",
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

// File assets
export const fileAssets = sqliteTable(
  "file_assets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    // File metadata
    attributes: text("attributes", { mode: "json" }).$type<{
      name?: string;
      type?: string;
      size?: number;
    }>(),
    asset: text("asset").notNull(), // S3 object key / storage path
    size: real("size").default(0),

    // Ownership
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),

    // Entity binding (issue_id, comment_id, page_id tracked via entityIdentifier)
    entityType: text("entity_type"),
    entityIdentifier: text("entity_identifier"),

    // Upload status
    isUploaded: integer("is_uploaded", { mode: "boolean" }).default(false),
    storageMetadata: text("storage_metadata", { mode: "json" }),

    // Soft delete
    isDeleted: integer("is_deleted", { mode: "boolean" }).default(false),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),

    // External tracking
    externalId: text("external_id"),
    externalSource: text("external_source"),

    // Audit
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("file_asset_workspace_idx").on(table.workspaceId),
    index("file_asset_entity_idx").on(table.entityType, table.entityIdentifier),
    index("file_asset_uploaded_by_idx").on(table.createdById),
    index("file_asset_asset_idx").on(table.asset),
  ]
);

// Relations
export const fileAssetsRelations = relations(fileAssets, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [fileAssets.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [fileAssets.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [fileAssets.userId],
    references: [users.id],
  }),
  createdBy: one(users, {
    fields: [fileAssets.createdById],
    references: [users.id],
    relationName: "createdBy",
  }),
}));

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";

// File assets
export const fileAssets = sqliteTable(
  "file_assets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    entityType: text("entity_type"), // 'issue', 'page', 'project', 'user', 'workspace'
    entityId: text("entity_id"),
    assetType: text("asset_type").notNull(), // 'cover', 'attachment', 'avatar', 'logo'
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type"),
    storageKey: text("storage_key").notNull(), // S3/local path
    storageProvider: text("storage_provider").default("local"), // 'local', 's3', 'r2'
    uploadedById: text("uploaded_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("file_asset_workspace_idx").on(table.workspaceId),
    index("file_asset_entity_idx").on(table.entityType, table.entityId),
    index("file_asset_uploaded_by_idx").on(table.uploadedById),
  ]
);

// Relations
export const fileAssetsRelations = relations(fileAssets, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [fileAssets.workspaceId],
    references: [workspaces.id],
  }),
  uploadedBy: one(users, {
    fields: [fileAssets.uploadedById],
    references: [users.id],
  }),
}));

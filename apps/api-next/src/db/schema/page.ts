import { sqliteTable, text, integer, real, index, unique, blob } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects } from "./project";

// Pages
export const pages = sqliteTable(
  "pages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    descriptionHtml: text("description_html"),
    descriptionStripped: text("description_stripped"),
    descriptionBinary: blob("description_binary"), // For collaborative editing (Y.js)
    colorProp: text("color_prop"),
    iconProp: text("icon_prop"),
    coverImage: text("cover_image"),
    accessLevel: integer("access_level").default(0), // 0=Private, 1=Collaborators
    isLocked: integer("is_locked", { mode: "boolean" }).default(false),
    ownedById: text("owned_by_id").references(() => users.id),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("page_workspace_idx").on(table.workspaceId),
    index("page_project_idx").on(table.projectId),
    index("page_parent_idx").on(table.parentId),
    index("page_owner_idx").on(table.ownedById),
  ]
);

// Page versions (history)
export const pageVersions = sqliteTable(
  "page_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    descriptionHtml: text("description_html"),
    descriptionStripped: text("description_stripped"),
    ownedById: text("owned_by_id").references(() => users.id),
    lastSavedAt: integer("last_saved_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("page_version_page_idx").on(table.pageId),
  ]
);

// Page favorites
export const pageFavorites = sqliteTable(
  "page_favorites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("page_favorite_unique").on(table.pageId, table.userId),
    index("page_favorite_page_idx").on(table.pageId),
    index("page_favorite_user_idx").on(table.userId),
  ]
);

// Page labels junction
export const pageLabels = sqliteTable(
  "page_labels",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    pageId: text("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    labelId: text("label_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("page_label_unique").on(table.pageId, table.labelId),
    index("page_label_page_idx").on(table.pageId),
  ]
);

// Relations
export const pagesRelations = relations(pages, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [pages.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [pages.projectId],
    references: [projects.id],
  }),
  parent: one(pages, {
    fields: [pages.parentId],
    references: [pages.id],
    relationName: "pageParentChild",
  }),
  children: many(pages, { relationName: "pageParentChild" }),
  ownedBy: one(users, {
    fields: [pages.ownedById],
    references: [users.id],
  }),
  versions: many(pageVersions),
  favorites: many(pageFavorites),
  labels: many(pageLabels),
}));

export const pageVersionsRelations = relations(pageVersions, ({ one }) => ({
  page: one(pages, {
    fields: [pageVersions.pageId],
    references: [pages.id],
  }),
  ownedBy: one(users, {
    fields: [pageVersions.ownedById],
    references: [users.id],
  }),
}));

export const pageFavoritesRelations = relations(pageFavorites, ({ one }) => ({
  page: one(pages, {
    fields: [pageFavorites.pageId],
    references: [pages.id],
  }),
  user: one(users, {
    fields: [pageFavorites.userId],
    references: [users.id],
  }),
}));

export const pageLabelsRelations = relations(pageLabels, ({ one }) => ({
  page: one(pages, {
    fields: [pageLabels.pageId],
    references: [pages.id],
  }),
}));

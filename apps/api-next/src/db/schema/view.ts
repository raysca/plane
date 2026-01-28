import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects } from "./project";

// Views (saved filters)
export const views = sqliteTable(
  "views",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    query: text("query", { mode: "json" }).notNull(), // Filter configuration
    queryData: text("query_data", { mode: "json" }), // Additional query params
    filtersData: text("filters_data", { mode: "json" }), // Computed filter data
    displayFilters: text("display_filters", { mode: "json" }),
    displayProperties: text("display_properties", { mode: "json" }),
    accessLevel: integer("access_level").default(1), // 0=Private, 1=Project, 2=Workspace
    sortOrder: real("sort_order").default(65535),
    isLocked: integer("is_locked", { mode: "boolean" }).default(false),
    ownedById: text("owned_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("view_workspace_idx").on(table.workspaceId),
    index("view_project_idx").on(table.projectId),
    index("view_owner_idx").on(table.ownedById),
  ]
);

// View favorites
export const viewFavorites = sqliteTable(
  "view_favorites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    viewId: text("view_id")
      .notNull()
      .references(() => views.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("view_favorite_unique").on(table.viewId, table.userId),
    index("view_favorite_view_idx").on(table.viewId),
    index("view_favorite_user_idx").on(table.userId),
  ]
);

// Relations
export const viewsRelations = relations(views, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [views.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [views.projectId],
    references: [projects.id],
  }),
  ownedBy: one(users, {
    fields: [views.ownedById],
    references: [users.id],
  }),
  favorites: many(viewFavorites),
}));

export const viewFavoritesRelations = relations(viewFavorites, ({ one }) => ({
  view: one(views, {
    fields: [viewFavorites.viewId],
    references: [views.id],
  }),
  user: one(users, {
    fields: [viewFavorites.userId],
    references: [users.id],
  }),
}));

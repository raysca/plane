import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";

// Workspaces
export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    organizationSize: text("organization_size"),
    timezone: text("timezone").default("UTC"),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("workspace_slug_idx").on(table.slug),
    index("workspace_owner_idx").on(table.ownerId),
  ]
);

// Workspace members
export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: integer("role").notNull().default(15), // 5=Guest, 10=Viewer, 15=Member, 20=Admin
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    viewProps: text("view_props", { mode: "json" }),
    defaultProps: text("default_props", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("workspace_member_unique").on(table.workspaceId, table.userId),
    index("workspace_member_workspace_idx").on(table.workspaceId),
    index("workspace_member_user_idx").on(table.userId),
  ]
);

// Workspace invitations
export const workspaceInvitations = sqliteTable(
  "workspace_invitations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: integer("role").notNull().default(15),
    token: text("token").notNull().unique(),
    message: text("message"),
    respondedAt: integer("responded_at", { mode: "timestamp" }),
    accepted: integer("accepted", { mode: "boolean" }),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("workspace_invitation_workspace_idx").on(table.workspaceId),
    index("workspace_invitation_token_idx").on(table.token),
  ]
);

// Workspace labels
export const workspaceLabels = sqliteTable(
  "workspace_labels",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#000000"),
    description: text("description"),
    sortOrder: real("sort_order").default(65535),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("workspace_label_workspace_idx").on(table.workspaceId),
  ]
);

// Favorites
export const favorites = sqliteTable(
  "favorites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(), // project, cycle, module, view, page
    entityId: text("entity_id").notNull(),
    sortOrder: real("sort_order").default(65535),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("favorite_user_workspace_idx").on(table.userId, table.workspaceId),
    index("favorite_entity_idx").on(table.entityType, table.entityId),
  ]
);

// Recent visits
export const recentVisits = sqliteTable(
  "recent_visits",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    visitedAt: integer("visited_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("recent_visit_user_workspace_idx").on(table.userId, table.workspaceId),
  ]
);

// Quick links
export const quickLinks = sqliteTable(
  "quick_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    description: text("description"),
    sortOrder: real("sort_order").default(65535),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("quick_link_user_workspace_idx").on(table.userId, table.workspaceId),
  ]
);

// Stickies
export const stickies = sqliteTable(
  "stickies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    description: text("description"),
    color: text("color").default("#FEF3C7"),
    sortOrder: real("sort_order").default(65535),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("sticky_user_workspace_idx").on(table.userId, table.workspaceId),
  ]
);

// Relations
export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, {
    fields: [workspaces.ownerId],
    references: [users.id],
  }),
  members: many(workspaceMembers),
  invitations: many(workspaceInvitations),
  labels: many(workspaceLabels),
  favorites: many(favorites),
  quickLinks: many(quickLinks),
  stickies: many(stickies),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMembers.userId],
    references: [users.id],
  }),
}));

export const workspaceInvitationsRelations = relations(workspaceInvitations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceInvitations.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [workspaceInvitations.createdById],
    references: [users.id],
  }),
}));

export const workspaceLabelsRelations = relations(workspaceLabels, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceLabels.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [workspaceLabels.createdById],
    references: [users.id],
  }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [favorites.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [favorites.userId],
    references: [users.id],
  }),
}));

export const quickLinksRelations = relations(quickLinks, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [quickLinks.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [quickLinks.userId],
    references: [users.id],
  }),
}));

export const stickiesRelations = relations(stickies, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [stickies.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [stickies.userId],
    references: [users.id],
  }),
}));

import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects } from "./project";
import { issues } from "./issue";

// Modules
export const modules = sqliteTable(
  "modules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    descriptionText: text("description_text"),
    descriptionHtml: text("description_html"),
    startDate: integer("start_date", { mode: "timestamp" }),
    targetDate: integer("target_date", { mode: "timestamp" }),
    status: text("status").default("backlog"), // backlog, planned, in-progress, paused, completed, cancelled
    leadId: text("lead_id").references(() => users.id),
    sortOrder: real("sort_order").default(65535),
    viewProps: text("view_props", { mode: "json" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("module_project_idx").on(table.projectId),
    index("module_workspace_idx").on(table.workspaceId),
  ]
);

// Module issues junction
export const moduleIssues = sqliteTable(
  "module_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("module_issue_unique").on(table.moduleId, table.issueId),
    index("module_issue_module_idx").on(table.moduleId),
    index("module_issue_issue_idx").on(table.issueId),
  ]
);

// Module members
export const moduleMembers = sqliteTable(
  "module_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("module_member_unique").on(table.moduleId, table.memberId),
    index("module_member_module_idx").on(table.moduleId),
    index("module_member_member_idx").on(table.memberId),
  ]
);

// Module favorites
export const moduleFavorites = sqliteTable(
  "module_favorites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("module_favorite_unique").on(table.moduleId, table.userId),
    index("module_favorite_module_idx").on(table.moduleId),
    index("module_favorite_user_idx").on(table.userId),
  ]
);

// Module links
export const moduleLinks = sqliteTable(
  "module_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    title: text("title"),
    url: text("url").notNull(),
    metadata: text("metadata", { mode: "json" }),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("module_link_module_idx").on(table.moduleId),
  ]
);

// Relations
export const modulesRelations = relations(modules, ({ one, many }) => ({
  project: one(projects, {
    fields: [modules.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [modules.workspaceId],
    references: [workspaces.id],
  }),
  lead: one(users, {
    fields: [modules.leadId],
    references: [users.id],
    relationName: "moduleLead",
  }),
  createdBy: one(users, {
    fields: [modules.createdById],
    references: [users.id],
    relationName: "moduleCreatedBy",
  }),
  issues: many(moduleIssues),
  members: many(moduleMembers),
  favorites: many(moduleFavorites),
  links: many(moduleLinks),
}));

export const moduleIssuesRelations = relations(moduleIssues, ({ one }) => ({
  module: one(modules, {
    fields: [moduleIssues.moduleId],
    references: [modules.id],
  }),
  issue: one(issues, {
    fields: [moduleIssues.issueId],
    references: [issues.id],
  }),
}));

export const moduleMembersRelations = relations(moduleMembers, ({ one }) => ({
  module: one(modules, {
    fields: [moduleMembers.moduleId],
    references: [modules.id],
  }),
  member: one(users, {
    fields: [moduleMembers.memberId],
    references: [users.id],
  }),
}));

export const moduleFavoritesRelations = relations(moduleFavorites, ({ one }) => ({
  module: one(modules, {
    fields: [moduleFavorites.moduleId],
    references: [modules.id],
  }),
  user: one(users, {
    fields: [moduleFavorites.userId],
    references: [users.id],
  }),
}));

export const moduleLinksRelations = relations(moduleLinks, ({ one }) => ({
  module: one(modules, {
    fields: [moduleLinks.moduleId],
    references: [modules.id],
  }),
  createdBy: one(users, {
    fields: [moduleLinks.createdById],
    references: [users.id],
  }),
}));

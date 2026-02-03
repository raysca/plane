import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects } from "./project";
import { issues } from "./issue";

// Cycles (Sprints)
export const cycles = sqliteTable(
  "cycles",
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
    startDate: integer("start_date", { mode: "timestamp" }),
    endDate: integer("end_date", { mode: "timestamp" }),
    ownedById: text("owned_by_id").references(() => users.id),
    sortOrder: real("sort_order").default(65535),
    viewProps: text("view_props", { mode: "json" }),
    progressSnapshot: text("progress_snapshot", { mode: "json" }),
    isActive: integer("is_active", { mode: "boolean" }).default(false),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("cycle_project_idx").on(table.projectId),
    index("cycle_workspace_idx").on(table.workspaceId),
  ]
);

// Cycle issues junction
export const cycleIssues = sqliteTable(
  "cycle_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("cycle_issue_unique").on(table.cycleId, table.issueId),
    index("cycle_issue_cycle_idx").on(table.cycleId),
    index("cycle_issue_issue_idx").on(table.issueId),
  ]
);

// Cycle favorites
export const cycleFavorites = sqliteTable(
  "cycle_favorites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("cycle_favorite_unique").on(table.cycleId, table.userId),
    index("cycle_favorite_cycle_idx").on(table.cycleId),
    index("cycle_favorite_user_idx").on(table.userId),
  ]
);

// Relations
export const cyclesRelations = relations(cycles, ({ one, many }) => ({
  project: one(projects, {
    fields: [cycles.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [cycles.workspaceId],
    references: [workspaces.id],
  }),
  ownedBy: one(users, {
    fields: [cycles.ownedById],
    references: [users.id],
  }),
  issues: many(cycleIssues),
  favorites: many(cycleFavorites),
}));

export const cycleIssuesRelations = relations(cycleIssues, ({ one }) => ({
  cycle: one(cycles, {
    fields: [cycleIssues.cycleId],
    references: [cycles.id],
  }),
  issue: one(issues, {
    fields: [cycleIssues.issueId],
    references: [issues.id],
  }),
}));

export const cycleFavoritesRelations = relations(cycleFavorites, ({ one }) => ({
  cycle: one(cycles, {
    fields: [cycleFavorites.cycleId],
    references: [cycles.id],
  }),
  user: one(users, {
    fields: [cycleFavorites.userId],
    references: [users.id],
  }),
}));

// --- Default Props for Cycle User Properties ---
const defaultFilters = {
  priority: null,
  state: null,
  state_group: null,
  assignees: null,
  created_by: null,
  labels: null,
  start_date: null,
  target_date: null,
  subscriber: null,
};

const defaultDisplayFilters = {
  group_by: null,
  order_by: "-created_at",
  type: null,
  sub_issue: true,
  show_empty_groups: true,
  layout: "list",
  calendar_date_range: "",
};

const defaultDisplayProperties = {
  assignee: true,
  attachment_count: true,
  created_on: true,
  due_date: true,
  estimate: true,
  key: true,
  labels: true,
  link: true,
  priority: true,
  start_date: true,
  state: true,
  sub_issue_count: true,
  updated_on: true,
};

// Cycle User Properties (per-user display settings for a cycle)
export const cycleUserProperties = sqliteTable(
  "cycle_user_properties",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filters: text("filters", { mode: "json" }).$defaultFn(() => defaultFilters),
    displayFilters: text("display_filters", { mode: "json" }).$defaultFn(() => defaultDisplayFilters),
    displayProperties: text("display_properties", { mode: "json" }).$defaultFn(() => defaultDisplayProperties),
    richFilters: text("rich_filters", { mode: "json" }).$defaultFn(() => ({})),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("cycle_user_prop_unique").on(table.cycleId, table.userId),
    index("cycle_user_prop_cycle_idx").on(table.cycleId),
    index("cycle_user_prop_user_idx").on(table.userId),
  ]
);

export const cycleUserPropertiesRelations = relations(cycleUserProperties, ({ one }) => ({
  cycle: one(cycles, {
    fields: [cycleUserProperties.cycleId],
    references: [cycles.id],
  }),
  project: one(projects, {
    fields: [cycleUserProperties.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [cycleUserProperties.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [cycleUserProperties.userId],
    references: [users.id],
  }),
}));

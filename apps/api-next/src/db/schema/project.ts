import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";

// Projects
export const projects = sqliteTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    descriptionText: text("description_text"),
    descriptionHtml: text("description_html"),
    network: integer("network").default(2), // 0=Secret, 2=Public
    identifier: text("identifier").notNull(),
    emoji: text("emoji"),
    iconProp: text("icon_prop", { mode: "json" }),
    coverImage: text("cover_image"),
    archiveIn: integer("archive_in").default(0),
    closeIn: integer("close_in").default(0),
    defaultAssigneeId: text("default_assignee_id").references(() => users.id),
    defaultStateId: text("default_state_id"),
    projectLeadId: text("project_lead_id").references(() => users.id),
    estimateId: text("estimate_id"),
    logoProps: text("logo_props", { mode: "json" }),
    cycleView: integer("cycle_view", { mode: "boolean" }).default(true),
    moduleView: integer("module_view", { mode: "boolean" }).default(true),
    issueViewsView: integer("issue_views_view", { mode: "boolean" }).default(true),
    pageView: integer("page_view", { mode: "boolean" }).default(true),
    intakeView: integer("intake_view", { mode: "boolean" }).default(false),
    guestViewAllFeatures: integer("guest_view_all_features", { mode: "boolean" }).default(false),
    isTimeTrackingEnabled: integer("is_time_tracking_enabled", { mode: "boolean" }).default(false),
    isIssueTypeEnabled: integer("is_issue_type_enabled", { mode: "boolean" }).default(false),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    sortOrder: real("sort_order").default(65535),
    isMemberAdded: integer("is_member_added", { mode: "boolean" }).default(false),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    index("project_workspace_idx").on(table.workspaceId),
    unique("project_identifier_unique").on(table.workspaceId, table.identifier),
  ]
);

// Project members
export const projectMembers = sqliteTable(
  "project_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    memberId: text("member_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: integer("role").notNull().default(15), // 5=Guest, 10=Viewer, 15=Member, 20=Admin
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    viewProps: text("view_props", { mode: "json" }),
    defaultProps: text("default_props", { mode: "json" }),
    preferences: text("preferences", { mode: "json" }),
    sortOrder: real("sort_order").default(65535),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("project_member_unique").on(table.projectId, table.memberId),
    index("project_member_project_idx").on(table.projectId),
    index("project_member_member_idx").on(table.memberId),
  ]
);

// Project states
export const states = sqliteTable(
  "states",
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
    color: text("color").notNull(),
    group: text("group").notNull(), // 'backlog', 'unstarted', 'started', 'completed', 'cancelled', 'triage'
    description: text("description"),
    sequence: real("sequence").default(65535),
    isDefault: integer("is_default", { mode: "boolean" }).default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("state_project_idx").on(table.projectId),
    index("state_workspace_idx").on(table.workspaceId),
  ]
);

// Project labels
export const labels = sqliteTable(
  "labels",
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
    parentId: text("parent_id"),
    name: text("name").notNull(),
    color: text("color").notNull().default("#000000"),
    description: text("description"),
    sortOrder: real("sort_order").default(65535),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("label_project_idx").on(table.projectId),
    index("label_workspace_idx").on(table.workspaceId),
  ]
);

// Estimates
export const estimates = sqliteTable(
  "estimates",
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
    type: text("type").default("categories"), // 'categories', 'points', 'time'
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("estimate_project_idx").on(table.projectId),
  ]
);

// Estimate points
export const estimatePoints = sqliteTable(
  "estimate_points",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    estimateId: text("estimate_id")
      .notNull()
      .references(() => estimates.id, { onDelete: "cascade" }),
    key: integer("key").notNull(),
    value: text("value").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("estimate_point_estimate_idx").on(table.estimateId),
  ]
);

// Relations
export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  defaultAssignee: one(users, {
    fields: [projects.defaultAssigneeId],
    references: [users.id],
    relationName: "defaultAssignee",
  }),
  projectLead: one(users, {
    fields: [projects.projectLeadId],
    references: [users.id],
    relationName: "projectLead",
  }),
  createdBy: one(users, {
    fields: [projects.createdById],
    references: [users.id],
    relationName: "createdBy",
  }),
  members: many(projectMembers),
  states: many(states),
  labels: many(labels),
  estimates: many(estimates),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  member: one(users, {
    fields: [projectMembers.memberId],
    references: [users.id],
  }),
}));

export const statesRelations = relations(states, ({ one }) => ({
  project: one(projects, {
    fields: [states.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [states.workspaceId],
    references: [workspaces.id],
  }),
}));

export const labelsRelations = relations(labels, ({ one }) => ({
  project: one(projects, {
    fields: [labels.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [labels.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [labels.createdById],
    references: [users.id],
  }),
  parent: one(labels, {
    fields: [labels.parentId],
    references: [labels.id],
  }),
}));

export const estimatesRelations = relations(estimates, ({ one, many }) => ({
  project: one(projects, {
    fields: [estimates.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [estimates.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [estimates.createdById],
    references: [users.id],
  }),
  points: many(estimatePoints),
}));

export const estimatePointsRelations = relations(estimatePoints, ({ one }) => ({
  estimate: one(estimates, {
    fields: [estimatePoints.estimateId],
    references: [estimates.id],
  }),
}));

// --- Default Props for Project User Properties ---
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

const defaultPreferences = {
  pages: { block_display: true },
  navigation: { default_tab: "work_items", hide_in_more_menu: [] },
};

// Project User Properties (per-user display settings for a project)
export const projectUserProperties = sqliteTable(
  "project_user_properties",
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filters: text("filters", { mode: "json" }).$defaultFn(() => defaultFilters),
    displayFilters: text("display_filters", { mode: "json" }).$defaultFn(() => defaultDisplayFilters),
    displayProperties: text("display_properties", { mode: "json" }).$defaultFn(() => defaultDisplayProperties),
    richFilters: text("rich_filters", { mode: "json" }).$defaultFn(() => ({})),
    preferences: text("preferences", { mode: "json" }).$defaultFn(() => defaultPreferences),
    sortOrder: real("sort_order").default(65535),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("project_user_prop_unique").on(table.projectId, table.userId),
    index("project_user_prop_project_idx").on(table.projectId),
    index("project_user_prop_user_idx").on(table.userId),
  ]
);

export const projectUserPropertiesRelations = relations(projectUserProperties, ({ one }) => ({
  project: one(projects, {
    fields: [projectUserProperties.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [projectUserProperties.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [projectUserProperties.userId],
    references: [users.id],
  }),
}));

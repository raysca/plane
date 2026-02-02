import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects, states, labels } from "./project";
import { issues } from "./issue";
import { cycles } from "./cycle";
import { modules } from "./module";

// Draft Issues
export const draftIssues = sqliteTable(
  "draft_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: text("parent_id").references(() => issues.id),
    stateId: text("state_id").references(() => states.id),
    estimatePoint: text("estimate_point"),
    name: text("name"),
    descriptionHtml: text("description_html").default("<p></p>"),
    descriptionStripped: text("description_stripped"),
    descriptionBinary: text("description_binary"),
    priority: text("priority").default("none"), // urgent, high, medium, low, none
    startDate: text("start_date"), // stored as ISO date string (YYYY-MM-DD)
    targetDate: text("target_date"),
    sortOrder: real("sort_order").default(65535),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    typeId: text("type_id"),
    createdById: text("created_by_id").references(() => users.id),
    updatedById: text("updated_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    index("draft_issue_project_idx").on(table.projectId),
    index("draft_issue_workspace_idx").on(table.workspaceId),
    index("draft_issue_state_idx").on(table.stateId),
    index("draft_issue_created_by_idx").on(table.createdById),
  ]
);

// Draft Issue Assignees
export const draftIssueAssignees = sqliteTable(
  "draft_issue_assignees",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    draftIssueId: text("draft_issue_id")
      .notNull()
      .references(() => draftIssues.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    createdById: text("created_by_id").references(() => users.id),
    updatedById: text("updated_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    unique("draft_issue_assignee_unique").on(table.draftIssueId, table.assigneeId),
    index("draft_issue_assignee_draft_idx").on(table.draftIssueId),
    index("draft_issue_assignee_user_idx").on(table.assigneeId),
  ]
);

// Draft Issue Labels
export const draftIssueLabels = sqliteTable(
  "draft_issue_labels",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    draftIssueId: text("draft_issue_id")
      .notNull()
      .references(() => draftIssues.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    createdById: text("created_by_id").references(() => users.id),
    updatedById: text("updated_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    unique("draft_issue_label_unique").on(table.draftIssueId, table.labelId),
    index("draft_issue_label_draft_idx").on(table.draftIssueId),
    index("draft_issue_label_label_idx").on(table.labelId),
  ]
);

// Draft Issue Modules
export const draftIssueModules = sqliteTable(
  "draft_issue_modules",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    draftIssueId: text("draft_issue_id")
      .notNull()
      .references(() => draftIssues.id, { onDelete: "cascade" }),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    createdById: text("created_by_id").references(() => users.id),
    updatedById: text("updated_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    unique("draft_issue_module_unique").on(table.draftIssueId, table.moduleId),
    index("draft_issue_module_draft_idx").on(table.draftIssueId),
    index("draft_issue_module_module_idx").on(table.moduleId),
  ]
);

// Draft Issue Cycles
export const draftIssueCycles = sqliteTable(
  "draft_issue_cycles",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    draftIssueId: text("draft_issue_id")
      .notNull()
      .references(() => draftIssues.id, { onDelete: "cascade" }),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    createdById: text("created_by_id").references(() => users.id),
    updatedById: text("updated_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    unique("draft_issue_cycle_unique").on(table.draftIssueId, table.cycleId),
    index("draft_issue_cycle_draft_idx").on(table.draftIssueId),
    index("draft_issue_cycle_cycle_idx").on(table.cycleId),
  ]
);

// --- Relations ---

export const draftIssuesRelations = relations(draftIssues, ({ one, many }) => ({
  project: one(projects, {
    fields: [draftIssues.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [draftIssues.workspaceId],
    references: [workspaces.id],
  }),
  state: one(states, {
    fields: [draftIssues.stateId],
    references: [states.id],
  }),
  parent: one(issues, {
    fields: [draftIssues.parentId],
    references: [issues.id],
  }),
  createdBy: one(users, {
    fields: [draftIssues.createdById],
    references: [users.id],
    relationName: "draftCreatedBy",
  }),
  updatedBy: one(users, {
    fields: [draftIssues.updatedById],
    references: [users.id],
    relationName: "draftUpdatedBy",
  }),
  assignees: many(draftIssueAssignees),
  labels: many(draftIssueLabels),
  modules: many(draftIssueModules),
  cycles: many(draftIssueCycles),
}));

export const draftIssueAssigneesRelations = relations(draftIssueAssignees, ({ one }) => ({
  draftIssue: one(draftIssues, {
    fields: [draftIssueAssignees.draftIssueId],
    references: [draftIssues.id],
  }),
  assignee: one(users, {
    fields: [draftIssueAssignees.assigneeId],
    references: [users.id],
  }),
}));

export const draftIssueLabelsRelations = relations(draftIssueLabels, ({ one }) => ({
  draftIssue: one(draftIssues, {
    fields: [draftIssueLabels.draftIssueId],
    references: [draftIssues.id],
  }),
  label: one(labels, {
    fields: [draftIssueLabels.labelId],
    references: [labels.id],
  }),
}));

export const draftIssueModulesRelations = relations(draftIssueModules, ({ one }) => ({
  draftIssue: one(draftIssues, {
    fields: [draftIssueModules.draftIssueId],
    references: [draftIssues.id],
  }),
  module: one(modules, {
    fields: [draftIssueModules.moduleId],
    references: [modules.id],
  }),
}));

export const draftIssueCyclesRelations = relations(draftIssueCycles, ({ one }) => ({
  draftIssue: one(draftIssues, {
    fields: [draftIssueCycles.draftIssueId],
    references: [draftIssues.id],
  }),
  cycle: one(cycles, {
    fields: [draftIssueCycles.cycleId],
    references: [cycles.id],
  }),
}));

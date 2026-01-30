import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects } from "./project";
import { issues } from "./issue";

// Intakes (one per project)
export const intakes = sqliteTable(
  "intakes",
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
    description: text("description").default(""),
    isDefault: integer("is_default", { mode: "boolean" }).default(false),
    viewProps: text("view_props", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    logoProps: text("logo_props", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    index("intake_project_idx").on(table.projectId),
    index("intake_workspace_idx").on(table.workspaceId),
  ]
);

// Intake Issues (linking intake to issues with triage status)
export const intakeIssues = sqliteTable(
  "intake_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    intakeId: text("intake_id")
      .notNull()
      .references(() => intakes.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: integer("status").default(-2), // -2=Pending, -1=Rejected, 0=Snoozed, 1=Accepted, 2=Duplicate
    snoozedTill: integer("snoozed_till", { mode: "timestamp" }),
    duplicateToId: text("duplicate_to_id").references(() => issues.id),
    source: text("source").default("IN_APP"),
    sourceEmail: text("source_email"),
    externalSource: text("external_source"),
    externalId: text("external_id"),
    extra: text("extra", { mode: "json" }).$type<Record<string, unknown>>().default({}),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("intake_issue_intake_idx").on(table.intakeId),
    index("intake_issue_issue_idx").on(table.issueId),
    index("intake_issue_project_idx").on(table.projectId),
    index("intake_issue_status_idx").on(table.status),
  ]
);

// Relations
export const intakesRelations = relations(intakes, ({ one, many }) => ({
  project: one(projects, {
    fields: [intakes.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [intakes.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [intakes.createdById],
    references: [users.id],
  }),
  issues: many(intakeIssues),
}));

export const intakeIssuesRelations = relations(intakeIssues, ({ one }) => ({
  intake: one(intakes, {
    fields: [intakeIssues.intakeId],
    references: [intakes.id],
  }),
  issue: one(issues, {
    fields: [intakeIssues.issueId],
    references: [issues.id],
    relationName: "intakeIssue",
  }),
  duplicateTo: one(issues, {
    fields: [intakeIssues.duplicateToId],
    references: [issues.id],
    relationName: "intakeDuplicate",
  }),
  project: one(projects, {
    fields: [intakeIssues.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [intakeIssues.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [intakeIssues.createdById],
    references: [users.id],
  }),
}));

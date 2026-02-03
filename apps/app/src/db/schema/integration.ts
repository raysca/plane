import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects } from "./project";

// Integration definitions
export const integrations = sqliteTable("integrations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  title: text("title").notNull(),
  provider: text("provider").notNull().unique(), // 'github', 'gitlab', 'slack', etc.
  description: text("description"),
  avatar: text("avatar"),
  network: integer("network").default(1), // 0=Private, 1=Public
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  metadata: text("metadata", { mode: "json" }),
  verified: integer("verified", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Workspace integrations
export const workspaceIntegrations = sqliteTable(
  "workspace_integrations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id),
    apiToken: text("api_token"),
    metadata: text("metadata", { mode: "json" }),
    config: text("config", { mode: "json" }),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("workspace_integration_unique").on(
      table.workspaceId,
      table.integrationId
    ),
    index("workspace_integration_workspace_idx").on(table.workspaceId),
  ]
);

// Project integrations (GitHub repos, etc.)
export const projectIntegrations = sqliteTable(
  "project_integrations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceIntegrationId: text("workspace_integration_id")
      .notNull()
      .references(() => workspaceIntegrations.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id),
    config: text("config", { mode: "json" }), // e.g., { repo: 'owner/repo' }
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("project_integration_project_idx").on(table.projectId),
    index("project_integration_workspace_int_idx").on(
      table.workspaceIntegrationId
    ),
  ]
);

// GitHub-specific: comment syncs
export const githubCommentSyncs = sqliteTable(
  "github_comment_syncs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    issueId: text("issue_id").notNull(),
    commentId: text("comment_id").notNull(),
    githubCommentId: text("github_comment_id").notNull(),
    repoId: text("repo_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("github_comment_sync_issue_idx").on(table.issueId),
  ]
);

// GitHub-specific: issue syncs
export const githubIssueSyncs = sqliteTable(
  "github_issue_syncs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    issueId: text("issue_id").notNull(),
    githubIssueId: text("github_issue_id").notNull(),
    repoId: text("repo_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("github_issue_sync_issue_idx").on(table.issueId),
    index("github_issue_sync_github_idx").on(table.githubIssueId),
  ]
);

// Relations
export const integrationsRelations = relations(integrations, ({ many }) => ({
  workspaceIntegrations: many(workspaceIntegrations),
}));

export const workspaceIntegrationsRelations = relations(workspaceIntegrations, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [workspaceIntegrations.workspaceId],
    references: [workspaces.id],
  }),
  integration: one(integrations, {
    fields: [workspaceIntegrations.integrationId],
    references: [integrations.id],
  }),
  actor: one(users, {
    fields: [workspaceIntegrations.actorId],
    references: [users.id],
  }),
  projectIntegrations: many(projectIntegrations),
}));

export const projectIntegrationsRelations = relations(projectIntegrations, ({ one }) => ({
  project: one(projects, {
    fields: [projectIntegrations.projectId],
    references: [projects.id],
  }),
  workspaceIntegration: one(workspaceIntegrations, {
    fields: [projectIntegrations.workspaceIntegrationId],
    references: [workspaceIntegrations.id],
  }),
  actor: one(users, {
    fields: [projectIntegrations.actorId],
    references: [users.id],
  }),
}));

import { sqliteTable, text, integer, real, index, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects, states, labels } from "./project";

// Issues
export const issues = sqliteTable(
  "issues",
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
    stateId: text("state_id").references(() => states.id),
    name: text("name").notNull(),
    descriptionHtml: text("description_html"),
    descriptionStripped: text("description_stripped"),
    descriptionBinary: text("description_binary"), // For collaborative editing
    priority: integer("priority").default(0), // 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
    sortOrder: real("sort_order").default(65535),
    startDate: integer("start_date", { mode: "timestamp" }),
    targetDate: integer("target_date", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    sequenceId: integer("sequence_id"),
    estimatePoint: integer("estimate_point"),
    isEpic: integer("is_epic", { mode: "boolean" }).default(false),
    createdById: text("created_by_id").references(() => users.id),
    updatedById: text("updated_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => [
    index("issue_project_idx").on(table.projectId),
    index("issue_workspace_idx").on(table.workspaceId),
    index("issue_state_idx").on(table.stateId),
    index("issue_parent_idx").on(table.parentId),
    index("issue_sequence_idx").on(table.projectId, table.sequenceId),
  ]
);

// Issue assignees
export const issueAssignees = sqliteTable(
  "issue_assignees",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    assigneeId: text("assignee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("issue_assignee_unique").on(table.issueId, table.assigneeId),
    index("issue_assignee_issue_idx").on(table.issueId),
    index("issue_assignee_assignee_idx").on(table.assigneeId),
  ]
);

// Issue labels
export const issueLabels = sqliteTable(
  "issue_labels",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    labelId: text("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("issue_label_unique").on(table.issueId, table.labelId),
    index("issue_label_issue_idx").on(table.issueId),
    index("issue_label_label_idx").on(table.labelId),
  ]
);

// Issue comments
export const issueComments = sqliteTable(
  "issue_comments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    commentHtml: text("comment_html"),
    commentStripped: text("comment_stripped"),
    commentJson: text("comment_json", { mode: "json" }),
    accessLevel: integer("access_level").default(0), // 0=Internal, 1=External
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("issue_comment_issue_idx").on(table.issueId),
    index("issue_comment_actor_idx").on(table.actorId),
  ]
);

// Issue activities (history)
export const issueActivities = sqliteTable(
  "issue_activities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    verb: text("verb").notNull(), // 'created', 'updated', 'deleted'
    oldIdentifier: text("old_identifier"),
    newIdentifier: text("new_identifier"),
    epochTimestamp: integer("epoch_timestamp"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("issue_activity_issue_idx").on(table.issueId),
    index("issue_activity_project_idx").on(table.projectId),
    index("issue_activity_actor_idx").on(table.actorId),
  ]
);

// Issue reactions
export const issueReactions = sqliteTable(
  "issue_reactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    reaction: text("reaction").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ([
    unique("issue_reaction_unique").on(
      table.issueId,
      table.actorId,
      table.reaction
    ),
    index("issue_reaction_issue_idx").on(table.issueId),
  ])
);

// Comment reactions
export const commentReactions = sqliteTable(
  "comment_reactions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    commentId: text("comment_id")
      .notNull()
      .references(() => issueComments.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    reaction: text("reaction").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("comment_reaction_unique").on(
      table.commentId,
      table.actorId,
      table.reaction
    ),
    index("comment_reaction_comment_idx").on(table.commentId),
  ]
);

// Issue relations
export const issueRelations = sqliteTable(
  "issue_relations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    relatedIssueId: text("related_issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(), // 'blocks', 'is_blocked_by', 'duplicate_of', 'relates_to'
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("issue_relation_unique").on(
      table.issueId,
      table.relatedIssueId,
      table.relationType
    ),
    index("issue_relation_issue_idx").on(table.issueId),
    index("issue_relation_related_idx").on(table.relatedIssueId),
  ]
);

// Issue attachments
export const issueAttachments = sqliteTable(
  "issue_attachments",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    mimeType: text("mime_type"),
    storageKey: text("storage_key").notNull(),
    uploadedById: text("uploaded_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("issue_attachment_issue_idx").on(table.issueId),
  ]
);

// Issue links
export const issueLinks = sqliteTable(
  "issue_links",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    title: text("title"),
    url: text("url").notNull(),
    metadata: text("metadata", { mode: "json" }),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("issue_link_issue_idx").on(table.issueId),
  ]
);

// Relations
export const issuesRelations = relations(issues, ({ one, many }) => ({
  project: one(projects, {
    fields: [issues.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [issues.workspaceId],
    references: [workspaces.id],
  }),
  state: one(states, {
    fields: [issues.stateId],
    references: [states.id],
  }),
  parent: one(issues, {
    fields: [issues.parentId],
    references: [issues.id],
    relationName: "parentChild",
  }),
  children: many(issues, { relationName: "parentChild" }),
  createdBy: one(users, {
    fields: [issues.createdById],
    references: [users.id],
    relationName: "createdBy",
  }),
  updatedBy: one(users, {
    fields: [issues.updatedById],
    references: [users.id],
    relationName: "updatedBy",
  }),
  assignees: many(issueAssignees),
  labels: many(issueLabels),
  comments: many(issueComments),
  activities: many(issueActivities),
  reactions: many(issueReactions),
  attachments: many(issueAttachments),
  links: many(issueLinks),
}));

export const issueAssigneesRelations = relations(issueAssignees, ({ one }) => ({
  issue: one(issues, {
    fields: [issueAssignees.issueId],
    references: [issues.id],
  }),
  assignee: one(users, {
    fields: [issueAssignees.assigneeId],
    references: [users.id],
  }),
}));

export const issueLabelsRelations = relations(issueLabels, ({ one }) => ({
  issue: one(issues, {
    fields: [issueLabels.issueId],
    references: [issues.id],
  }),
  label: one(labels, {
    fields: [issueLabels.labelId],
    references: [labels.id],
  }),
}));

export const issueCommentsRelations = relations(issueComments, ({ one, many }) => ({
  issue: one(issues, {
    fields: [issueComments.issueId],
    references: [issues.id],
  }),
  actor: one(users, {
    fields: [issueComments.actorId],
    references: [users.id],
  }),
  reactions: many(commentReactions),
}));

export const issueActivitiesRelations = relations(issueActivities, ({ one }) => ({
  issue: one(issues, {
    fields: [issueActivities.issueId],
    references: [issues.id],
  }),
  project: one(projects, {
    fields: [issueActivities.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [issueActivities.workspaceId],
    references: [workspaces.id],
  }),
  actor: one(users, {
    fields: [issueActivities.actorId],
    references: [users.id],
  }),
}));

export const issueReactionsRelations = relations(issueReactions, ({ one }) => ({
  issue: one(issues, {
    fields: [issueReactions.issueId],
    references: [issues.id],
  }),
  actor: one(users, {
    fields: [issueReactions.actorId],
    references: [users.id],
  }),
}));

export const commentReactionsRelations = relations(commentReactions, ({ one }) => ({
  comment: one(issueComments, {
    fields: [commentReactions.commentId],
    references: [issueComments.id],
  }),
  actor: one(users, {
    fields: [commentReactions.actorId],
    references: [users.id],
  }),
}));

export const issueRelationsRelations = relations(issueRelations, ({ one }) => ({
  issue: one(issues, {
    fields: [issueRelations.issueId],
    references: [issues.id],
    relationName: "issueRelations",
  }),
  relatedIssue: one(issues, {
    fields: [issueRelations.relatedIssueId],
    references: [issues.id],
    relationName: "relatedIssueRelations",
  }),
}));

export const issueAttachmentsRelations = relations(issueAttachments, ({ one }) => ({
  issue: one(issues, {
    fields: [issueAttachments.issueId],
    references: [issues.id],
  }),
  workspace: one(workspaces, {
    fields: [issueAttachments.workspaceId],
    references: [workspaces.id],
  }),
  uploadedBy: one(users, {
    fields: [issueAttachments.uploadedById],
    references: [users.id],
  }),
}));

export const issueLinksRelations = relations(issueLinks, ({ one }) => ({
  issue: one(issues, {
    fields: [issueLinks.issueId],
    references: [issues.id],
  }),
  createdBy: one(users, {
    fields: [issueLinks.createdById],
    references: [users.id],
  }),
}));

// Issue Subscribers
export const issueSubscribers = sqliteTable(
  "issue_subscribers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    unique("issue_subscriber_unique").on(table.issueId, table.subscriberId),
    index("issue_subscriber_issue_idx").on(table.issueId),
    index("issue_subscriber_user_idx").on(table.subscriberId),
  ]
);

export const issueSubscribersRelations = relations(issueSubscribers, ({ one }) => ({
  issue: one(issues, {
    fields: [issueSubscribers.issueId],
    references: [issues.id],
  }),
  subscriber: one(users, {
    fields: [issueSubscribers.subscriberId],
    references: [users.id],
  }),
}));

// Issue Description Versions
export const issueDescriptionVersions = sqliteTable(
  "issue_description_versions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    descriptionHtml: text("description_html").default("<p></p>"),
    descriptionStripped: text("description_stripped"),
    descriptionJson: text("description_json", { mode: "json" }),
    lastSavedAt: integer("last_saved_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    ownedById: text("owned_by_id")
      .notNull()
      .references(() => users.id),
    createdById: text("created_by_id").references(() => users.id),
    updatedById: text("updated_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("issue_desc_version_issue_idx").on(table.issueId),
    index("issue_desc_version_project_idx").on(table.projectId),
    index("issue_desc_version_workspace_idx").on(table.workspaceId),
  ]
);

export const issueDescriptionVersionsRelations = relations(issueDescriptionVersions, ({ one }) => ({
  issue: one(issues, {
    fields: [issueDescriptionVersions.issueId],
    references: [issues.id],
  }),
  project: one(projects, {
    fields: [issueDescriptionVersions.projectId],
    references: [projects.id],
  }),
  workspace: one(workspaces, {
    fields: [issueDescriptionVersions.workspaceId],
    references: [workspaces.id],
  }),
  ownedBy: one(users, {
    fields: [issueDescriptionVersions.ownedById],
    references: [users.id],
    relationName: "ownedBy",
  }),
  createdBy: one(users, {
    fields: [issueDescriptionVersions.createdById],
    references: [users.id],
    relationName: "createdBy",
  }),
  updatedBy: one(users, {
    fields: [issueDescriptionVersions.updatedById],
    references: [users.id],
    relationName: "updatedBy",
  }),
}));

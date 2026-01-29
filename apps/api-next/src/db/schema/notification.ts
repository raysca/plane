import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";
import { projects } from "./project";

// Notifications
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    receiverId: text("receiver_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    triggeredById: text("triggered_by_id").references(() => users.id),
    entityType: text("entity_type").notNull(), // issue, page, cycle, module
    entityId: text("entity_id").notNull(),
    entityName: text("entity_name"),
    title: text("title").notNull(),
    message: text("message"),
    messageHtml: text("message_html"),
    messageStripped: text("message_stripped"),
    sender: text("sender").notNull().default(""),
    data: text("data", { mode: "json" }),
    readAt: integer("read_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    snoozedTill: integer("snoozed_till", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("notification_receiver_idx").on(table.receiverId),
    index("notification_workspace_idx").on(table.workspaceId),
    index("notification_project_idx").on(table.projectId),
    index("notification_entity_idx").on(table.entityType, table.entityId),
  ]
);

// User notification preferences
export const notificationPreferences = sqliteTable("notification_preferences", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  propertyChangeEmail: integer("property_change_email", { mode: "boolean" }).default(true),
  stateChangeEmail: integer("state_change_email", { mode: "boolean" }).default(true),
  commentEmail: integer("comment_email", { mode: "boolean" }).default(true),
  mentionEmail: integer("mention_email", { mode: "boolean" }).default(true),
  issueCompletedEmail: integer("issue_completed_email", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// Relations
export const notificationsRelations = relations(notifications, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [notifications.workspaceId],
    references: [workspaces.id],
  }),
  project: one(projects, {
    fields: [notifications.projectId],
    references: [projects.id],
  }),
  receiver: one(users, {
    fields: [notifications.receiverId],
    references: [users.id],
    relationName: "notificationReceiver",
  }),
  triggeredBy: one(users, {
    fields: [notifications.triggeredById],
    references: [users.id],
    relationName: "notificationTriggeredBy",
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(users, {
    fields: [notificationPreferences.userId],
    references: [users.id],
  }),
}));

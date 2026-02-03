import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";
import { workspaces } from "./workspace";

// Webhooks
export const webhooks = sqliteTable(
  "webhooks",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretKey: text("secret_key").notNull(),
    isActive: integer("is_active", { mode: "boolean" }).default(true),

    // Event subscriptions
    projectEvent: integer("project_event", { mode: "boolean" }).default(true),
    issueEvent: integer("issue_event", { mode: "boolean" }).default(true),
    moduleEvent: integer("module_event", { mode: "boolean" }).default(false),
    cycleEvent: integer("cycle_event", { mode: "boolean" }).default(false),
    issueCommentEvent: integer("issue_comment_event", { mode: "boolean" }).default(false),

    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    workspaceIdx: index("webhook_workspace_idx").on(table.workspaceId),
  })
);

// Webhook logs
export const webhookLogs = sqliteTable(
  "webhook_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    requestHeaders: text("request_headers", { mode: "json" }),
    requestBody: text("request_body", { mode: "json" }),
    responseStatus: integer("response_status"),
    responseHeaders: text("response_headers", { mode: "json" }),
    responseBody: text("response_body"),
    retryCount: integer("retry_count").default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    webhookIdx: index("webhook_log_webhook_idx").on(table.webhookId),
    workspaceIdx: index("webhook_log_workspace_idx").on(table.workspaceId),
  })
);

// Relations
export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [webhooks.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [webhooks.createdById],
    references: [users.id],
  }),
  logs: many(webhookLogs),
}));

export const webhookLogsRelations = relations(webhookLogs, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookLogs.webhookId],
    references: [webhooks.id],
  }),
  workspace: one(workspaces, {
    fields: [webhookLogs.workspaceId],
    references: [workspaces.id],
  }),
}));

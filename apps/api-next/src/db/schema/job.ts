import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

// Background jobs queue
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    queue: text("queue").notNull().default("default"),
    name: text("name").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    status: text("status").notNull().default("pending"), // pending, running, completed, failed
    attempts: integer("attempts").default(0),
    maxAttempts: integer("max_attempts").default(3),
    lastError: text("last_error"),
    runAt: integer("run_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("job_status_queue_idx").on(table.status, table.queue, table.runAt),
    index("job_name_idx").on(table.name),
  ]
);

// API activity logs
export const apiLogs = sqliteTable(
  "api_logs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id"),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code").notNull(),
    responseTime: integer("response_time"), // milliseconds
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    requestBody: text("request_body", { mode: "json" }),
    responseBody: text("response_body", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("api_log_user_idx").on(table.userId),
    index("api_log_created_at_idx").on(table.createdAt),
  ]
);

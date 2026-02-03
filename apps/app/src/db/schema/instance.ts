import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./user";

export const instances = sqliteTable("instances", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => createId()),
    instanceName: text("instance_name"),
    whitelistEmails: text("whitelist_emails"),
    instanceId: text("instance_id").unique(),
    currentVersion: text("current_version"),
    latestVersion: text("latest_version"),
    edition: text("edition").default("PLANE_COMMUNITY"),
    domain: text("domain"),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }),
    namespace: text("namespace"),
    isTelemetryEnabled: integer("is_telemetry_enabled", { mode: "boolean" }).default(true),
    isSupportRequired: integer("is_support_required", { mode: "boolean" }).default(true),
    isSetupDone: integer("is_setup_done", { mode: "boolean" }).default(false),
    isSignupScreenVisited: integer("is_signup_screen_visited", { mode: "boolean" }).default(false),
    isVerified: integer("is_verified", { mode: "boolean" }).default(false),
    isTest: integer("is_test", { mode: "boolean" }).default(false),
    isCurrentVersionDeprecated: integer("is_current_version_deprecated", { mode: "boolean" }).default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const instanceAdmins = sqliteTable("instance_admins", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => createId()),
    instanceId: text("instance_id")
        .notNull()
        .references(() => instances.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    role: integer("role").default(20), // 20 for Admin
    isVerified: integer("is_verified", { mode: "boolean" }).default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const instanceConfigurations = sqliteTable("instance_configurations", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => createId()),
    key: text("key").unique().notNull(),
    value: text("value"),
    category: text("category").notNull(),
    isEncrypted: integer("is_encrypted", { mode: "boolean" }).default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const instancesRelations = relations(instances, ({ many }) => ({
    admins: many(instanceAdmins),
}));

export const instanceAdminsRelations = relations(instanceAdmins, ({ one }) => ({
    instance: one(instances, {
        fields: [instanceAdmins.instanceId],
        references: [instances.id],
    }),
    user: one(users, {
        fields: [instanceAdmins.userId],
        references: [users.id],
    }),
}));

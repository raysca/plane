import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";

// Users table - managed by Better Auth but with custom fields
export const users = sqliteTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).default(false),
    name: text("name"),
    image: text("image"),

    // Custom fields for Plane
    username: text("username").unique(),
    displayName: text("display_name"),
    avatar: text("avatar"),
    coverImage: text("cover_image"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    isActive: integer("is_active", { mode: "boolean" }).default(true),
    isPasswordAutoset: integer("is_password_autoset", { mode: "boolean" }).default(false),

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  },
  (table) => [
    index("user_email_idx").on(table.email),
    index("user_username_idx").on(table.username),
  ]
);

// Sessions table - managed by Better Auth
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("session_user_id_idx").on(table.userId),
    index("session_token_idx").on(table.token),
  ]
);

// Accounts table - managed by Better Auth for OAuth
export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    index("account_provider_idx").on(table.providerId, table.accountId),
  ]
);

// Verification tokens table - managed by Better Auth
export const verifications = sqliteTable("verifications", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// User profiles - additional settings not in Better Auth
export const userProfiles = sqliteTable("user_profiles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").default("UTC"),
  dateFormat: text("date_format").default("MM/DD/YYYY"),
  timeFormat: text("time_format").default("12h"),
  theme: text("theme").default("system"),
  language: text("language").default("en"),
  lastWorkspaceId: text("last_workspace_id"),

  // Onboarding
  role: text("role"),
  useCase: text("use_case"),
  onboardingStep: text("onboarding_step", { mode: "json" }).$type<{
    profile_complete: boolean;
    workspace_create: boolean;
    workspace_invite: boolean;
    workspace_join: boolean;
  }>().default({
    profile_complete: false,
    workspace_create: false,
    workspace_invite: false,
    workspace_join: false,
  }),
  isTourCompleted: integer("is_tour_completed", { mode: "boolean" }).default(false),
  isOnboarded: integer("is_onboarded", { mode: "boolean" }).default(false),

  // Billing & Company
  billingAddress: text("billing_address", { mode: "json" }).$type<any>(),
  billingAddressCountry: text("billing_address_country").default("INDIA"),
  companyName: text("company_name"),

  // Marketing
  hasMarketingEmailConsent: integer("has_marketing_email_consent", { mode: "boolean" }).default(false),

  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// API tokens for programmatic access
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(), // First 8 chars for identification
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => [
    index("api_token_user_id_idx").on(table.userId),
    index("api_token_hash_idx").on(table.tokenHash),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  apiTokens: many(apiTokens),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const apiTokensRelations = relations(apiTokens, ({ one }) => ({
  user: one(users, {
    fields: [apiTokens.userId],
    references: [users.id],
  }),
}));

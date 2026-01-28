# Plane API Migration Plan: Django to Bun + Hono

## Overview

This document outlines a phased migration strategy from the current Django/PostgreSQL API to a modern Bun + Hono stack with SQLite + Drizzle ORM and native Bun WebSocket pub/sub for realtime functionality.

### Target Stack

| Component       | Current                 | Target                          |
| --------------- | ----------------------- | ------------------------------- |
| Runtime         | Python 3.11             | Bun                             |
| Framework       | Django 4.2 + DRF        | Hono                            |
| Database        | PostgreSQL              | SQLite                          |
| ORM             | Django ORM              | Drizzle                         |
| Realtime        | Django Channels         | Bun native WebSocket pub/sub    |
| Background Jobs | Celery + RabbitMQ       | Bun native (no external broker) |
| Authentication  | Django Sessions + OAuth | Better Auth                     |
| Validation      | DRF Serializers         | Zod                             |

### Migration Principles

1. **Frontend Continuity**: API contracts remain stable; frontend changes are minimal
2. **Incremental Rollout**: Services migrate independently behind a gateway
3. **Data Integrity**: Robust migration scripts with rollback capability
4. **Zero Downtime**: Blue-green deployment with gradual traffic shifting

---

## Phase 0: Foundation & Infrastructure (Weeks 1-2)

### 0.1 Project Setup

```
apps/api-next/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Hono app configuration
│   ├── db/
│   │   ├── schema/           # Drizzle schemas
│   │   ├── migrations/       # SQL migrations
│   │   └── index.ts          # DB connection
│   ├── routes/               # API routes (mirrors Django apps)
│   ├── middleware/           # Hono middleware
│   ├── services/             # Business logic
│   ├── utils/                # Utilities
│   ├── types/                # TypeScript types
│   └── workers/              # Background job handlers
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── bunfig.toml
```

### 0.2 Core Dependencies

```json
{
  "dependencies": {
    "hono": "^4.x",
    "drizzle-orm": "^0.30.x",
    "better-sqlite3": "^11.x",
    "@libsql/client": "^0.6.x",
    "zod": "^3.23.x",
    "nanoid": "^5.x",
    "@hono/zod-validator": "^0.2.x",
    "better-auth": "^1.x"
  }
}
```

### 0.3 Database Schema Design

Convert Django models to Drizzle schema. Example for core models:

```typescript
// src/db/schema/workspace.ts
import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

export const workspaces = sqliteTable("workspaces", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
});

export const workspaceMembers = sqliteTable("workspace_members", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  role: integer("role").notNull().default(15), // 5=Guest, 10=Viewer, 15=Member, 20=Admin
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

### 0.4 API Gateway Setup

Configure nginx/Caddy to route traffic:

```nginx
# Initial: All traffic to Django
location /api/ {
    proxy_pass http://django-api:8000;
}

# Later: Gradual migration
location /api/v2/workspaces/ {
    proxy_pass http://bun-api:3000;
}
```

### Deliverables

- [ ] Bun project initialized with TypeScript
- [ ] Drizzle configured with SQLite (libSQL for production)
- [ ] Base Hono app with health check endpoint
- [ ] API gateway configured for traffic splitting
- [ ] CI/CD pipeline for new service
- [ ] Development environment parity

---

## Phase 1: Authentication & Users with Better Auth (Weeks 3-4)

Better Auth provides a complete, batteries-included authentication solution with first-class Hono and Drizzle support. This significantly reduces Phase 1 complexity.

### 1.1 Better Auth Configuration

```typescript
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink, genericOAuth } from "better-auth/plugins";
import { db } from "../db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
  }),

  // Email/Password authentication
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await emailService.send({
        to: user.email,
        subject: "Reset your password",
        template: "reset-password",
        data: { url, name: user.name },
      });
    },
  },

  // OAuth Providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
    gitlab: {
      clientId: process.env.GITLAB_CLIENT_ID!,
      clientSecret: process.env.GITLAB_CLIENT_SECRET!,
      issuer: process.env.GITLAB_ISSUER, // For self-hosted GitLab
    },
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  // Plugins
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await emailService.send({
          to: email,
          subject: "Sign in to Plane",
          template: "magic-link",
          data: { url },
        });
      },
    }),

    // Generic OAuth for Gitea (and any other custom OAuth2 providers)
    genericOAuth({
      config: [
        {
          providerId: "gitea",
          clientId: process.env.GITEA_CLIENT_ID!,
          clientSecret: process.env.GITEA_CLIENT_SECRET!,
          authorizationUrl: `${process.env.GITEA_ISSUER}/login/oauth/authorize`,
          tokenUrl: `${process.env.GITEA_ISSUER}/login/oauth/access_token`,
          scopes: ["read:user", "user:email"],
          // Custom user info fetching for Gitea's API
          getUserInfo: async (tokens) => {
            const response = await fetch(`${process.env.GITEA_ISSUER}/api/v1/user`, {
              headers: {
                Authorization: `Bearer ${tokens.accessToken}`,
              },
            });
            const profile = await response.json();
            return {
              id: String(profile.id),
              name: profile.full_name || profile.login,
              email: profile.email,
              image: profile.avatar_url,
              emailVerified: profile.email ? true : false,
            };
          },
        },
      ],
    }),
  ],

  // User fields customization
  user: {
    additionalFields: {
      username: {
        type: "string",
        required: false,
        unique: true,
      },
      displayName: {
        type: "string",
        required: false,
      },
      avatar: {
        type: "string",
        required: false,
      },
      isOnboarded: {
        type: "boolean",
        defaultValue: false,
      },
      isActive: {
        type: "boolean",
        defaultValue: true,
      },
    },
  },

  // Account linking (includes gitea from genericOAuth plugin)
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "github", "gitlab", "gitea"],
    },
  },

  // Rate limiting
  rateLimit: {
    window: 60, // 1 minute
    max: 30, // 30 requests per minute
  },
});

// Export type for use in routes
export type Auth = typeof auth;
```

### 1.2 Hono Integration

```typescript
// src/index.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./lib/auth";

const app = new Hono();

// CORS must be before auth routes
app.use(
  "/api/auth/*",
  cors({
    origin: process.env.FRONTEND_URL!,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// Mount Better Auth handler - handles all auth routes automatically
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

// Your other routes...
app.route("/api/workspaces", workspaceRoutes);

export default app;
```

### 1.3 Auth Middleware

```typescript
// src/middleware/auth.ts
import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth";

export const authMiddleware = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Check if user is active
  if (!session.user.isActive) {
    return c.json({ error: "Account is deactivated" }, 403);
  }

  c.set("user", session.user);
  c.set("session", session.session);

  await next();
});

// Optional: Middleware that doesn't require auth but attaches user if present
export const optionalAuthMiddleware = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (session?.user) {
    c.set("user", session.user);
    c.set("session", session.session);
  }

  await next();
});
```

### 1.4 Better Auth Auto-Generated Schema

Better Auth automatically creates and manages these tables via Drizzle:

```typescript
// Auto-generated by Better Auth (reference only)
// These tables are created automatically when you run migrations

// user table - extended with our custom fields
// session table - managed by Better Auth
// account table - stores OAuth provider links
// verification table - for email verification tokens

// To generate the schema, run:
// npx @better-auth/cli generate
```

### 1.5 Custom User Fields Extension

```typescript
// src/db/schema/user-extensions.ts
// Additional user-related tables not managed by Better Auth

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";

// User profile preferences (separate from auth)
export const userProfiles = sqliteTable("user_profiles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text("user_id").notNull().unique(),
  timezone: text("timezone").default("UTC"),
  dateFormat: text("date_format").default("MM/DD/YYYY"),
  timeFormat: text("time_format").default("12h"),
  theme: text("theme").default("system"),
  onboardingStep: integer("onboarding_step").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// API tokens for programmatic access
export const apiTokens = sqliteTable("api_tokens", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

### 1.6 API Token Authentication

```typescript
// src/middleware/api-token.ts
import { createMiddleware } from "hono/factory";
import { db } from "../db";
import { apiTokens } from "../db/schema";
import { eq } from "drizzle-orm";

export const apiTokenMiddleware = createMiddleware(async (c, next) => {
  const apiKey = c.req.header("X-API-Key");

  if (!apiKey) {
    return await next(); // Fall through to session auth
  }

  const tokenHash = await hashToken(apiKey);
  const token = await db.query.apiTokens.findFirst({
    where: eq(apiTokens.tokenHash, tokenHash),
  });

  if (!token) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  if (token.expiresAt && token.expiresAt < new Date()) {
    return c.json({ error: "API key expired" }, 401);
  }

  // Update last used
  await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id));

  // Fetch user
  const user = await auth.api.getUser({ userId: token.userId });
  c.set("user", user);
  c.set("authMethod", "api_token");

  await next();
});
```

### 1.7 Built-in Endpoints (Provided by Better Auth)

Better Auth automatically provides these endpoints at `/api/auth/*`:

| Endpoint                                | Method | Description                                  |
| --------------------------------------- | ------ | -------------------------------------------- |
| `/api/auth/sign-up/email`               | POST   | Email/password registration                  |
| `/api/auth/sign-in/email`               | POST   | Email/password login                         |
| `/api/auth/sign-in/social`              | POST   | Initiate OAuth flow (Google, GitHub, GitLab) |
| `/api/auth/callback/:provider`          | GET    | OAuth callback handler (built-in providers)  |
| `/api/auth/oauth2/callback/:providerId` | GET    | Generic OAuth callback (Gitea, etc.)         |
| `/api/auth/sign-out`                    | POST   | Sign out (invalidate session)                |
| `/api/auth/session`                     | GET    | Get current session                          |
| `/api/auth/magic-link/sign-in`          | POST   | Request magic link                           |
| `/api/auth/magic-link/verify`           | GET    | Verify magic link                            |
| `/api/auth/forget-password`             | POST   | Request password reset                       |
| `/api/auth/reset-password`              | POST   | Reset password with token                    |
| `/api/auth/verify-email`                | GET    | Verify email address                         |
| `/api/auth/change-password`             | POST   | Change password (authenticated)              |
| `/api/auth/update-user`                 | POST   | Update user profile                          |
| `/api/auth/delete-user`                 | POST   | Delete user account                          |
| `/api/auth/list-sessions`               | GET    | List all user sessions                       |
| `/api/auth/revoke-session`              | POST   | Revoke a specific session                    |

**Note:** For Gitea, the OAuth callback URL to configure is: `${BETTER_AUTH_URL}/api/auth/oauth2/callback/gitea`

### 1.8 Frontend Client Setup

```typescript
// Frontend: lib/auth-client.ts
import { createAuthClient } from "better-auth/react"; // or /vue, /svelte, /solid
import { genericOAuthClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  plugins: [
    genericOAuthClient(), // Required for Gitea and other generic OAuth providers
  ],
});

// Usage in components
const { data: session, isPending } = authClient.useSession();

// Sign in with email/password
await authClient.signIn.email({
  email: "user@example.com",
  password: "password",
});

// Sign in with built-in OAuth providers
await authClient.signIn.social({
  provider: "google", // or "github", "gitlab"
  callbackURL: "/dashboard",
});

// Sign in with Gitea (generic OAuth)
await authClient.signIn.oauth2({
  providerId: "gitea",
  callbackURL: "/dashboard",
});

// Sign out
await authClient.signOut();
```

### 1.9 Data Migration Script

```typescript
// scripts/migrate-users.ts
import { pgClient } from "./pg-client";
import { db } from "../src/db";
import { auth } from "../src/lib/auth";

async function migrateUsers() {
  const pgUsers = await pgClient.query(`
    SELECT u.*, array_agg(s.provider) as providers
    FROM users u
    LEFT JOIN social_login_connection s ON u.id = s.user_id
    WHERE u.is_active = true
    GROUP BY u.id
  `);

  for (const pgUser of pgUsers.rows) {
    // Create user via Better Auth internal API
    // This ensures proper schema compliance
    const user = await db
      .insert(auth.options.database.schema.user)
      .values({
        id: pgUser.id,
        email: pgUser.email,
        name: pgUser.display_name || pgUser.first_name,
        emailVerified: pgUser.is_email_verified,
        image: pgUser.avatar,
        // Custom fields
        username: pgUser.username,
        displayName: pgUser.display_name,
        avatar: pgUser.avatar,
        isOnboarded: pgUser.is_onboarded,
        isActive: pgUser.is_active,
        createdAt: new Date(pgUser.created_at),
        updatedAt: new Date(pgUser.updated_at),
      })
      .returning();

    // Migrate OAuth accounts
    if (pgUser.providers) {
      for (const provider of pgUser.providers.filter(Boolean)) {
        const socialConn = await pgClient.query(
          `SELECT * FROM social_login_connection WHERE user_id = $1 AND provider = $2`,
          [pgUser.id, provider]
        );

        if (socialConn.rows[0]) {
          await db.insert(auth.options.database.schema.account).values({
            id: socialConn.rows[0].id,
            userId: user[0].id,
            providerId: provider,
            accountId: socialConn.rows[0].provider_account_id,
            accessToken: socialConn.rows[0].access_token,
            refreshToken: socialConn.rows[0].refresh_token,
          });
        }
      }
    }

    // If user has password, create credential account
    if (pgUser.password) {
      await db.insert(auth.options.database.schema.account).values({
        userId: user[0].id,
        providerId: "credential",
        accountId: pgUser.email,
        password: pgUser.password, // Already hashed, Better Auth will recognize
      });
    }
  }
}
```

### Deliverables

- [ ] Better Auth configured with Drizzle adapter
- [ ] OAuth providers (Google, GitHub, GitLab)
- [ ] Magic link authentication (via plugin)
- [ ] Email/password authentication
- [ ] Session management (automatic)
- [ ] Auth middleware for Hono routes
- [ ] API token authentication for programmatic access
- [ ] User migration script
- [ ] Frontend auth client setup
- [ ] Email templates (password reset, magic link, verification)

---

## Phase 2: Workspaces & Projects (Weeks 5-7)

### 2.1 Schema Definitions

```typescript
// src/db/schema/project.ts
export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
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
  sortOrder: real("sort_order").default(65535),
  createdById: text("created_by_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
});

export const projectMembers = sqliteTable("project_members", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  memberId: text("member_id")
    .notNull()
    .references(() => users.id),
  role: integer("role").notNull().default(15),
  sortOrder: real("sort_order").default(65535),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const states = sqliteTable("states", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  name: text("name").notNull(),
  color: text("color").notNull(),
  group: text("group").notNull(), // 'backlog', 'unstarted', 'started', 'completed', 'cancelled'
  sequence: real("sequence").default(65535),
  isDefault: integer("is_default", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

### 2.2 Route Structure

```typescript
// src/routes/workspaces/index.ts
import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth"; // Uses Better Auth session
import { workspaceMiddleware } from "../../middleware/workspace";

const workspaces = new Hono();

workspaces.use("/*", authMiddleware);

// Workspace CRUD
workspaces.get("/", listWorkspaces);
workspaces.post("/", createWorkspace);
workspaces.get("/:workspaceSlug", workspaceMiddleware, getWorkspace);
workspaces.patch("/:workspaceSlug", workspaceMiddleware, updateWorkspace);
workspaces.delete("/:workspaceSlug", workspaceMiddleware, deleteWorkspace);

// Workspace Members
workspaces.get("/:workspaceSlug/members", workspaceMiddleware, listMembers);
workspaces.post("/:workspaceSlug/members", workspaceMiddleware, addMember);
workspaces.patch("/:workspaceSlug/members/:memberId", workspaceMiddleware, updateMember);
workspaces.delete("/:workspaceSlug/members/:memberId", workspaceMiddleware, removeMember);

// Projects (nested)
workspaces.route("/:workspaceSlug/projects", projectRoutes);

export default workspaces;
```

### 2.3 Service Layer Pattern

```typescript
// src/services/workspace.service.ts
import { db } from "../db";
import { workspaces, workspaceMembers } from "../db/schema";
import { eq, and } from "drizzle-orm";

export class WorkspaceService {
  async create(data: CreateWorkspaceInput, userId: string) {
    return await db.transaction(async (tx) => {
      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: data.name,
          slug: data.slug,
          ownerId: userId,
        })
        .returning();

      // Add creator as admin
      await tx.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId,
        role: 20, // Admin
      });

      return workspace;
    });
  }

  async findBySlug(slug: string) {
    return await db.query.workspaces.findFirst({
      where: eq(workspaces.slug, slug),
      with: {
        members: {
          with: { user: true },
        },
      },
    });
  }

  async checkMembership(workspaceId: string, userId: string) {
    const member = await db.query.workspaceMembers.findFirst({
      where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
    });
    return member;
  }
}

export const workspaceService = new WorkspaceService();
```

### 2.4 Permission Middleware

```typescript
// src/middleware/workspace.ts
import { createMiddleware } from "hono/factory";
import { workspaceService } from "../services/workspace.service";

export const workspaceMiddleware = createMiddleware(async (c, next) => {
  const workspaceSlug = c.req.param("workspaceSlug");
  const user = c.get("user");

  const workspace = await workspaceService.findBySlug(workspaceSlug);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const membership = await workspaceService.checkMembership(workspace.id, user.id);
  if (!membership) {
    return c.json({ error: "Not a workspace member" }, 403);
  }

  c.set("workspace", workspace);
  c.set("workspaceMembership", membership);

  await next();
});

export const requireRole = (minRole: number) =>
  createMiddleware(async (c, next) => {
    const membership = c.get("workspaceMembership");
    if (membership.role < minRole) {
      return c.json({ error: "Insufficient permissions" }, 403);
    }
    await next();
  });
```

### Deliverables

- [ ] Workspace CRUD endpoints
- [ ] Project CRUD endpoints
- [ ] Member management (invite, role change, remove)
- [ ] State management
- [ ] Label management
- [ ] Permission system
- [ ] Migration scripts for workspaces & projects

---

## Phase 3: Issues & Work Items (Weeks 8-11)

### 3.1 Issue Schema

```typescript
// src/db/schema/issue.ts
export const issues = sqliteTable(
  "issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    parentId: text("parent_id").references(() => issues.id),
    stateId: text("state_id").references(() => states.id),
    name: text("name").notNull(),
    descriptionHtml: text("description_html"),
    descriptionStripped: text("description_stripped"),
    priority: integer("priority").default(0), // 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
    sortOrder: real("sort_order").default(65535),
    startDate: integer("start_date", { mode: "timestamp" }),
    targetDate: integer("target_date", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    sequenceId: integer("sequence_id"),
    estimatePoint: integer("estimate_point"),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
  },
  (table) => ({
    projectIdx: index("issue_project_idx").on(table.projectId),
    stateIdx: index("issue_state_idx").on(table.stateId),
    parentIdx: index("issue_parent_idx").on(table.parentId),
  })
);

export const issueAssignees = sqliteTable("issue_assignees", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  assigneeId: text("assignee_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const issueLabels = sqliteTable("issue_labels", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  labelId: text("label_id")
    .notNull()
    .references(() => labels.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const issueComments = sqliteTable("issue_comments", {
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
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const issueActivities = sqliteTable("issue_activities", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  actorId: text("actor_id").references(() => users.id),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  verb: text("verb").notNull(), // 'created', 'updated', 'deleted'
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

### 3.2 Issue Service with Activity Tracking

```typescript
// src/services/issue.service.ts
export class IssueService {
  async create(data: CreateIssueInput, userId: string) {
    return await db.transaction(async (tx) => {
      // Get next sequence number
      const [{ maxSeq }] = await tx
        .select({ maxSeq: sql`COALESCE(MAX(sequence_id), 0)` })
        .from(issues)
        .where(eq(issues.projectId, data.projectId));

      const [issue] = await tx
        .insert(issues)
        .values({
          ...data,
          sequenceId: maxSeq + 1,
          createdById: userId,
        })
        .returning();

      // Track activity
      await tx.insert(issueActivities).values({
        issueId: issue.id,
        actorId: userId,
        verb: "created",
      });

      // Handle assignees
      if (data.assigneeIds?.length) {
        await tx.insert(issueAssignees).values(
          data.assigneeIds.map((assigneeId) => ({
            issueId: issue.id,
            assigneeId,
          }))
        );
      }

      // Handle labels
      if (data.labelIds?.length) {
        await tx.insert(issueLabels).values(
          data.labelIds.map((labelId) => ({
            issueId: issue.id,
            labelId,
          }))
        );
      }

      // Emit realtime event
      this.emitIssueEvent(issue.workspaceId, issue.projectId, "issue:created", issue);

      return issue;
    });
  }

  async update(issueId: string, data: UpdateIssueInput, userId: string) {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(issues).where(eq(issues.id, issueId));
      if (!existing) throw new NotFoundError("Issue not found");

      // Track field changes
      const activities: InsertActivity[] = [];
      for (const [field, newValue] of Object.entries(data)) {
        const oldValue = existing[field as keyof typeof existing];
        if (oldValue !== newValue) {
          activities.push({
            issueId,
            actorId: userId,
            field,
            oldValue: String(oldValue),
            newValue: String(newValue),
            verb: "updated",
          });
        }
      }

      const [updated] = await tx
        .update(issues)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(issues.id, issueId))
        .returning();

      if (activities.length) {
        await tx.insert(issueActivities).values(activities);
      }

      this.emitIssueEvent(updated.workspaceId, updated.projectId, "issue:updated", updated);

      return updated;
    });
  }

  private emitIssueEvent(workspaceId: string, projectId: string, event: string, data: any) {
    const topic = `workspace:${workspaceId}:project:${projectId}`;
    realtimeService.publish(topic, { event, data });
  }
}
```

### 3.3 Issue Routes with Filtering

```typescript
// src/routes/issues/index.ts
const issueFilterSchema = z.object({
  state: z.string().optional(),
  priority: z.coerce.number().optional(),
  assignees: z.string().optional(), // comma-separated IDs
  labels: z.string().optional(),
  parent: z.string().optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  created_at__gte: z.string().optional(),
  created_at__lte: z.string().optional(),
  order_by: z.string().optional(),
  cursor: z.string().optional(),
  per_page: z.coerce.number().default(50),
});

issues.get("/", zValidator("query", issueFilterSchema), async (c) => {
  const project = c.get("project");
  const filters = c.req.valid("query");

  const result = await issueService.list(project.id, {
    stateId: filters.state,
    priority: filters.priority,
    assigneeIds: filters.assignees?.split(","),
    labelIds: filters.labels?.split(","),
    parentId: filters.parent,
    dateRange: {
      startDate: filters.start_date,
      targetDate: filters.target_date,
    },
    createdAt: {
      gte: filters.created_at__gte,
      lte: filters.created_at__lte,
    },
    orderBy: filters.order_by,
    cursor: filters.cursor,
    perPage: filters.per_page,
  });

  return c.json(result);
});
```

### 3.4 Bulk Operations

```typescript
// src/services/issue.service.ts (continued)
async bulkUpdate(issueIds: string[], data: BulkUpdateInput, userId: string) {
  return await db.transaction(async (tx) => {
    const updated: Issue[] = [];

    for (const issueId of issueIds) {
      const [issue] = await tx.update(issues)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(issues.id, issueId))
        .returning();

      if (issue) {
        updated.push(issue);
        await tx.insert(issueActivities).values({
          issueId,
          actorId: userId,
          field: 'bulk_update',
          newValue: JSON.stringify(data),
          verb: 'updated',
        });
      }
    }

    // Batch emit events
    const byProject = groupBy(updated, 'projectId');
    for (const [projectId, projectIssues] of Object.entries(byProject)) {
      this.emitIssueEvent(
        projectIssues[0].workspaceId,
        projectId,
        'issues:bulk_updated',
        projectIssues
      );
    }

    return updated;
  });
}
```

### Deliverables

- [ ] Issue CRUD with full activity tracking
- [ ] Assignee management
- [ ] Label assignment
- [ ] Comment system
- [ ] Sub-issues (parent-child)
- [ ] Issue relations (blocking, blocked-by, duplicate)
- [ ] Bulk operations
- [ ] Advanced filtering & sorting
- [ ] Cursor-based pagination
- [ ] Issue migration script

---

## Phase 4: Cycles, Modules & Views (Weeks 12-14)

### 4.1 Cycles Schema

```typescript
// src/db/schema/cycle.ts
export const cycles = sqliteTable("cycles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(),
  description: text("description"),
  startDate: integer("start_date", { mode: "timestamp" }),
  endDate: integer("end_date", { mode: "timestamp" }),
  ownedById: text("owned_by_id").references(() => users.id),
  sortOrder: real("sort_order").default(65535),
  viewProps: text("view_props", { mode: "json" }),
  progress_snapshot: text("progress_snapshot", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const cycleIssues = sqliteTable(
  "cycle_issues",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.id, { onDelete: "cascade" }),
    issueId: text("issue_id")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    uniqueCycleIssue: unique().on(table.cycleId, table.issueId),
  })
);
```

### 4.2 Modules Schema

```typescript
// src/db/schema/module.ts
export const modules = sqliteTable("modules", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  name: text("name").notNull(),
  description: text("description"),
  descriptionHtml: text("description_html"),
  startDate: integer("start_date", { mode: "timestamp" }),
  targetDate: integer("target_date", { mode: "timestamp" }),
  status: text("status").default("backlog"), // backlog, planned, in-progress, paused, completed, cancelled
  leadId: text("lead_id").references(() => users.id),
  sortOrder: real("sort_order").default(65535),
  viewProps: text("view_props", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const moduleIssues = sqliteTable("module_issues", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  issueId: text("issue_id")
    .notNull()
    .references(() => issues.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const moduleMembers = sqliteTable("module_members", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  memberId: text("member_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

### 4.3 Views Schema

```typescript
// src/db/schema/view.ts
export const views = sqliteTable("views", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  projectId: text("project_id").references(() => projects.id), // null for workspace views
  name: text("name").notNull(),
  description: text("description"),
  query: text("query", { mode: "json" }).notNull(), // Filter configuration
  queryData: text("query_data", { mode: "json" }),
  accessLevel: integer("access_level").default(1), // 0=Private, 1=Project, 2=Workspace
  sortOrder: real("sort_order").default(65535),
  ownedById: text("owned_by_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

### 4.4 Cycle Progress Calculation

```typescript
// src/services/cycle.service.ts
export class CycleService {
  async calculateProgress(cycleId: string) {
    const result = await db
      .select({
        total: count(),
        completed: count(sql`CASE WHEN ${states.group} = 'completed' THEN 1 END`),
        cancelled: count(sql`CASE WHEN ${states.group} = 'cancelled' THEN 1 END`),
      })
      .from(cycleIssues)
      .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
      .innerJoin(states, eq(issues.stateId, states.id))
      .where(eq(cycleIssues.cycleId, cycleId));

    const { total, completed, cancelled } = result[0];
    const progress = total > 0 ? ((completed + cancelled) / total) * 100 : 0;

    return {
      total,
      completed,
      cancelled,
      pending: total - completed - cancelled,
      progress: Math.round(progress * 100) / 100,
    };
  }

  async snapshotProgress(cycleId: string) {
    const progress = await this.calculateProgress(cycleId);

    await db
      .update(cycles)
      .set({
        progress_snapshot: {
          ...progress,
          snapshotAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(cycles.id, cycleId));
  }
}
```

### Deliverables

- [ ] Cycle CRUD with issue assignment
- [ ] Module CRUD with issue & member assignment
- [ ] View CRUD with filter persistence
- [ ] Progress calculations
- [ ] Burndown data generation
- [ ] Migration scripts

---

## Phase 5: Realtime with Bun WebSocket Pub/Sub (Weeks 15-16)

### 5.1 WebSocket Server Setup

```typescript
// src/realtime/server.ts
import type { ServerWebSocket } from "bun";

interface WebSocketData {
  userId: string;
  subscriptions: Set<string>;
}

const clients = new Map<string, ServerWebSocket<WebSocketData>>();
const topicSubscribers = new Map<string, Set<string>>(); // topic -> Set<clientId>

export const websocketHandler = {
  open(ws: ServerWebSocket<WebSocketData>) {
    const clientId = crypto.randomUUID();
    clients.set(clientId, ws);
    ws.data.subscriptions = new Set();

    ws.send(JSON.stringify({ type: "connected", clientId }));
  },

  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case "subscribe":
          handleSubscribe(ws, data.topic);
          break;
        case "unsubscribe":
          handleUnsubscribe(ws, data.topic);
          break;
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
    }
  },

  close(ws: ServerWebSocket<WebSocketData>) {
    // Clean up subscriptions
    for (const topic of ws.data.subscriptions) {
      const subscribers = topicSubscribers.get(topic);
      if (subscribers) {
        subscribers.delete(ws.data.userId);
        if (subscribers.size === 0) {
          topicSubscribers.delete(topic);
        }
      }
    }

    // Remove from clients
    for (const [clientId, client] of clients) {
      if (client === ws) {
        clients.delete(clientId);
        break;
      }
    }
  },
};

function handleSubscribe(ws: ServerWebSocket<WebSocketData>, topic: string) {
  // Validate topic access (check workspace/project membership)
  ws.subscribe(topic); // Bun native pub/sub
  ws.data.subscriptions.add(topic);

  if (!topicSubscribers.has(topic)) {
    topicSubscribers.set(topic, new Set());
  }
  topicSubscribers.get(topic)!.add(ws.data.userId);

  ws.send(JSON.stringify({ type: "subscribed", topic }));
}

function handleUnsubscribe(ws: ServerWebSocket<WebSocketData>, topic: string) {
  ws.unsubscribe(topic);
  ws.data.subscriptions.delete(topic);

  const subscribers = topicSubscribers.get(topic);
  if (subscribers) {
    subscribers.delete(ws.data.userId);
  }

  ws.send(JSON.stringify({ type: "unsubscribed", topic }));
}
```

### 5.2 Realtime Service

```typescript
// src/realtime/service.ts
import type { Server } from "bun";

let server: Server;

export function setServer(s: Server) {
  server = s;
}

export const realtimeService = {
  publish(topic: string, data: any) {
    if (!server) return;

    const message = JSON.stringify({
      type: "event",
      topic,
      data,
      timestamp: Date.now(),
    });

    server.publish(topic, message);
  },

  // Topic patterns
  workspaceTopic: (workspaceId: string) => `workspace:${workspaceId}`,
  projectTopic: (workspaceId: string, projectId: string) => `workspace:${workspaceId}:project:${projectId}`,
  issueTopic: (workspaceId: string, projectId: string, issueId: string) =>
    `workspace:${workspaceId}:project:${projectId}:issue:${issueId}`,
  userTopic: (userId: string) => `user:${userId}`,
};
```

### 5.3 Server Integration

```typescript
// src/index.ts
import { Hono } from "hono";
import { websocketHandler } from "./realtime/server";
import { setServer } from "./realtime/service";

const app = new Hono();

// ... routes setup ...

const server = Bun.serve({
  port: process.env.PORT || 3000,
  fetch: app.fetch,
  websocket: websocketHandler,
});

setServer(server);

console.log(`Server running on port ${server.port}`);
```

### 5.4 Event Types

```typescript
// src/realtime/events.ts
export const RealtimeEvents = {
  // Issue events
  ISSUE_CREATED: "issue:created",
  ISSUE_UPDATED: "issue:updated",
  ISSUE_DELETED: "issue:deleted",
  ISSUES_BULK_UPDATED: "issues:bulk_updated",

  // Comment events
  COMMENT_CREATED: "comment:created",
  COMMENT_UPDATED: "comment:updated",
  COMMENT_DELETED: "comment:deleted",

  // Cycle events
  CYCLE_CREATED: "cycle:created",
  CYCLE_UPDATED: "cycle:updated",
  CYCLE_DELETED: "cycle:deleted",
  CYCLE_ISSUE_ADDED: "cycle:issue_added",
  CYCLE_ISSUE_REMOVED: "cycle:issue_removed",

  // Module events
  MODULE_CREATED: "module:created",
  MODULE_UPDATED: "module:updated",
  MODULE_DELETED: "module:deleted",

  // Member events
  MEMBER_ADDED: "member:added",
  MEMBER_UPDATED: "member:updated",
  MEMBER_REMOVED: "member:removed",

  // Notification events
  NOTIFICATION_CREATED: "notification:created",
  NOTIFICATION_READ: "notification:read",

  // Presence events
  USER_ONLINE: "presence:online",
  USER_OFFLINE: "presence:offline",
  USER_TYPING: "presence:typing",
} as const;
```

### 5.5 Client Integration Example

```typescript
// Frontend: hooks/useRealtime.ts
export function useRealtimeSubscription(topic: string, onEvent: (data: any) => void) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}/realtime`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", topic }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "event" && data.topic === topic) {
        onEvent(data.data);
      }
    };

    return () => {
      ws.send(JSON.stringify({ type: "unsubscribe", topic }));
      ws.close();
    };
  }, [topic]);
}
```

### Deliverables

- [ ] WebSocket server with Bun native pub/sub
- [ ] Topic-based subscription system
- [ ] Authentication for WebSocket connections
- [ ] Event emission from services
- [ ] Presence tracking (online/offline)
- [ ] Typing indicators
- [ ] Frontend SDK/hooks

---

## Phase 6: Background Jobs (Weeks 17-18)

### 6.1 Job Queue with SQLite

```typescript
// src/db/schema/jobs.ts
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
  (table) => ({
    statusQueueIdx: index("job_status_queue_idx").on(table.status, table.queue, table.runAt),
  })
);
```

### 6.2 Job Worker

```typescript
// src/workers/queue.ts
import { db } from "../db";
import { jobs } from "../db/schema";
import { eq, and, lte, sql } from "drizzle-orm";

type JobHandler = (payload: any) => Promise<void>;
const handlers = new Map<string, JobHandler>();

export function registerHandler(name: string, handler: JobHandler) {
  handlers.set(name, handler);
}

export async function enqueue(
  name: string,
  payload: any,
  options?: {
    queue?: string;
    runAt?: Date;
    maxAttempts?: number;
  }
) {
  await db.insert(jobs).values({
    name,
    payload,
    queue: options?.queue ?? "default",
    runAt: options?.runAt ?? new Date(),
    maxAttempts: options?.maxAttempts ?? 3,
  });
}

export async function processJobs(queue = "default") {
  while (true) {
    const [job] = await db
      .update(jobs)
      .set({
        status: "running",
        startedAt: new Date(),
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(and(eq(jobs.status, "pending"), eq(jobs.queue, queue), lte(jobs.runAt, new Date())))
      .returning();

    if (!job) {
      await Bun.sleep(1000); // No jobs, wait
      continue;
    }

    const handler = handlers.get(job.name);
    if (!handler) {
      await markFailed(job.id, `No handler for job: ${job.name}`);
      continue;
    }

    try {
      await handler(job.payload);
      await db.update(jobs).set({ status: "completed", completedAt: new Date() }).where(eq(jobs.id, job.id));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (job.attempts >= job.maxAttempts) {
        await markFailed(job.id, errorMessage);
      } else {
        // Retry with exponential backoff
        const retryAt = new Date(Date.now() + Math.pow(2, job.attempts) * 1000);
        await db
          .update(jobs)
          .set({
            status: "pending",
            lastError: errorMessage,
            runAt: retryAt,
          })
          .where(eq(jobs.id, job.id));
      }
    }
  }
}

async function markFailed(jobId: string, error: string) {
  await db.update(jobs).set({ status: "failed", lastError: error, completedAt: new Date() }).where(eq(jobs.id, jobId));
}
```

### 6.3 Scheduled Jobs (Cron)

```typescript
// src/workers/scheduler.ts
import { CronJob } from "cron";
import { enqueue } from "./queue";

const scheduledJobs: CronJob[] = [];

export function initScheduler() {
  // Email notifications - every 5 minutes
  scheduledJobs.push(
    new CronJob("*/5 * * * *", () => {
      enqueue("process_email_notifications", {});
    })
  );

  // Cleanup expired sessions - daily at 2 AM
  scheduledJobs.push(
    new CronJob("0 2 * * *", () => {
      enqueue("cleanup_expired_sessions", {});
    })
  );

  // Archive completed issues - daily at 3 AM
  scheduledJobs.push(
    new CronJob("0 3 * * *", () => {
      enqueue("auto_archive_issues", {});
    })
  );

  // Cleanup API logs - daily at 4 AM
  scheduledJobs.push(
    new CronJob("0 4 * * *", () => {
      enqueue("cleanup_api_logs", { olderThanDays: 30 });
    })
  );

  // Generate cycle progress snapshots - every hour
  scheduledJobs.push(
    new CronJob("0 * * * *", () => {
      enqueue("snapshot_cycle_progress", {});
    })
  );

  // Start all jobs
  scheduledJobs.forEach((job) => job.start());
}
```

### 6.4 Job Handlers

```typescript
// src/workers/handlers/index.ts
import { registerHandler } from "../queue";
import { emailService } from "../../services/email.service";
import { cycleService } from "../../services/cycle.service";

// Email notifications
registerHandler("send_email", async (payload) => {
  const { to, subject, template, data } = payload;
  await emailService.send(to, subject, template, data);
});

registerHandler("process_email_notifications", async () => {
  const pendingNotifications = await notificationService.getPendingEmails();
  for (const notification of pendingNotifications) {
    await enqueue("send_email", {
      to: notification.user.email,
      subject: notification.title,
      template: "notification",
      data: notification,
    });
  }
});

// Webhooks
registerHandler("send_webhook", async (payload) => {
  const { webhookId, event, data } = payload;
  const webhook = await webhookService.findById(webhookId);

  const response = await fetch(webhook.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Secret": webhook.secret,
    },
    body: JSON.stringify({ event, data, timestamp: Date.now() }),
  });

  await webhookService.logDelivery(webhookId, event, response.status);
});

// Issue activities
registerHandler("create_issue_activity", async (payload) => {
  await issueService.createActivity(payload);
});

// Cycle progress snapshots
registerHandler("snapshot_cycle_progress", async () => {
  const activeCycles = await cycleService.getActiveCycles();
  for (const cycle of activeCycles) {
    await cycleService.snapshotProgress(cycle.id);
  }
});

// Cleanup tasks
registerHandler("cleanup_expired_sessions", async () => {
  await sessionService.deleteExpired();
});

registerHandler("cleanup_api_logs", async (payload) => {
  const cutoff = new Date(Date.now() - payload.olderThanDays * 24 * 60 * 60 * 1000);
  await apiLogService.deleteOlderThan(cutoff);
});
```

### 6.5 Worker Process Entry

```typescript
// src/worker.ts
import { processJobs } from "./workers/queue";
import { initScheduler } from "./workers/scheduler";
import "./workers/handlers"; // Register all handlers

async function main() {
  console.log("Starting worker...");

  // Start scheduler for cron jobs
  initScheduler();
  console.log("Scheduler initialized");

  // Start job processors for each queue
  const queues = ["default", "emails", "webhooks", "cleanup"];

  for (const queue of queues) {
    processJobs(queue).catch(console.error);
    console.log(`Processing queue: ${queue}`);
  }
}

main();
```

### Deliverables

- [ ] SQLite-backed job queue
- [ ] Job worker with retry logic
- [ ] Scheduled jobs (cron)
- [ ] Email notification processing
- [ ] Webhook delivery
- [ ] Issue activity tracking
- [ ] Cleanup tasks
- [ ] Worker process management

---

## Phase 7: Pages, Assets & Integrations (Weeks 19-21)

### 7.1 Pages Schema

```typescript
// src/db/schema/page.ts
export const pages = sqliteTable("pages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  projectId: text("project_id").references(() => projects.id),
  parentId: text("parent_id").references(() => pages.id),
  name: text("name").notNull(),
  descriptionHtml: text("description_html"),
  descriptionBinary: blob("description_binary"), // Tiptap Y.js binary
  colorProp: text("color_prop"),
  iconProp: text("icon_prop"),
  coverImage: text("cover_image"),
  accessLevel: integer("access_level").default(0), // 0=Private, 1=Collaborators
  isLocked: integer("is_locked", { mode: "boolean" }).default(false),
  ownedById: text("owned_by_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
});

export const pageVersions = sqliteTable("page_versions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  pageId: text("page_id")
    .notNull()
    .references(() => pages.id, { onDelete: "cascade" }),
  descriptionHtml: text("description_html"),
  ownedById: text("owned_by_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

### 7.2 File Assets

```typescript
// src/db/schema/asset.ts
export const fileAssets = sqliteTable("file_assets", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  entityType: text("entity_type"), // 'issue', 'page', 'project', 'user'
  entityId: text("entity_id"),
  assetType: text("asset_type").notNull(), // 'cover', 'attachment', 'avatar'
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type"),
  storageKey: text("storage_key").notNull(), // S3/local path
  uploadedById: text("uploaded_by_id").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
```

### 7.3 Storage Service

```typescript
// src/services/storage.service.ts
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.S3_ENDPOINT, // For Minio compatibility
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export const storageService = {
  async upload(file: File, key: string): Promise<string> {
    const buffer = await file.arrayBuffer();

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: Buffer.from(buffer),
        ContentType: file.type,
      })
    );

    return key;
  },

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    });

    return getSignedUrl(s3, command, { expiresIn });
  },

  async delete(key: string): Promise<void> {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
      })
    );
  },

  generateKey(workspaceId: string, entityType: string, fileName: string): string {
    const timestamp = Date.now();
    const sanitized = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `${workspaceId}/${entityType}/${timestamp}-${sanitized}`;
  },
};
```

### 7.4 GitHub Integration

```typescript
// src/integrations/github/service.ts
import { Octokit } from "@octokit/rest";

export class GitHubIntegrationService {
  private getOctokit(accessToken: string) {
    return new Octokit({ auth: accessToken });
  }

  async syncRepository(integrationId: string, repoFullName: string) {
    const integration = await this.getIntegration(integrationId);
    const octokit = this.getOctokit(integration.accessToken);
    const [owner, repo] = repoFullName.split("/");

    // Fetch issues from GitHub
    const { data: ghIssues } = await octokit.issues.listForRepo({
      owner,
      repo,
      state: "all",
      per_page: 100,
    });

    for (const ghIssue of ghIssues) {
      await this.syncIssue(integration.projectId, ghIssue);
    }
  }

  async createWebhook(integrationId: string, repoFullName: string) {
    const integration = await this.getIntegration(integrationId);
    const octokit = this.getOctokit(integration.accessToken);
    const [owner, repo] = repoFullName.split("/");

    await octokit.repos.createWebhook({
      owner,
      repo,
      config: {
        url: `${process.env.API_URL}/webhooks/github`,
        content_type: "json",
        secret: integration.webhookSecret,
      },
      events: ["issues", "issue_comment", "pull_request"],
    });
  }

  async handleWebhook(payload: any, signature: string) {
    // Verify signature
    // Process event based on type
    switch (payload.action) {
      case "opened":
      case "edited":
      case "closed":
        await this.syncIssue(payload);
        break;
      case "created": // comment
        await this.syncComment(payload);
        break;
    }
  }
}
```

### 7.5 Slack Integration

```typescript
// src/integrations/slack/service.ts
import { WebClient } from "@slack/web-api";

export class SlackIntegrationService {
  private getClient(accessToken: string) {
    return new WebClient(accessToken);
  }

  async sendNotification(integrationId: string, channel: string, message: any) {
    const integration = await this.getIntegration(integrationId);
    const client = this.getClient(integration.accessToken);

    await client.chat.postMessage({
      channel,
      text: message.text,
      blocks: message.blocks,
    });
  }

  async notifyIssueCreated(integration: SlackIntegration, issue: Issue) {
    await this.sendNotification(integration.id, integration.channelId, {
      text: `New issue created: ${issue.name}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*<${issue.url}|${issue.identifier}: ${issue.name}>*`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Created by ${issue.createdBy.displayName}`,
            },
          ],
        },
      ],
    });
  }
}
```

### Deliverables

- [ ] Page CRUD with versioning
- [ ] Page hierarchy (parent-child)
- [ ] File upload/download
- [ ] Asset management
- [ ] GitHub integration (OAuth, sync, webhooks)
- [ ] Slack integration (notifications)
- [ ] Migration scripts

---

## Phase 8: Notifications & Analytics (Weeks 22-23)

### 8.1 Notifications Schema

```typescript
// src/db/schema/notification.ts
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    projectId: text("project_id").references(() => projects.id),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => users.id),
    senderType: text("sender_type"), // 'user', 'system'
    senderId: text("sender_id").references(() => users.id),
    entityType: text("entity_type"), // 'issue', 'page', 'cycle', 'module'
    entityId: text("entity_id"),
    title: text("title").notNull(),
    message: text("message"),
    data: text("data", { mode: "json" }),
    readAt: integer("read_at", { mode: "timestamp" }),
    snoozedUntil: integer("snoozed_until", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  },
  (table) => ({
    recipientIdx: index("notification_recipient_idx").on(table.recipientId, table.readAt),
  })
);

export const userNotificationPreferences = sqliteTable("user_notification_preferences", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  workspaceId: text("workspace_id").references(() => workspaces.id),
  projectId: text("project_id").references(() => projects.id),
  property: text("property").notNull(), // 'issue_assigned', 'issue_mentioned', etc.
  emailEnabled: integer("email_enabled", { mode: "boolean" }).default(true),
  pushEnabled: integer("push_enabled", { mode: "boolean" }).default(true),
});
```

### 8.2 Notification Service

```typescript
// src/services/notification.service.ts
export class NotificationService {
  async create(data: CreateNotificationInput) {
    const [notification] = await db.insert(notifications).values(data).returning();

    // Send realtime notification
    realtimeService.publish(realtimeService.userTopic(data.recipientId), {
      event: RealtimeEvents.NOTIFICATION_CREATED,
      data: notification,
    });

    // Queue email notification
    const preferences = await this.getUserPreferences(data.recipientId, data.workspaceId);
    if (preferences?.emailEnabled) {
      await enqueue(
        "send_email",
        {
          to: notification.recipient.email,
          subject: notification.title,
          template: "notification",
          data: notification,
        },
        { queue: "emails" }
      );
    }

    return notification;
  }

  async notifyIssueAssigned(issue: Issue, assignees: User[], actor: User) {
    for (const assignee of assignees) {
      if (assignee.id === actor.id) continue;

      await this.create({
        workspaceId: issue.workspaceId,
        projectId: issue.projectId,
        recipientId: assignee.id,
        senderId: actor.id,
        senderType: "user",
        entityType: "issue",
        entityId: issue.id,
        title: `You were assigned to ${issue.identifier}`,
        message: issue.name,
        data: { issueId: issue.id, identifier: issue.identifier },
      });
    }
  }

  async notifyMentioned(entityType: string, entityId: string, mentionedUserIds: string[], actor: User) {
    for (const userId of mentionedUserIds) {
      if (userId === actor.id) continue;

      await this.create({
        recipientId: userId,
        senderId: actor.id,
        senderType: "user",
        entityType,
        entityId,
        title: `${actor.displayName} mentioned you`,
      });
    }
  }
}
```

### 8.3 Analytics

```typescript
// src/services/analytics.service.ts
export class AnalyticsService {
  async getIssueDistribution(projectId: string) {
    return await db
      .select({
        stateGroup: states.group,
        count: count(),
      })
      .from(issues)
      .innerJoin(states, eq(issues.stateId, states.id))
      .where(and(eq(issues.projectId, projectId), isNull(issues.deletedAt)))
      .groupBy(states.group);
  }

  async getIssuesByAssignee(projectId: string) {
    return await db
      .select({
        assigneeId: issueAssignees.assigneeId,
        assigneeName: users.displayName,
        count: count(),
      })
      .from(issueAssignees)
      .innerJoin(issues, eq(issueAssignees.issueId, issues.id))
      .innerJoin(users, eq(issueAssignees.assigneeId, users.id))
      .where(eq(issues.projectId, projectId))
      .groupBy(issueAssignees.assigneeId, users.displayName);
  }

  async getBurndownData(cycleId: string) {
    const cycle = await db.query.cycles.findFirst({
      where: eq(cycles.id, cycleId),
    });

    if (!cycle?.startDate || !cycle?.endDate) return null;

    // Get daily completion data
    const completions = await db
      .select({
        date: sql`DATE(${issues.completedAt})`.as("date"),
        count: count(),
      })
      .from(cycleIssues)
      .innerJoin(issues, eq(cycleIssues.issueId, issues.id))
      .where(and(eq(cycleIssues.cycleId, cycleId), isNotNull(issues.completedAt)))
      .groupBy(sql`DATE(${issues.completedAt})`);

    return this.generateBurndownChart(cycle, completions);
  }

  async trackEvent(event: AnalyticsEvent) {
    // Store in SQLite for internal analytics
    await db.insert(analyticsEvents).values(event);

    // Forward to external analytics (PostHog, etc.) if configured
    if (process.env.POSTHOG_API_KEY) {
      await fetch("https://app.posthog.com/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.POSTHOG_API_KEY,
          ...event,
        }),
      });
    }
  }
}
```

### Deliverables

- [ ] Notification CRUD
- [ ] User notification preferences
- [ ] Email notifications
- [ ] Realtime notifications
- [ ] Issue analytics (distribution, burndown)
- [ ] User activity analytics
- [ ] Export functionality

---

## Phase 9: API Compatibility & Testing (Weeks 24-26)

### 9.1 Response Format Compatibility

Ensure Hono responses match Django DRF format:

```typescript
// src/utils/response.ts
import type { Context } from "hono";

export function paginatedResponse<T>(c: Context, items: T[], total: number, page: number, perPage: number) {
  const totalPages = Math.ceil(total / perPage);

  return c.json({
    count: total,
    next: page < totalPages ? `${c.req.url}?page=${page + 1}` : null,
    previous: page > 1 ? `${c.req.url}?page=${page - 1}` : null,
    results: items,
    total_pages: totalPages,
    current_page: page,
  });
}

export function errorResponse(c: Context, status: number, detail: string, code?: string) {
  return c.json(
    {
      detail,
      code: code ?? "error",
    },
    status
  );
}
```

### 9.2 API Versioning

```typescript
// src/routes/index.ts
import { Hono } from "hono";
import v1 from "./v1";
import v2 from "./v2";

const api = new Hono();

// V1 API (Django compatibility mode)
api.route("/v1", v1);

// V2 API (new endpoints)
api.route("/v2", v2);

// Default to v2
api.route("/", v2);

export default api;
```

### 9.3 Integration Tests

```typescript
// tests/integration/issues.test.ts
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app } from "../../src/app";
import { db } from "../../src/db";
import { seedTestData, cleanupTestData } from "../helpers";

describe("Issues API", () => {
  let testUser: any;
  let testProject: any;
  let authCookie: string;

  beforeAll(async () => {
    const { user, project, cookie } = await seedTestData();
    testUser = user;
    testProject = project;
    authCookie = cookie;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe("POST /api/workspaces/:slug/projects/:projectId/issues", () => {
    it("creates an issue", async () => {
      const res = await app.request(`/api/workspaces/${testProject.workspaceSlug}/projects/${testProject.id}/issues`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie,
        },
        body: JSON.stringify({
          name: "Test Issue",
          description_html: "<p>Description</p>",
          priority: 2,
        }),
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.name).toBe("Test Issue");
      expect(data.priority).toBe(2);
      expect(data.sequence_id).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.request(`/api/workspaces/${testProject.workspaceSlug}/projects/${testProject.id}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/workspaces/:slug/projects/:projectId/issues", () => {
    it("lists issues with pagination", async () => {
      const res = await app.request(
        `/api/workspaces/${testProject.workspaceSlug}/projects/${testProject.id}/issues?per_page=10`,
        { headers: { Cookie: authCookie } }
      );

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.results).toBeInstanceOf(Array);
      expect(data.count).toBeDefined();
      expect(data.total_pages).toBeDefined();
    });

    it("filters by state", async () => {
      const res = await app.request(
        `/api/workspaces/${testProject.workspaceSlug}/projects/${testProject.id}/issues?state=${testProject.defaultStateId}`,
        { headers: { Cookie: authCookie } }
      );

      const data = await res.json();
      expect(data.results.every((i: any) => i.state === testProject.defaultStateId)).toBe(true);
    });
  });
});
```

### 9.4 End-to-End Tests

```typescript
// tests/e2e/workflows.test.ts
import { describe, it, expect } from "bun:test";
import { app } from "../../src/app";

describe("E2E: Issue Workflow", () => {
  it("completes full issue lifecycle", async () => {
    // 1. Create workspace
    const workspace = await createWorkspace("Test Workspace");

    // 2. Create project
    const project = await createProject(workspace.id, "Test Project");

    // 3. Create issue
    const issue = await createIssue(project.id, { name: "Test Issue" });
    expect(issue.state_detail.group).toBe("backlog");

    // 4. Assign to user
    await updateIssue(issue.id, { assignee_ids: [testUser.id] });

    // 5. Move to in-progress
    const inProgressState = project.states.find((s) => s.group === "started");
    await updateIssue(issue.id, { state: inProgressState.id });

    // 6. Add comment
    await createComment(issue.id, { comment_html: "<p>Working on it</p>" });

    // 7. Complete issue
    const completedState = project.states.find((s) => s.group === "completed");
    const completed = await updateIssue(issue.id, { state: completedState.id });
    expect(completed.completed_at).toBeDefined();

    // 8. Verify activity log
    const activities = await getIssueActivities(issue.id);
    expect(activities.length).toBeGreaterThan(3);
  });
});
```

### 9.5 Performance Benchmarks

```typescript
// tests/benchmark/api.bench.ts
import { bench, run } from "mitata";
import { app } from "../../src/app";

bench("GET /issues (50 items)", async () => {
  await app.request("/api/workspaces/test/projects/test/issues?per_page=50", {
    headers: { Cookie: testAuthCookie },
  });
});

bench("POST /issues (create)", async () => {
  await app.request("/api/workspaces/test/projects/test/issues", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: testAuthCookie,
    },
    body: JSON.stringify({ name: `Bench Issue ${Date.now()}` }),
  });
});

bench("PATCH /issues (bulk update 10)", async () => {
  await app.request("/api/workspaces/test/projects/test/issues/bulk", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: testAuthCookie,
    },
    body: JSON.stringify({
      issue_ids: testIssueIds.slice(0, 10),
      priority: 2,
    }),
  });
});

await run();
```

### Deliverables

- [ ] Response format compatibility layer
- [ ] API versioning (v1 compat, v2 new)
- [ ] Unit tests for all services
- [ ] Integration tests for all endpoints
- [ ] E2E tests for critical workflows
- [ ] Performance benchmarks
- [ ] Load testing setup

---

## Phase 10: Data Migration & Cutover (Weeks 27-28)

### 10.1 Migration Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PostgreSQL    │────▶│  Migration      │────▶│    SQLite       │
│   (Django)      │     │  Pipeline       │     │    (Drizzle)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
         │              ┌───────┴───────┐               │
         │              │   Validation  │               │
         │              │   & Rollback  │               │
         │              └───────────────┘               │
         │                                              │
         └──────────── Parallel Operation ──────────────┘
```

### 10.2 Migration Script

```typescript
// scripts/migrate-data.ts
import { Pool } from "pg";
import { db } from "../src/db";
import * as schema from "../src/db/schema";

const pgPool = new Pool({
  connectionString: process.env.DJANGO_DATABASE_URL,
});

interface MigrationStats {
  table: string;
  total: number;
  migrated: number;
  errors: number;
}

const stats: MigrationStats[] = [];

async function migrateTable<T>(tableName: string, pgQuery: string, transform: (row: any) => T, drizzleTable: any) {
  console.log(`Migrating ${tableName}...`);
  const stat: MigrationStats = { table: tableName, total: 0, migrated: 0, errors: 0 };

  const { rows } = await pgPool.query(pgQuery);
  stat.total = rows.length;

  const batchSize = 1000;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    try {
      const transformed = batch.map(transform);
      await db.insert(drizzleTable).values(transformed).onConflictDoNothing();
      stat.migrated += batch.length;
    } catch (error) {
      console.error(`Error migrating ${tableName} batch ${i}:`, error);
      stat.errors += batch.length;
    }

    console.log(`  ${tableName}: ${stat.migrated}/${stat.total}`);
  }

  stats.push(stat);
}

async function main() {
  // Order matters: respect foreign key dependencies

  // 1. Users
  await migrateTable(
    "users",
    "SELECT * FROM users WHERE is_active = true",
    (row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
      displayName: row.display_name || row.first_name,
      avatar: row.avatar,
      passwordHash: row.password,
      isActive: row.is_active,
      isOnboarded: row.is_onboarded,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }),
    schema.users
  );

  // 2. Workspaces
  await migrateTable(
    "workspaces",
    "SELECT * FROM workspaces WHERE deleted_at IS NULL",
    (row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo,
      ownerId: row.owner_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }),
    schema.workspaces
  );

  // 3. Workspace Members
  await migrateTable(
    "workspace_members",
    "SELECT * FROM workspace_members",
    (row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      userId: row.member_id,
      role: row.role,
      createdAt: new Date(row.created_at),
    }),
    schema.workspaceMembers
  );

  // Continue for all tables...
  // 4. Projects
  // 5. Project Members
  // 6. States
  // 7. Labels
  // 8. Issues
  // 9. Issue Assignees
  // 10. Issue Labels
  // 11. Issue Comments
  // 12. Issue Activities
  // 13. Cycles
  // 14. Cycle Issues
  // 15. Modules
  // 16. Module Issues
  // 17. Pages
  // 18. Notifications
  // etc.

  // Print summary
  console.log("\nMigration Summary:");
  console.table(stats);

  const totalErrors = stats.reduce((sum, s) => sum + s.errors, 0);
  if (totalErrors > 0) {
    console.error(`\nWarning: ${totalErrors} total errors during migration`);
    process.exit(1);
  }
}

main()
  .catch(console.error)
  .finally(() => pgPool.end());
```

### 10.3 Validation Script

```typescript
// scripts/validate-migration.ts
async function validateCounts() {
  const tables = [
    { pg: "users", sqlite: schema.users },
    { pg: "workspaces", sqlite: schema.workspaces },
    { pg: "projects", sqlite: schema.projects },
    { pg: "issues", sqlite: schema.issues },
    // ... all tables
  ];

  const results: any[] = [];

  for (const { pg, sqlite } of tables) {
    const pgCount = await pgPool.query(`SELECT COUNT(*) FROM ${pg}`);
    const sqliteCount = await db.select({ count: count() }).from(sqlite);

    results.push({
      table: pg,
      postgres: pgCount.rows[0].count,
      sqlite: sqliteCount[0].count,
      match: pgCount.rows[0].count === sqliteCount[0].count,
    });
  }

  console.table(results);
  return results.every((r) => r.match);
}

async function validateRelationships() {
  // Check foreign key integrity
  const orphanedIssues = await db
    .select({ count: count() })
    .from(schema.issues)
    .leftJoin(schema.projects, eq(schema.issues.projectId, schema.projects.id))
    .where(isNull(schema.projects.id));

  if (orphanedIssues[0].count > 0) {
    console.error(`Found ${orphanedIssues[0].count} orphaned issues`);
    return false;
  }

  // Add more relationship checks...
  return true;
}
```

### 10.4 Cutover Plan

```markdown
## Cutover Checklist

### T-24 Hours

- [ ] Final data sync from PostgreSQL to SQLite
- [ ] Validate migration counts
- [ ] Run integration tests against new API
- [ ] Notify users of maintenance window

### T-1 Hour

- [ ] Enable maintenance mode on frontend
- [ ] Stop Django workers (Celery, etc.)
- [ ] Final incremental data sync
- [ ] Validate data integrity

### Cutover (T-0)

- [ ] Update API gateway to route to Bun API
- [ ] Start Bun API servers
- [ ] Start Bun workers
- [ ] Smoke test critical endpoints
- [ ] Disable maintenance mode

### T+1 Hour

- [ ] Monitor error rates
- [ ] Monitor latency metrics
- [ ] Check WebSocket connections
- [ ] Verify background jobs running

### Rollback Triggers

- Error rate > 5%
- P95 latency > 2x baseline
- Critical functionality broken
- Data corruption detected

### Rollback Procedure

1. Re-enable maintenance mode
2. Route traffic back to Django
3. Restart Django services
4. Disable Bun services
5. Sync any new data back to PostgreSQL
6. Disable maintenance mode
```

### 10.5 Monitoring Setup

```typescript
// src/middleware/monitoring.ts
import { createMiddleware } from "hono/factory";

export const metricsMiddleware = createMiddleware(async (c, next) => {
  const start = performance.now();

  await next();

  const duration = performance.now() - start;
  const path = c.req.routePath || c.req.path;
  const method = c.req.method;
  const status = c.res.status;

  // Log to stdout for collection
  console.log(
    JSON.stringify({
      type: "http_request",
      method,
      path,
      status,
      duration_ms: duration.toFixed(2),
      timestamp: new Date().toISOString(),
    })
  );

  // Increment counters (if using external metrics)
  metrics.httpRequestsTotal.inc({ method, path, status });
  metrics.httpRequestDuration.observe({ method, path }, duration);
});
```

### Deliverables

- [ ] Full data migration scripts
- [ ] Data validation scripts
- [ ] Incremental sync for cutover
- [ ] Rollback procedures
- [ ] Monitoring dashboards
- [ ] Runbook documentation

---

## Appendix A: Complete Drizzle Schema Reference

See `src/db/schema/index.ts` for the complete schema definition.

## Appendix B: API Endpoint Mapping

| Django Endpoint                                 | Hono Endpoint                                | Notes          |
| ----------------------------------------------- | -------------------------------------------- | -------------- |
| `/api/v1/workspaces/`                           | `/api/workspaces/`                           | Direct mapping |
| `/api/v1/workspaces/:slug/projects/`            | `/api/workspaces/:slug/projects/`            | Direct mapping |
| `/api/v1/workspaces/:slug/projects/:id/issues/` | `/api/workspaces/:slug/projects/:id/issues/` | Direct mapping |
| ...                                             | ...                                          | ...            |

## Appendix C: Environment Variables

```bash
# Database
DATABASE_URL=file:./data/plane.db
# For production with Turso/libSQL:
# DATABASE_URL=libsql://your-db.turso.io
# DATABASE_AUTH_TOKEN=your-token

# Better Auth Configuration
BETTER_AUTH_SECRET=your-secret-key-min-32-chars  # Required: used for signing tokens
BETTER_AUTH_URL=http://localhost:3000            # Base URL of your API
FRONTEND_URL=http://localhost:3001               # Frontend URL for CORS

# OAuth Providers (Better Auth)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITLAB_CLIENT_ID=...
GITLAB_CLIENT_SECRET=...
GITLAB_ISSUER=https://gitlab.com  # Or your self-hosted GitLab URL

# Optional: Gitea OAuth (custom provider)
GITEA_CLIENT_ID=...
GITEA_CLIENT_SECRET=...
GITEA_ISSUER=https://gitea.example.com

# Storage
S3_BUCKET=plane-uploads
S3_ENDPOINT=https://s3.amazonaws.com
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1

# Email (for Better Auth magic links, password reset, etc.)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=noreply@yourplane.app

# Optional Analytics
POSTHOG_API_KEY=...
```

## Timeline Summary

| Phase     | Duration     | Description                  |
| --------- | ------------ | ---------------------------- |
| 0         | 2 weeks      | Foundation & Infrastructure  |
| 1         | 2 weeks      | Authentication & Users       |
| 2         | 3 weeks      | Workspaces & Projects        |
| 3         | 4 weeks      | Issues & Work Items          |
| 4         | 3 weeks      | Cycles, Modules & Views      |
| 5         | 2 weeks      | Realtime (WebSocket)         |
| 6         | 2 weeks      | Background Jobs              |
| 7         | 3 weeks      | Pages, Assets & Integrations |
| 8         | 2 weeks      | Notifications & Analytics    |
| 9         | 3 weeks      | Testing & Compatibility      |
| 10        | 2 weeks      | Data Migration & Cutover     |
| **Total** | **28 weeks** | ~7 months                    |

## Risk Mitigation

| Risk                       | Mitigation                                                |
| -------------------------- | --------------------------------------------------------- |
| Data loss during migration | Incremental sync, validation scripts, rollback procedures |
| API incompatibility        | Extensive integration tests, v1 compatibility layer       |
| Performance regression     | Benchmarks, load testing, gradual traffic shifting        |
| Realtime feature gaps      | Feature flag for WebSocket, fallback to polling           |
| Team learning curve        | Documentation, pair programming, incremental rollout      |

---

_This migration plan should be reviewed and adjusted based on team capacity, business priorities, and technical discoveries during implementation._

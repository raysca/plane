# Plane API Migration Tasks: Django to Bun + Hono

> **Goal**: 100% frontend compatibility - the web app should work identically with the new backend.

## Legend

- [ ] Not started
- [x] Completed
- 🔄 In progress

---

## Phase 0: Foundation & Infrastructure

### 0.1 Project Setup

- [ ] Create `apps/api-next/` directory structure
- [ ] Initialize Bun project with `bun init`
- [ ] Configure TypeScript (`tsconfig.json`)
- [ ] Add core dependencies:
  - [ ] `hono` - Web framework
  - [ ] `drizzle-orm` - ORM
  - [ ] `better-sqlite3` / `@libsql/client` - SQLite driver
  - [ ] `better-auth` - Authentication
  - [ ] `zod` - Validation
  - [ ] `@hono/zod-validator` - Request validation
- [ ] Create `bunfig.toml` configuration
- [ ] Set up `drizzle.config.ts`

### 0.2 Database Setup

- [ ] Design Drizzle schema matching Django models:
  - [ ] `users` table (Better Auth managed)
  - [ ] `sessions` table (Better Auth managed)
  - [ ] `accounts` table (Better Auth managed)
  - [ ] `workspaces` table
  - [ ] `workspace_members` table
  - [ ] `projects` table
  - [ ] `project_members` table
  - [ ] `states` table
  - [ ] `labels` table
  - [ ] `issues` table
  - [ ] `issue_assignees` table
  - [ ] `issue_labels` table
  - [ ] `issue_comments` table
  - [ ] `issue_activities` table
  - [ ] `issue_reactions` table
  - [ ] `issue_relations` table
  - [ ] `issue_attachments` table
  - [ ] `cycles` table
  - [ ] `cycle_issues` table
  - [ ] `modules` table
  - [ ] `module_issues` table
  - [ ] `module_members` table
  - [ ] `pages` table
  - [ ] `page_versions` table
  - [ ] `views` table
  - [ ] `notifications` table
  - [ ] `webhooks` table
  - [ ] `webhook_logs` table
  - [ ] `file_assets` table
  - [ ] `api_tokens` table
  - [ ] `favorites` table
  - [ ] `recent_visits` table
  - [ ] `integrations` table
  - [ ] `workspace_integrations` table
- [ ] Generate initial migration
- [ ] Create database indexes matching Django

### 0.3 Core App Structure

- [ ] Create Hono app entry point (`src/index.ts`)
- [ ] Set up CORS middleware for frontend origins
- [ ] Create health check endpoint (`GET /api/health/`)
- [ ] Set up request logging middleware
- [ ] Configure error handling middleware
- [ ] Create response helpers (match DRF format)

### 0.4 Environment Configuration

- [ ] Create `.env.example` with all required variables
- [ ] Configure Vite define for `__API_BASE_URL__` in frontend
- [ ] Document environment variables

---

## Phase 1: Authentication (Better Auth)

### 1.1 Better Auth Setup

- [ ] Configure Better Auth with Drizzle adapter
- [ ] Set up session configuration (30-day expiry)
- [ ] Configure cookie settings (`httpOnly`, `sameSite`, `secure`)

### 1.2 OAuth Providers

- [ ] Configure Google OAuth
- [ ] Configure GitHub OAuth
- [ ] Configure GitLab OAuth
- [ ] Configure Gitea OAuth (via `genericOAuth` plugin)
- [ ] Test OAuth callback URLs

### 1.3 Email/Password Auth

- [ ] Enable email/password authentication
- [ ] Configure password reset flow
- [ ] Set up email verification (optional)

### 1.4 Magic Link Auth

- [ ] Add `magicLink` plugin
- [ ] Configure magic link email sending
- [ ] Test magic link flow

### 1.5 CSRF Protection (Frontend Compatibility)

> **Critical**: Frontend expects `/auth/get-csrf-token/` endpoint

- [ ] Implement `GET /auth/get-csrf-token/` endpoint
- [ ] Return CSRF token in response
- [ ] Validate `X-CSRFTOKEN` header on state-changing requests
- [ ] Apply CSRF validation to auth endpoints:
  - [ ] `POST /auth/sign-in/`
  - [ ] `POST /auth/magic-generate/`
  - [ ] `POST /auth/magic-sign-in/`
  - [ ] `POST /auth/forgot-password/`
  - [ ] `POST /auth/set-password/`
  - [ ] `POST /auth/sign-out/`

### 1.6 Auth Endpoints (Frontend Compatibility)

> Must match exact paths frontend expects

- [ ] `POST /auth/sign-in/` - Password sign in
- [ ] `POST /auth/sign-up/` - Registration
- [ ] `POST /auth/sign-out/` - Sign out (form submission)
- [ ] `POST /auth/magic-generate/` - Request magic code
- [ ] `POST /auth/magic-sign-in/` - Verify magic code
- [ ] `POST /auth/forgot-password/` - Request password reset
- [ ] `POST /auth/set-password/` - Set new password
- [ ] `GET /auth/google/` - Google OAuth redirect
- [ ] `GET /auth/github/` - GitHub OAuth redirect
- [ ] `GET /auth/gitlab/` - GitLab OAuth redirect
- [ ] `GET /auth/gitea/` - Gitea OAuth redirect
- [ ] OAuth callback handlers

### 1.7 Auth Middleware

- [ ] Create `authMiddleware` using Better Auth session
- [ ] Create `optionalAuthMiddleware` for public endpoints
- [ ] Handle 401 responses correctly (frontend expects redirect)

---

## Phase 2: User Endpoints

### 2.1 Current User (`/api/users/me/`)

- [ ] `GET /api/users/me/` - Get current user
- [ ] `PATCH /api/users/me/` - Update current user
- [ ] `GET /api/users/me/profile/` - Get user profile
- [ ] `PATCH /api/users/me/profile/` - Update profile
- [ ] `GET /api/users/me/settings/` - Get user settings
- [ ] `PATCH /api/users/me/settings/` - Update settings
- [ ] `GET /api/users/me/accounts/` - Get linked accounts
- [ ] `GET /api/users/me/workspaces/` - Get user's workspaces
- [ ] `GET /api/users/me/activities/` - Get user activities
- [ ] `GET /api/users/me/notification-preferences/` - Notification prefs
- [ ] `PATCH /api/users/me/notification-preferences/` - Update prefs
- [ ] `GET /api/users/me/instance-admin/` - Check admin status
- [ ] `GET /api/users/last-visited-workspace/` - Last workspace

### 2.2 User Email Management

- [ ] `GET /api/users/me/email/` - Get emails
- [ ] `POST /api/users/me/email/` - Add email
- [ ] `DELETE /api/users/me/email/:emailId/` - Remove email
- [ ] `POST /api/users/me/email/:emailId/set-primary/` - Set primary

---

## Phase 3: Workspace Endpoints

### 3.1 Workspace CRUD

- [ ] `GET /api/workspaces/` - List workspaces
- [ ] `POST /api/workspaces/` - Create workspace
- [ ] `GET /api/workspaces/:slug/` - Get workspace
- [ ] `PATCH /api/workspaces/:slug/` - Update workspace
- [ ] `DELETE /api/workspaces/:slug/` - Delete workspace

### 3.2 Workspace Members

- [ ] `GET /api/workspaces/:slug/members/` - List members
- [ ] `POST /api/workspaces/:slug/members/` - Add member
- [ ] `PATCH /api/workspaces/:slug/members/:memberId/` - Update member
- [ ] `DELETE /api/workspaces/:slug/members/:memberId/` - Remove member
- [ ] `GET /api/workspaces/:slug/members/me/` - Current member info

### 3.3 Workspace Invitations

- [ ] `GET /api/workspaces/:slug/invitations/` - List invitations
- [ ] `POST /api/workspaces/:slug/invitations/` - Create invitation
- [ ] `DELETE /api/workspaces/:slug/invitations/:id/` - Cancel invitation
- [ ] `POST /api/workspaces/:slug/invitations/:id/join/` - Accept invitation

### 3.4 Workspace Labels & States

- [ ] `GET /api/workspaces/:slug/labels/` - List workspace labels
- [ ] `POST /api/workspaces/:slug/labels/` - Create label
- [ ] `PATCH /api/workspaces/:slug/labels/:id/` - Update label
- [ ] `DELETE /api/workspaces/:slug/labels/:id/` - Delete label
- [ ] `GET /api/workspaces/:slug/states/` - List workspace states

### 3.5 Workspace Preferences

- [ ] `GET /api/workspaces/:slug/sidebar-preferences/` - Get sidebar prefs
- [ ] `PATCH /api/workspaces/:slug/sidebar-preferences/` - Update prefs

---

## Phase 4: Project Endpoints

### 4.1 Project CRUD

- [ ] `GET /api/workspaces/:slug/projects/` - List projects
- [ ] `POST /api/workspaces/:slug/projects/` - Create project
- [ ] `GET /api/workspaces/:slug/projects/details/` - Detailed list
- [ ] `GET /api/workspaces/:slug/projects/:projectId/` - Get project
- [ ] `PATCH /api/workspaces/:slug/projects/:projectId/` - Update project
- [ ] `DELETE /api/workspaces/:slug/projects/:projectId/` - Delete project

### 4.2 Project Identifiers

- [ ] `GET /api/workspaces/:slug/project-identifiers/` - Check availability

### 4.3 Project Members

- [ ] `GET /api/workspaces/:slug/projects/:projectId/members/` - List
- [ ] `POST /api/workspaces/:slug/projects/:projectId/members/` - Add
- [ ] `PATCH /api/workspaces/:slug/projects/:projectId/members/:id/` - Update
- [ ] `DELETE /api/workspaces/:slug/projects/:projectId/members/:id/` - Remove

### 4.4 Project States

- [ ] `GET /api/workspaces/:slug/projects/:projectId/states/` - List states
- [ ] `POST /api/workspaces/:slug/projects/:projectId/states/` - Create
- [ ] `PATCH /api/workspaces/:slug/projects/:projectId/states/:id/` - Update
- [ ] `DELETE /api/workspaces/:slug/projects/:projectId/states/:id/` - Delete

### 4.5 Project Labels

- [ ] `GET /api/workspaces/:slug/projects/:projectId/labels/` - List labels
- [ ] `POST /api/workspaces/:slug/projects/:projectId/labels/` - Create
- [ ] `PATCH /api/workspaces/:slug/projects/:projectId/labels/:id/` - Update
- [ ] `DELETE /api/workspaces/:slug/projects/:projectId/labels/:id/` - Delete

### 4.6 Project Favorites

- [ ] `GET /api/workspaces/:slug/projects/:projectId/user-favorite-projects/`
- [ ] `POST /api/workspaces/:slug/projects/:projectId/user-favorite-projects/`
- [ ] `DELETE /api/workspaces/:slug/projects/:projectId/user-favorite-projects/`

---

## Phase 5: Issue Endpoints

### 5.1 Issue CRUD

- [ ] `GET /api/workspaces/:slug/projects/:projectId/issues/` - List issues
- [ ] `POST /api/workspaces/:slug/projects/:projectId/issues/` - Create issue
- [ ] `GET /api/workspaces/:slug/projects/:projectId/issues/:issueId/` - Get
- [ ] `PATCH /api/workspaces/:slug/projects/:projectId/issues/:issueId/` - Update
- [ ] `DELETE /api/workspaces/:slug/projects/:projectId/issues/:issueId/` - Delete
- [ ] `GET /api/workspaces/:slug/projects/:projectId/issues-detail/` - Detailed

### 5.2 Issue V2 API (Sync)

- [ ] `GET /api/workspaces/:slug/projects/:projectId/v2/issues/` - V2 list

### 5.3 Issue Filtering & Pagination

> **Critical**: Frontend uses cursor-based pagination

- [ ] Support `cursor` query parameter
- [ ] Support `per_page` query parameter (default 50)
- [ ] Support filtering by:
  - [ ] `state` - State ID
  - [ ] `priority` - Priority level
  - [ ] `assignees` - Comma-separated user IDs
  - [ ] `labels` - Comma-separated label IDs
  - [ ] `parent` - Parent issue ID
  - [ ] `start_date` / `target_date` - Date filters
  - [ ] `created_at__gte` / `created_at__lte` - Date range
- [ ] Support `order_by` parameter
- [ ] Support `group_by` parameter
- [ ] Return pagination metadata in response

### 5.4 Issue Comments

- [ ] `GET .../issues/:issueId/comments/` - List comments
- [ ] `POST .../issues/:issueId/comments/` - Create comment
- [ ] `PATCH .../issues/:issueId/comments/:commentId/` - Update
- [ ] `DELETE .../issues/:issueId/comments/:commentId/` - Delete

### 5.5 Issue History/Activity

- [ ] `GET .../issues/:issueId/history/` - Get activity + comments

### 5.6 Issue Reactions

- [ ] `GET .../issues/:issueId/reactions/` - List reactions
- [ ] `POST .../issues/:issueId/reactions/` - Add reaction
- [ ] `DELETE .../issues/:issueId/reactions/:reactionId/` - Remove

### 5.7 Issue Relations

- [ ] `GET .../issues/:issueId/issue-relation/` - List relations
- [ ] `POST .../issues/:issueId/issue-relation/` - Create relation
- [ ] `DELETE .../issues/:issueId/issue-relation/:relationId/` - Remove

### 5.8 Issue Attachments

- [ ] `GET .../issues/:issueId/attachments/` - List attachments
- [ ] `POST .../issues/:issueId/attachments/` - Upload attachment
- [ ] `DELETE .../issues/:issueId/attachments/:attachmentId/` - Delete

### 5.9 Bulk Operations

- [ ] `POST .../bulk-operation-issues/` - Bulk update issues

### 5.10 Archived & Deleted Issues

- [ ] `GET .../archived-issues/` - List archived
- [ ] `POST .../issues/:issueId/archive/` - Archive issue
- [ ] `POST .../issues/:issueId/unarchive/` - Unarchive
- [ ] `GET .../deleted-issues/` - List deleted
- [ ] `POST .../issues/:issueId/restore/` - Restore deleted

### 5.11 My Issues

- [ ] `GET /api/workspaces/:slug/my-issues/` - User's assigned issues

---

## Phase 6: Cycle Endpoints

### 6.1 Cycle CRUD

- [ ] `GET /api/workspaces/:slug/cycles/` - Workspace cycles
- [ ] `GET /api/workspaces/:slug/active-cycles/` - Active cycles
- [ ] `GET /api/workspaces/:slug/projects/:projectId/cycles/` - Project cycles
- [ ] `POST /api/workspaces/:slug/projects/:projectId/cycles/` - Create
- [ ] `GET .../cycles/:cycleId/` - Get cycle
- [ ] `PATCH .../cycles/:cycleId/` - Update cycle
- [ ] `DELETE .../cycles/:cycleId/` - Delete cycle

### 6.2 Cycle Issues

- [ ] `GET .../cycles/:cycleId/cycle-issues/` - List issues
- [ ] `POST .../cycles/:cycleId/cycle-issues/` - Add issues
- [ ] `DELETE .../cycles/:cycleId/cycle-issues/:issueId/` - Remove issue

### 6.3 Cycle Analytics

- [ ] `GET .../cycles/:cycleId/progress/` - Progress stats
- [ ] `GET .../cycles/:cycleId/analytics/` - Analytics data

### 6.4 Cycle Archive

- [ ] `GET .../archived-cycles/` - List archived
- [ ] `POST .../cycles/:cycleId/archive/` - Archive
- [ ] `POST .../cycles/:cycleId/unarchive/` - Unarchive

---

## Phase 7: Module Endpoints

### 7.1 Module CRUD

- [ ] `GET /api/workspaces/:slug/modules/` - Workspace modules
- [ ] `GET /api/workspaces/:slug/projects/:projectId/modules/` - Project modules
- [ ] `POST /api/workspaces/:slug/projects/:projectId/modules/` - Create
- [ ] `GET .../modules/:moduleId/` - Get module
- [ ] `PATCH .../modules/:moduleId/` - Update
- [ ] `DELETE .../modules/:moduleId/` - Delete

### 7.2 Module Issues

- [ ] `GET .../modules/:moduleId/issues/` - List issues
- [ ] `POST .../modules/:moduleId/issues/` - Add issues
- [ ] `DELETE .../modules/:moduleId/issues/:issueId/` - Remove

### 7.3 Module Members

- [ ] `GET .../modules/:moduleId/members/` - List members
- [ ] `POST .../modules/:moduleId/members/` - Add member
- [ ] `DELETE .../modules/:moduleId/members/:memberId/` - Remove

### 7.4 Module Archive

- [ ] `GET .../archived-modules/` - List archived
- [ ] `POST .../modules/:moduleId/archive/` - Archive
- [ ] `POST .../modules/:moduleId/unarchive/` - Unarchive

---

## Phase 8: Page Endpoints

### 8.1 Page CRUD

- [ ] `GET /api/workspaces/:slug/projects/:projectId/pages/` - List pages
- [ ] `POST /api/workspaces/:slug/projects/:projectId/pages/` - Create
- [ ] `GET .../pages/:pageId/` - Get page
- [ ] `PATCH .../pages/:pageId/` - Update page
- [ ] `DELETE .../pages/:pageId/` - Delete page

### 8.2 Page Versions

- [ ] `GET .../pages/:pageId/versions/` - List versions
- [ ] `GET .../pages/:pageId/versions/:versionId/` - Get version
- [ ] `POST .../pages/:pageId/versions/:versionId/restore/` - Restore

### 8.3 Page Access

- [ ] `GET .../pages/:pageId/access/` - Get access settings
- [ ] `PATCH .../pages/:pageId/access/` - Update access

### 8.4 Page Favorites

- [ ] `GET .../favorite-pages/` - List favorites
- [ ] `POST .../pages/:pageId/favorite/` - Add to favorites
- [ ] `DELETE .../pages/:pageId/favorite/` - Remove from favorites

### 8.5 Page Archive

- [ ] `POST .../pages/:pageId/archive/` - Archive
- [ ] `POST .../pages/:pageId/unarchive/` - Unarchive

---

## Phase 9: View Endpoints

### 9.1 View CRUD

- [ ] `GET /api/workspaces/:slug/views/` - Workspace views
- [ ] `GET /api/workspaces/:slug/projects/:projectId/views/` - Project views
- [ ] `POST /api/workspaces/:slug/projects/:projectId/views/` - Create
- [ ] `GET .../views/:viewId/` - Get view
- [ ] `PATCH .../views/:viewId/` - Update view
- [ ] `DELETE .../views/:viewId/` - Delete view

---

## Phase 10: Asset & File Endpoints

### 10.1 File Upload

- [ ] `POST /api/assets/v2/user-assets/` - User file upload
- [ ] `POST /api/assets/v2/workspaces/:slug/` - Workspace upload
- [ ] `POST /api/assets/v2/workspaces/:slug/projects/:projectId/` - Project upload
- [ ] Support `multipart/form-data`
- [ ] Support upload progress tracking
- [ ] Support upload cancellation

### 10.2 Issue Attachments

- [ ] `POST .../issues/:issueId/attachments/` - Upload to issue
- [ ] `GET .../issues/:issueId/attachments/` - List attachments
- [ ] `DELETE .../issues/:issueId/attachments/:id/` - Delete

### 10.3 Signed URLs

- [ ] Generate signed URLs for S3/storage access
- [ ] Handle file download redirects

---

## Phase 11: Search & Navigation

### 11.1 Search Endpoints

- [ ] `GET /api/workspaces/:slug/search/` - Workspace search
- [ ] `GET /api/workspaces/:slug/entity-search/` - Entity search
- [ ] `GET .../projects/:projectId/search-issues/` - Issue search

---

## Phase 12: Notifications

### 12.1 Notification Endpoints

- [ ] `GET /api/workspaces/:slug/users/notifications/` - List notifications
- [ ] `GET .../notifications/:notificationId/` - Get notification
- [ ] `POST .../notifications/:notificationId/read/` - Mark as read
- [ ] `POST .../notifications/mark-all-read/` - Mark all read
- [ ] `POST .../notifications/:notificationId/archive/` - Archive
- [ ] `POST .../notifications/:notificationId/snooze/` - Snooze

---

## Phase 13: Dashboard & Analytics

### 13.1 Dashboard Endpoints

- [ ] `GET /api/workspaces/:slug/dashboard/` - Get dashboard
- [ ] `GET /api/dashboard/:dashboardId/` - Dashboard details
- [ ] `PATCH /api/dashboard/:dashboardId/widgets/:widgetId/` - Update widget

### 13.2 Analytics Endpoints

- [ ] `GET /api/workspaces/:slug/analytics/` - Workspace analytics
- [ ] Issue distribution by state
- [ ] Issue distribution by assignee
- [ ] Burndown chart data

---

## Phase 14: Integrations

### 14.1 Integration Endpoints

- [ ] `GET /api/integrations/` - Available integrations
- [ ] `GET /api/workspaces/:slug/workspace-integrations/` - Installed
- [ ] `POST /api/workspaces/:slug/workspace-integrations/` - Install
- [ ] `DELETE /api/workspaces/:slug/workspace-integrations/:id/` - Uninstall

### 14.2 Import/Export

- [ ] `GET /api/workspaces/:slug/importers/` - List importers
- [ ] `POST /api/workspaces/:slug/importers/` - Start import
- [ ] `GET /api/workspaces/:slug/export-issues/` - Export issues

---

## Phase 15: Webhooks

### 15.1 Webhook Endpoints

- [ ] `GET /api/workspaces/:slug/webhooks/` - List webhooks
- [ ] `POST /api/workspaces/:slug/webhooks/` - Create webhook
- [ ] `GET /api/workspaces/:slug/webhooks/:webhookId/` - Get webhook
- [ ] `PATCH /api/workspaces/:slug/webhooks/:webhookId/` - Update
- [ ] `DELETE /api/workspaces/:slug/webhooks/:webhookId/` - Delete

---

## Phase 16: Other Endpoints

### 16.1 Favorites

- [ ] `GET /api/workspaces/:slug/user-favorites/` - List all favorites
- [ ] `POST /api/workspaces/:slug/user-favorites/` - Add favorite
- [ ] `DELETE /api/workspaces/:slug/user-favorites/:id/` - Remove

### 16.2 Quick Links

- [ ] `GET /api/workspaces/:slug/quick-links/` - List quick links
- [ ] `POST /api/workspaces/:slug/quick-links/` - Create
- [ ] `DELETE /api/workspaces/:slug/quick-links/:id/` - Delete

### 16.3 Stickies

- [ ] `GET /api/workspaces/:slug/stickies/` - List stickies
- [ ] `POST /api/workspaces/:slug/stickies/` - Create
- [ ] `PATCH /api/workspaces/:slug/stickies/:id/` - Update
- [ ] `DELETE /api/workspaces/:slug/stickies/:id/` - Delete

### 16.4 AI Assistant

- [ ] `POST /api/workspaces/:slug/ai-assistant/` - AI query
- [ ] `POST /api/workspaces/:slug/rephrase-grammar/` - Text processing

### 16.5 Timezone

- [ ] `GET /api/timezones/` - List timezones

---

## Phase 17: Realtime / WebSocket

### 17.1 WebSocket Server

- [ ] Set up Bun native WebSocket server
- [ ] Implement topic-based pub/sub
- [ ] Authentication for WebSocket connections

### 17.2 Page Collaboration Events

> Used by `use-realtime-page-events.tsx`

- [ ] `archived` - Page archived
- [ ] `unarchived` - Page restored
- [ ] `locked` - Page locked
- [ ] `unlocked` - Page unlocked
- [ ] `made-public` - Access changed

### 17.3 Issue Events

- [ ] `issue:created` - New issue
- [ ] `issue:updated` - Issue changed
- [ ] `issue:deleted` - Issue removed
- [ ] `issues:bulk_updated` - Bulk changes

### 17.4 Other Events

- [ ] `comment:created` - New comment
- [ ] `notification:created` - New notification
- [ ] `member:added` - Member joined
- [ ] `member:removed` - Member left

---

## Phase 18: Background Jobs

### 18.1 Job Queue Setup

- [ ] Create SQLite-backed job queue
- [ ] Implement job worker with retry logic
- [ ] Set up scheduled jobs (cron)

### 18.2 Job Types

- [ ] Email notifications
- [ ] Webhook delivery
- [ ] Issue activity tracking
- [ ] Cycle progress snapshots
- [ ] Session cleanup
- [ ] API log cleanup
- [ ] File asset cleanup

---

## Phase 19: Response Format Compatibility

### 19.1 Response Structure

> Frontend expects specific response formats

- [ ] Match DRF pagination format:
  ```json
  {
    "count": 100,
    "next": "...",
    "previous": "...",
    "results": [],
    "total_pages": 5,
    "current_page": 1
  }
  ```
- [ ] Match error response format:
  ```json
  {
    "detail": "Error message",
    "code": "error_code"
  }
  ```
- [ ] All responses return `data` field or direct object

### 19.2 Field Name Compatibility

- [ ] Use `snake_case` for all field names (match Django)
- [ ] Match all field names from `@plane/types`
- [ ] Include `_detail` fields where frontend expects them

---

## Phase 20: Data Migration

### 20.1 Migration Scripts

- [ ] Create PostgreSQL → SQLite migration script
- [ ] Migrate users (map to Better Auth schema)
- [ ] Migrate workspaces
- [ ] Migrate projects
- [ ] Migrate issues (with all relations)
- [ ] Migrate cycles
- [ ] Migrate modules
- [ ] Migrate pages
- [ ] Migrate notifications
- [ ] Migrate file assets metadata

### 20.2 Validation

- [ ] Count validation (PostgreSQL vs SQLite)
- [ ] Foreign key integrity checks
- [ ] Data completeness verification

---

## Phase 21: Testing

### 21.1 Unit Tests

- [ ] Service layer tests
- [ ] Utility function tests
- [ ] Validation schema tests

### 21.2 Integration Tests

- [ ] Auth flow tests
- [ ] CRUD operation tests for each entity
- [ ] Permission tests
- [ ] Pagination tests

### 21.3 E2E Tests

- [ ] Full issue workflow
- [ ] Full cycle workflow
- [ ] File upload workflow
- [ ] OAuth flow

### 21.4 Frontend Compatibility Tests

- [ ] Run existing frontend against new backend
- [ ] Verify all pages load correctly
- [ ] Verify all forms submit correctly
- [ ] Verify all filters work

---

## Phase 22: Deployment & Cutover

### 22.1 Pre-Cutover

- [ ] Deploy Bun API (not receiving traffic)
- [ ] Final data sync
- [ ] Run validation scripts
- [ ] Test against staging frontend

### 22.2 Cutover

- [ ] Enable maintenance mode
- [ ] Update `vite.config.ts` with new API URL
- [ ] Build and deploy frontend
- [ ] Start Bun workers
- [ ] Smoke test
- [ ] Disable maintenance mode

### 22.3 Post-Cutover

- [ ] Monitor error rates
- [ ] Monitor latency
- [ ] Verify WebSocket connections
- [ ] Verify background jobs

---

## Summary Stats

| Phase                     | Tasks    | Critical |
| ------------------------- | -------- | -------- |
| Phase 0: Foundation       | 40       | Yes      |
| Phase 1: Auth             | 25       | Yes      |
| Phase 2: Users            | 15       | Yes      |
| Phase 3: Workspaces       | 20       | Yes      |
| Phase 4: Projects         | 25       | Yes      |
| Phase 5: Issues           | 45       | Yes      |
| Phase 6: Cycles           | 15       | Yes      |
| Phase 7: Modules          | 15       | Yes      |
| Phase 8: Pages            | 15       | Yes      |
| Phase 9: Views            | 6        | Yes      |
| Phase 10: Assets          | 10       | Yes      |
| Phase 11: Search          | 3        | Medium   |
| Phase 12: Notifications   | 6        | Medium   |
| Phase 13: Dashboard       | 5        | Medium   |
| Phase 14: Integrations    | 6        | Low      |
| Phase 15: Webhooks        | 5        | Low      |
| Phase 16: Other           | 15       | Low      |
| Phase 17: Realtime        | 15       | Medium   |
| Phase 18: Background Jobs | 10       | Medium   |
| Phase 19: Response Format | 5        | Yes      |
| Phase 20: Data Migration  | 12       | Yes      |
| Phase 21: Testing         | 15       | Yes      |
| Phase 22: Deployment      | 10       | Yes      |
| **Total**                 | **~340** |          |

---

_Last updated: 2025-01-28_

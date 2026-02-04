# Web Components Migration Plan: Django to Bun Server

> **Objective:** Migrate CE (Community Edition) web components/views to the Bun server with full feature parity.

## Migration Requirements

- ✅ Remove Sentry integration
- ✅ Remove Vite (Bun handles bundling/serving)
- ✅ Remove MobX (use TanStack Query + Zustand)
- ✅ Remove SWR (use TanStack Query)
- ✅ Relative API calls (same origin)
- ✅ Open source only (exclude `/ee/` folder from original `web/`)
- ✅ Full feature parity with existing web app

## ⚠️ Important: Preservation Policy

**Old files in the `web` folder should be left intact and NOT deleted during migration.**

This allows for:
- **Parallel development**: Both old and new implementations can coexist
- **Safe rollback**: Easy to revert if issues arise
- **Incremental adoption**: Migrate one feature at a time without breaking others
- **Reference code**: Original implementations remain available for comparison

Migration should be **additive** — create new files in `apps/web-next/` rather than modifying or deleting files in `apps/web/`.

---

## Project Structure

The migration uses a **separate source, unified serve** architecture:

```
apps/
├── web/              # Original frontend (PRESERVED - do not modify)
│   ├── app/          # React Router routes
│   ├── core/         # Core components & services
│   └── ...
│
├── web-next/         # NEW: Migrated frontend (TanStack Query + Zustand)
│   ├── app/          # React Router routes (migrated)
│   ├── core/         # All components, hooks, stores
│   │   ├── components/    # All UI components
│   │   ├── hooks/
│   │   │   └── queries/   # TanStack Query hooks
│   │   ├── store/         # Zustand stores (UI state only)
│   │   └── lib/           # API client, utilities
│   └── package.json
│
└── app/              # Bun server
    ├── src/          # API routes (Hono), auth (Better Auth), DB (Drizzle)
    └── dist/
        └── web/      # Built frontend assets (served statically)
```

### Why This Structure?

| Benefit | Description |
|---------|-------------|
| **Clear separation** | Frontend (`web-next/`) and backend (`app/`) are distinct packages |
| **Preservation** | Original `web/` remains untouched for reference and rollback |
| **Independent iteration** | Can develop frontend without touching server code |
| **Single deployment** | Bun serves both API and static files from one process |
| **Shared types** | Both packages can import from `@plane/types` |

---

## Architecture Changes

### Before (Current Stack)
```
┌─────────────────────────────────────────────────────────┐
│                   apps/web (Frontend)                   │
├─────────────────────────────────────────────────────────┤
│  Vite (bundler/dev server)                             │
│  React Router v7                                        │
│  MobX (state management)                               │
│  SWR (data fetching)                                   │
│  Sentry (error tracking)                               │
│  axios → VITE_API_BASE_URL (absolute)                  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Django API                           │
└─────────────────────────────────────────────────────────┘
```

### After (New Stack)
```
┌─────────────────────────────────────────────────────────┐
│                 apps/app (Bun Server)                   │
├─────────────────────────────────────────────────────────┤
│  Static file serving (from dist/web/)                  │
│  API routes (Hono)                                      │
│  Better Auth                                            │
│  Drizzle ORM + SQLite                                  │
└─────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│   apps/web (PRESERVED)   │  │  apps/web-next (NEW)     │
├──────────────────────────┤  ├──────────────────────────┤
│  Original implementation │  │  Bun (bundler)           │
│  Reference & rollback    │  │  React Router v7         │
│  Do not modify           │  │  TanStack Query          │
│                          │  │  Zustand (UI state)      │
│                          │  │  fetch → /api/*          │
└──────────────────────────┘  └──────────────────────────┘
                                         │
                                         ▼
                              ┌──────────────────────────┐
                              │  apps/app/dist/web/      │
                              │  (Built static assets)   │
                              └──────────────────────────┘
```

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Pre-Migration Setup](#1-pre-migration-setup)
3. [Route Migration Overview](#2-route-migration-overview)
4. [Phase 1: Authentication Routes](#phase-1-authentication-routes)
5. [Phase 2: Workspace Routes](#phase-2-workspace-routes)
6. [Phase 3: Project Routes](#phase-3-project-routes)
7. [Phase 4: Issue Management Routes](#phase-4-issue-management-routes)
8. [Phase 5: Cycles & Modules Routes](#phase-5-cycles--modules-routes)
9. [Phase 6: Pages Routes](#phase-6-pages-routes)
10. [Phase 7: Analytics & Views Routes](#phase-7-analytics--views-routes)
11. [Phase 8: Settings Routes](#phase-8-settings-routes)
12. [Phase 9: Profile Routes](#phase-9-profile-routes)
13. [Dependency Removal Guide](#dependency-removal-guide)
14. [State Management Migration](#state-management-migration)
15. [API Client Migration](#api-client-migration)
16. [Testing Checklist](#testing-checklist)

---

## 1. Pre-Migration Setup

### 1.1 Create the `web-next` Package

```bash
# Create the new frontend package
mkdir -p apps/web-next
cd apps/web-next

# Initialize package.json
cat > package.json << 'EOF'
{
  "name": "@plane/web-next",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch app/entry.tsx",
    "build": "bun build app/entry.tsx --outdir=../app/dist/web --minify --splitting",
    "typecheck": "tsc --noEmit"
  }
}
EOF

# Install dependencies
bun add react react-dom react-router @tanstack/react-query @tanstack/react-query-devtools zustand
bun add -d typescript @types/react @types/react-dom
```

### 1.2 Create Initial Directory Structure

```bash
cd apps/web-next

mkdir -p app
mkdir -p core/components
mkdir -p core/hooks/queries
mkdir -p core/store/ui
mkdir -p core/lib
```

### 1.3 Files to Exclude from Migration

> **Note:** Do NOT delete or modify files in `apps/web/`. The following files/patterns should be **excluded** when copying to `apps/web-next/`:

```
# Vite config (not needed - Bun handles bundling)
vite.config.ts

# Sentry entry (not needed - Sentry removed)
app/entry.client.tsx

# MobX stores (replaced by TanStack Query + Zustand)
core/store/

# Environment-specific configs
.env*
```

These files remain in `apps/web/` for reference and rollback purposes.

### 1.4 Environment Variables

The `apps/web-next/` package does NOT need environment variables for API URLs since all API calls are relative (`/api/*`).

No Sentry-related variables are needed.

### 1.5 Configure Bun Server for Frontend Build

Update `apps/app/package.json`:
```json
{
  "scripts": {
    "build:web": "cd ../web-next && bun run build",
    "dev": "bun --watch src/index.ts",
    "dev:all": "concurrently \"bun run dev\" \"cd ../web-next && bun run dev\"",
    "start": "bun src/index.ts"
  }
}
```

### 1.6 Serve Static Files from Bun

Update `apps/app/src/app.ts`:
```typescript
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';

const app = new Hono();

// API routes (must come first)
app.route('/api', apiRoutes);

// Static assets (JS, CSS, images with hashed filenames)
app.use('/assets/*', serveStatic({ root: './dist/web' }));

// Favicon and other root static files
app.use('/favicon.ico', serveStatic({ path: './dist/web/favicon.ico' }));

// SPA fallback - all other routes serve index.html
app.get('*', serveStatic({ path: './dist/web/index.html' }));

export default app;
```

### 1.7 Create Entry Point for `web-next`

Create `apps/web-next/app/entry.tsx`:
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { App } from './app';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,    // 5 minutes
      gcTime: 1000 * 60 * 30,       // 30 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>
);
```

---

## 2. Route Migration Overview

| Phase | Route Pattern | Priority | Complexity | Status |
|-------|--------------|----------|------------|--------|
| 1 | `/`, `/sign-up`, `/accounts/*` | High | Low | ⬜ |
| 2 | `/:workspaceSlug/*` (base) | High | Medium | ⬜ |
| 3 | `/:workspaceSlug/projects/*` | High | Medium | ⬜ |
| 4 | `/:workspaceSlug/projects/:projectId/issues/*` | High | High | ⬜ |
| 5 | `/:workspaceSlug/projects/:projectId/cycles/*`, `/modules/*` | Medium | Medium | ⬜ |
| 6 | `/:workspaceSlug/projects/:projectId/pages/*` | Medium | Medium | ⬜ |
| 7 | `/:workspaceSlug/analytics/*`, `/views/*` | Medium | Medium | ⬜ |
| 8 | `/:workspaceSlug/settings/*` | Low | Low | ⬜ |
| 9 | `/profile/*` | Low | Low | ⬜ |

---

## Phase 1: Authentication Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/` (Home/Sign-in) | `app/(home)/page.tsx` | `core/components/account/` |
| `/sign-up` | `app/(all)/sign-up/page.tsx` | `core/components/account/` |
| `/accounts/forgot-password` | `app/(all)/accounts/forgot-password/page.tsx` | `core/components/account/` |
| `/accounts/set-password` | `app/(all)/accounts/set-password/page.tsx` | `core/components/account/` |
| `/accounts/reset-password` | `app/(all)/accounts/reset-password/page.tsx` | `core/components/account/` |
| `/onboarding` | `app/(all)/onboarding/page.tsx` | `core/components/onboarding/` |

### Components to Migrate

```
core/components/account/
├── auth-forms/
│   ├── auth-root.tsx
│   ├── email.tsx
│   ├── password.tsx
│   ├── unique-code.tsx
│   └── index.ts
├── sign-in-forms/
├── sign-up-forms/
└── password-forms/

core/components/onboarding/
├── create-workspace/
├── invite-members/
├── profile-setup/
└── index.ts
```

### TanStack Query Hooks to Create

```typescript
// apps/web-next/core/hooks/queries/use-auth.ts
export const useCurrentUserQuery = () => {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: () => fetch('/api/users/me').then(res => res.json()),
  });
};

export const useSignInMutation = () => {
  return useMutation({
    mutationFn: (credentials: SignInData) =>
      fetch('/api/auth/sign-in', {
        method: 'POST',
        body: JSON.stringify(credentials),
      }).then(res => res.json()),
  });
};

export const useSignUpMutation = () => {
  return useMutation({
    mutationFn: (data: SignUpData) =>
      fetch('/api/auth/sign-up', {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
  });
};
```

### Migration Steps

1. [ ] Remove Sentry from `app/root.tsx`
2. [ ] Create TanStack Query provider in `app/provider.tsx`
3. [ ] Create auth query/mutation hooks
4. [ ] Update auth forms to use TanStack Query mutations
5. [ ] Update Better Auth integration in Bun server
6. [ ] Test sign-in flow
7. [ ] Test sign-up flow
8. [ ] Test password reset flow
9. [ ] Test onboarding flow

---

## Phase 2: Workspace Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/create-workspace` | `app/(all)/create-workspace/page.tsx` | `core/components/workspace/` |
| `/:workspaceSlug` | `app/(all)/[workspaceSlug]/page.tsx` | `core/components/home/` |
| `/invitations` | `app/(all)/invitations/page.tsx` | `core/components/invitations/` |
| `/workspace-invitations/:invitationId` | `app/(all)/workspace-invitations/page.tsx` | `core/components/invitations/` |

### Components to Migrate

```
core/components/workspace/
├── create/
├── settings/
├── views/
├── sidebar/
└── index.ts

core/components/home/
├── root.tsx
├── widgets/
│   ├── assigned-issues/
│   ├── created-issues/
│   ├── recent-activity/
│   ├── recent-projects/
│   └── quick-links/
└── index.ts

core/components/sidebar/
├── workspace-menu.tsx
├── project-list.tsx
├── favorites.tsx
└── index.ts

core/components/app-rail/
├── app-rail.tsx
├── app-rail-item.tsx
└── index.ts
```

### MobX → Zustand Store Migration

**Before (MobX in `apps/web/`):**
```typescript
// apps/web/core/store/workspace/workspace.store.ts
class WorkspaceStore {
  workspaces: IWorkspace[] = [];
  currentWorkspace: IWorkspace | null = null;

  constructor() {
    makeObservable(this, {
      workspaces: observable,
      currentWorkspace: observable,
      setWorkspaces: action,
    });
  }
}
```

**After (Zustand - UI state only):**
```typescript
// apps/web-next/core/store/workspace-ui.store.ts
import { create } from 'zustand';

interface WorkspaceUIState {
  sidebarCollapsed: boolean;
  activeSidebarTab: string;
  toggleSidebar: () => void;
  setActiveSidebarTab: (tab: string) => void;
}

export const useWorkspaceUIStore = create<WorkspaceUIState>((set) => ({
  sidebarCollapsed: false,
  activeSidebarTab: 'projects',
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
}));
```

### TanStack Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-workspaces.ts
export const useWorkspacesQuery = () => {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => fetch('/api/workspaces').then(res => res.json()),
  });
};

export const useWorkspaceQuery = (slug: string) => {
  return useQuery({
    queryKey: ['workspace', slug],
    queryFn: () => fetch(`/api/workspaces/${slug}`).then(res => res.json()),
    enabled: !!slug,
  });
};

export const useWorkspaceMembersQuery = (slug: string) => {
  return useQuery({
    queryKey: ['workspace', slug, 'members'],
    queryFn: () => fetch(`/api/workspaces/${slug}/members`).then(res => res.json()),
    enabled: !!slug,
  });
};

export const useCreateWorkspaceMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateWorkspaceData) =>
      fetch('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
};
```

### Migration Steps

1. [ ] Create Zustand store for workspace UI state
2. [ ] Create workspace query hooks
3. [ ] Remove MobX workspace stores
4. [ ] Migrate workspace components to use hooks
5. [ ] Migrate home dashboard widgets
6. [ ] Migrate sidebar components
7. [ ] Migrate app rail components
8. [ ] Test workspace creation
9. [ ] Test workspace switching
10. [ ] Test invitation acceptance

---

## Phase 3: Project Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/:workspaceSlug/projects` | `app/(all)/[workspaceSlug]/projects/page.tsx` | `core/components/projects/` |
| `/:workspaceSlug/projects/:projectId` | `app/(all)/[workspaceSlug]/projects/[projectId]/page.tsx` | `core/components/projects/` |
| `/:workspaceSlug/projects/:projectId/settings/*` | `app/(all)/[workspaceSlug]/projects/[projectId]/settings/` | `core/components/projects/settings/` |

### Components to Migrate

```
core/components/projects/
├── card/
│   ├── project-card.tsx
│   ├── project-card-list.tsx
│   └── index.ts
├── create/
│   ├── create-project-modal.tsx
│   ├── create-project-form.tsx
│   └── index.ts
├── delete/
├── archive/
├── leave/
├── publish/
├── settings/
│   ├── general.tsx
│   ├── members.tsx
│   ├── features.tsx
│   ├── states.tsx
│   ├── labels.tsx
│   ├── estimates.tsx
│   └── index.ts
└── index.ts
```

### TanStack Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-projects.ts
export const useProjectsQuery = (workspaceSlug: string) => {
  return useQuery({
    queryKey: ['projects', workspaceSlug],
    queryFn: () => fetch(`/api/workspaces/${workspaceSlug}/projects`).then(res => res.json()),
    enabled: !!workspaceSlug,
  });
};

export const useProjectQuery = (workspaceSlug: string, projectId: string) => {
  return useQuery({
    queryKey: ['project', workspaceSlug, projectId],
    queryFn: () => fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}`).then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const useProjectStatesQuery = (workspaceSlug: string, projectId: string) => {
  return useQuery({
    queryKey: ['project', workspaceSlug, projectId, 'states'],
    queryFn: () => fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/states`).then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const useProjectLabelsQuery = (workspaceSlug: string, projectId: string) => {
  return useQuery({
    queryKey: ['project', workspaceSlug, projectId, 'labels'],
    queryFn: () => fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/labels`).then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const useProjectMembersQuery = (workspaceSlug: string, projectId: string) => {
  return useQuery({
    queryKey: ['project', workspaceSlug, projectId, 'members'],
    queryFn: () => fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/members`).then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const useCreateProjectMutation = (workspaceSlug: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects`, {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceSlug] });
    },
  });
};

export const useUpdateProjectMutation = (workspaceSlug: string, projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateProjectData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', workspaceSlug, projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceSlug] });
    },
  });
};

export const useDeleteProjectMutation = (workspaceSlug: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', workspaceSlug] });
    },
  });
};
```

### Zustand Store (UI only)

```typescript
// apps/web-next/core/store/project-ui.store.ts
import { create } from 'zustand';

interface ProjectUIState {
  createModalOpen: boolean;
  deleteModalOpen: boolean;
  selectedProjectId: string | null;
  openCreateModal: () => void;
  closeCreateModal: () => void;
  openDeleteModal: (projectId: string) => void;
  closeDeleteModal: () => void;
}

export const useProjectUIStore = create<ProjectUIState>((set) => ({
  createModalOpen: false,
  deleteModalOpen: false,
  selectedProjectId: null,
  openCreateModal: () => set({ createModalOpen: true }),
  closeCreateModal: () => set({ createModalOpen: false }),
  openDeleteModal: (projectId) => set({ deleteModalOpen: true, selectedProjectId: projectId }),
  closeDeleteModal: () => set({ deleteModalOpen: false, selectedProjectId: null }),
}));
```

### Migration Steps

1. [ ] Create project query hooks
2. [ ] Create project UI Zustand store
3. [ ] Remove MobX project stores
4. [ ] Migrate project list components
5. [ ] Migrate project card components
6. [ ] Migrate project creation modal
7. [ ] Migrate project settings components
8. [ ] Test project CRUD operations
9. [ ] Test project member management
10. [ ] Test project state management

---

## Phase 4: Issue Management Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/:workspaceSlug/projects/:projectId/issues` | `app/(all)/[workspaceSlug]/projects/[projectId]/issues/page.tsx` | `core/components/issues/` |
| `/:workspaceSlug/projects/:projectId/issues/:issueId` | `app/(all)/[workspaceSlug]/projects/[projectId]/issues/[issueId]/page.tsx` | `core/components/issues/` |
| `/:workspaceSlug/projects/:projectId/inbox` | `app/(all)/[workspaceSlug]/projects/[projectId]/inbox/page.tsx` | `core/components/inbox/` |
| `/:workspaceSlug/projects/:projectId/archives/issues` | `app/(all)/[workspaceSlug]/projects/[projectId]/archives/issues/page.tsx` | `core/components/issues/` |
| `/:workspaceSlug/projects/:projectId/draft-issues` | `app/(all)/[workspaceSlug]/projects/[projectId]/draft-issues/page.tsx` | `core/components/issues/` |

### Components to Migrate

```
core/components/issues/
├── issue-layouts/
│   ├── list/
│   ├── kanban/
│   ├── calendar/
│   ├── spreadsheet/
│   ├── gantt/
│   └── index.ts
├── issue-detail/
│   ├── root.tsx
│   ├── header.tsx
│   ├── sidebar.tsx
│   ├── main-content.tsx
│   ├── activity/
│   ├── sub-issues/
│   ├── relations/
│   └── index.ts
├── issue-modal/
├── peek-overview/
├── bulk-operations/
├── filters/
└── index.ts

core/components/inbox/
├── inbox-root.tsx
├── inbox-list.tsx
├── inbox-item.tsx
├── inbox-filters.tsx
└── index.ts
```

### TanStack Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-issues.ts
export const useIssuesQuery = (
  workspaceSlug: string,
  projectId: string,
  filters?: IssueFilters
) => {
  return useQuery({
    queryKey: ['issues', workspaceSlug, projectId, filters],
    queryFn: () => {
      const params = new URLSearchParams(filters as Record<string, string>);
      return fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues?${params}`)
        .then(res => res.json());
    },
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const useIssueQuery = (
  workspaceSlug: string,
  projectId: string,
  issueId: string
) => {
  return useQuery({
    queryKey: ['issue', workspaceSlug, projectId, issueId],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}`)
        .then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId && !!issueId,
  });
};

export const useIssueCommentsQuery = (
  workspaceSlug: string,
  projectId: string,
  issueId: string
) => {
  return useQuery({
    queryKey: ['issue', issueId, 'comments'],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/comments`)
        .then(res => res.json()),
    enabled: !!issueId,
  });
};

export const useIssueActivitiesQuery = (
  workspaceSlug: string,
  projectId: string,
  issueId: string
) => {
  return useQuery({
    queryKey: ['issue', issueId, 'activities'],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/activities`)
        .then(res => res.json()),
    enabled: !!issueId,
  });
};

export const useCreateIssueMutation = (workspaceSlug: string, projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateIssueData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues`, {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', workspaceSlug, projectId] });
    },
  });
};

export const useUpdateIssueMutation = (
  workspaceSlug: string,
  projectId: string,
  issueId: string
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateIssueData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    // Optimistic update
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ['issue', workspaceSlug, projectId, issueId] });
      const previousIssue = queryClient.getQueryData(['issue', workspaceSlug, projectId, issueId]);
      queryClient.setQueryData(
        ['issue', workspaceSlug, projectId, issueId],
        (old: Issue) => ({ ...old, ...newData })
      );
      return { previousIssue };
    },
    onError: (err, newData, context) => {
      queryClient.setQueryData(
        ['issue', workspaceSlug, projectId, issueId],
        context?.previousIssue
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', workspaceSlug, projectId, issueId] });
      queryClient.invalidateQueries({ queryKey: ['issues', workspaceSlug, projectId] });
    },
  });
};

export const useBulkUpdateIssuesMutation = (workspaceSlug: string, projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { issueIds: string[]; updates: Partial<Issue> }) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/bulk`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', workspaceSlug, projectId] });
    },
  });
};
```

### Zustand Store (UI only)

```typescript
// apps/web-next/core/store/issue-ui.store.ts
import { create } from 'zustand';

type IssueLayout = 'list' | 'kanban' | 'calendar' | 'spreadsheet' | 'gantt';

interface IssueUIState {
  // Layout
  currentLayout: IssueLayout;
  setLayout: (layout: IssueLayout) => void;

  // Filters
  filtersOpen: boolean;
  toggleFilters: () => void;

  // Issue detail/peek
  peekIssueId: string | null;
  openPeek: (issueId: string) => void;
  closePeek: () => void;

  // Create modal
  createModalOpen: boolean;
  openCreateModal: () => void;
  closeCreateModal: () => void;

  // Bulk selection
  selectedIssueIds: Set<string>;
  toggleIssueSelection: (issueId: string) => void;
  selectAllIssues: (issueIds: string[]) => void;
  clearSelection: () => void;
}

export const useIssueUIStore = create<IssueUIState>((set) => ({
  currentLayout: 'list',
  setLayout: (layout) => set({ currentLayout: layout }),

  filtersOpen: false,
  toggleFilters: () => set((state) => ({ filtersOpen: !state.filtersOpen })),

  peekIssueId: null,
  openPeek: (issueId) => set({ peekIssueId: issueId }),
  closePeek: () => set({ peekIssueId: null }),

  createModalOpen: false,
  openCreateModal: () => set({ createModalOpen: true }),
  closeCreateModal: () => set({ createModalOpen: false }),

  selectedIssueIds: new Set(),
  toggleIssueSelection: (issueId) => set((state) => {
    const newSet = new Set(state.selectedIssueIds);
    if (newSet.has(issueId)) {
      newSet.delete(issueId);
    } else {
      newSet.add(issueId);
    }
    return { selectedIssueIds: newSet };
  }),
  selectAllIssues: (issueIds) => set({ selectedIssueIds: new Set(issueIds) }),
  clearSelection: () => set({ selectedIssueIds: new Set() }),
}));
```

### Migration Steps

1. [ ] Create issue query hooks
2. [ ] Create issue UI Zustand store
3. [ ] Remove MobX issue stores
4. [ ] Migrate list view components
5. [ ] Migrate kanban view components
6. [ ] Migrate calendar view components
7. [ ] Migrate spreadsheet view components
8. [ ] Migrate gantt view components (CE version)
9. [ ] Migrate issue detail/peek overview
10. [ ] Migrate issue modal/form
11. [ ] Migrate bulk operations
12. [ ] Migrate filters
13. [ ] Migrate inbox components
14. [ ] Test issue CRUD operations
15. [ ] Test all view layouts
16. [ ] Test bulk operations
17. [ ] Test inbox workflow

---

## Phase 5: Cycles & Modules Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/:workspaceSlug/projects/:projectId/cycles` | `app/(all)/[workspaceSlug]/projects/[projectId]/cycles/page.tsx` | `core/components/cycles/` |
| `/:workspaceSlug/projects/:projectId/cycles/:cycleId` | `app/(all)/[workspaceSlug]/projects/[projectId]/cycles/[cycleId]/page.tsx` | `core/components/cycles/` |
| `/:workspaceSlug/projects/:projectId/modules` | `app/(all)/[workspaceSlug]/projects/[projectId]/modules/page.tsx` | `core/components/modules/` |
| `/:workspaceSlug/projects/:projectId/modules/:moduleId` | `app/(all)/[workspaceSlug]/projects/[projectId]/modules/[moduleId]/page.tsx` | `core/components/modules/` |
| `/:workspaceSlug/active-cycles` | `app/(all)/[workspaceSlug]/active-cycles/page.tsx` | `core/components/active-cycles/` |

### Components to Migrate

```
core/components/cycles/
├── list/
├── board/
├── gantt/
├── detail/
├── modal/
├── sidebar/
├── transfer-issues/
└── index.ts

core/components/modules/
├── list/
├── board/
├── gantt/
├── detail/
├── modal/
├── sidebar/
└── index.ts

core/components/active-cycles/
├── active-cycle-root.tsx
├── active-cycle-stats.tsx
├── active-cycle-progress.tsx
└── index.ts
```

### TanStack Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-cycles.ts
export const useCyclesQuery = (workspaceSlug: string, projectId: string) => {
  return useQuery({
    queryKey: ['cycles', workspaceSlug, projectId],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/cycles`)
        .then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const useCycleQuery = (workspaceSlug: string, projectId: string, cycleId: string) => {
  return useQuery({
    queryKey: ['cycle', workspaceSlug, projectId, cycleId],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}`)
        .then(res => res.json()),
    enabled: !!cycleId,
  });
};

export const useActiveCyclesQuery = (workspaceSlug: string) => {
  return useQuery({
    queryKey: ['activeCycles', workspaceSlug],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/active-cycles`)
        .then(res => res.json()),
    enabled: !!workspaceSlug,
  });
};

export const useCreateCycleMutation = (workspaceSlug: string, projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCycleData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/cycles`, {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles', workspaceSlug, projectId] });
    },
  });
};

export const useAddIssuesToCycleMutation = (
  workspaceSlug: string,
  projectId: string,
  cycleId: string
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (issueIds: string[]) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/cycles/${cycleId}/issues`, {
        method: 'POST',
        body: JSON.stringify({ issueIds }),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycle', workspaceSlug, projectId, cycleId] });
      queryClient.invalidateQueries({ queryKey: ['issues', workspaceSlug, projectId] });
    },
  });
};

// apps/web-next/core/hooks/queries/use-modules.ts
export const useModulesQuery = (workspaceSlug: string, projectId: string) => {
  return useQuery({
    queryKey: ['modules', workspaceSlug, projectId],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/modules`)
        .then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const useModuleQuery = (workspaceSlug: string, projectId: string, moduleId: string) => {
  return useQuery({
    queryKey: ['module', workspaceSlug, projectId, moduleId],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}`)
        .then(res => res.json()),
    enabled: !!moduleId,
  });
};

export const useCreateModuleMutation = (workspaceSlug: string, projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateModuleData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/modules`, {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules', workspaceSlug, projectId] });
    },
  });
};
```

### Migration Steps

1. [ ] Create cycle query/mutation hooks
2. [ ] Create module query/mutation hooks
3. [ ] Create cycle/module UI Zustand stores
4. [ ] Remove MobX cycle/module stores
5. [ ] Migrate cycle list/board/gantt views
6. [ ] Migrate cycle detail components
7. [ ] Migrate module list/board/gantt views
8. [ ] Migrate module detail components
9. [ ] Migrate active cycles dashboard
10. [ ] Test cycle CRUD operations
11. [ ] Test module CRUD operations
12. [ ] Test adding/removing issues

---

## Phase 6: Pages Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/:workspaceSlug/projects/:projectId/pages` | `app/(all)/[workspaceSlug]/projects/[projectId]/pages/page.tsx` | `core/components/pages/` |
| `/:workspaceSlug/projects/:projectId/pages/:pageId` | `app/(all)/[workspaceSlug]/projects/[projectId]/pages/[pageId]/page.tsx` | `core/components/pages/` |
| `/:workspaceSlug/projects/:projectId/archives/pages` | `app/(all)/[workspaceSlug]/projects/[projectId]/archives/pages/page.tsx` | `core/components/pages/` |

### Components to Migrate

```
core/components/pages/
├── list/
├── editor/
├── modal/
├── detail/
├── loaders/
└── index.ts
```

### TanStack Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-pages.ts
export const usePagesQuery = (workspaceSlug: string, projectId: string) => {
  return useQuery({
    queryKey: ['pages', workspaceSlug, projectId],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/pages`)
        .then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const usePageQuery = (workspaceSlug: string, projectId: string, pageId: string) => {
  return useQuery({
    queryKey: ['page', workspaceSlug, projectId, pageId],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/pages/${pageId}`)
        .then(res => res.json()),
    enabled: !!pageId,
  });
};

export const useCreatePageMutation = (workspaceSlug: string, projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreatePageData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/pages`, {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pages', workspaceSlug, projectId] });
    },
  });
};

export const useUpdatePageMutation = (
  workspaceSlug: string,
  projectId: string,
  pageId: string
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdatePageData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/pages/${pageId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['page', workspaceSlug, projectId, pageId] });
      queryClient.invalidateQueries({ queryKey: ['pages', workspaceSlug, projectId] });
    },
  });
};
```

### Migration Steps

1. [ ] Create page query/mutation hooks
2. [ ] Create page UI Zustand store
3. [ ] Remove MobX page stores
4. [ ] Migrate page list components
5. [ ] Migrate page editor components
6. [ ] Migrate page modal components
7. [ ] Test page CRUD operations
8. [ ] Test page editor

---

## Phase 7: Analytics & Views Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/:workspaceSlug/analytics` | `app/(all)/[workspaceSlug]/analytics/page.tsx` | `core/components/analytics/` |
| `/:workspaceSlug/analytics/:tabId` | `app/(all)/[workspaceSlug]/analytics/[tabId]/page.tsx` | `core/components/analytics/` |
| `/:workspaceSlug/projects/:projectId/views` | `app/(all)/[workspaceSlug]/projects/[projectId]/views/page.tsx` | `core/components/views/` |
| `/:workspaceSlug/projects/:projectId/views/:viewId` | `app/(all)/[workspaceSlug]/projects/[projectId]/views/[viewId]/page.tsx` | `core/components/views/` |

### Components to Migrate

```
core/components/analytics/
├── project-analytics/
├── custom-analytics/
├── insight-table/     # Already uses TanStack Table
├── work-items/
└── index.ts

core/components/views/
├── view-list.tsx
├── view-list-item.tsx
├── view-modal.tsx
├── view-form.tsx
└── index.ts
```

### TanStack Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-analytics.ts
export const useWorkspaceAnalyticsQuery = (workspaceSlug: string, params?: AnalyticsParams) => {
  return useQuery({
    queryKey: ['analytics', workspaceSlug, params],
    queryFn: () => {
      const searchParams = new URLSearchParams(params as Record<string, string>);
      return fetch(`/api/workspaces/${workspaceSlug}/analytics?${searchParams}`)
        .then(res => res.json());
    },
    enabled: !!workspaceSlug,
  });
};

// apps/web-next/core/hooks/queries/use-views.ts
export const useViewsQuery = (workspaceSlug: string, projectId: string) => {
  return useQuery({
    queryKey: ['views', workspaceSlug, projectId],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/views`)
        .then(res => res.json()),
    enabled: !!workspaceSlug && !!projectId,
  });
};

export const useCreateViewMutation = (workspaceSlug: string, projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateViewData) =>
      fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/views`, {
        method: 'POST',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views', workspaceSlug, projectId] });
    },
  });
};
```

### Migration Steps

1. [ ] Create analytics query hooks
2. [ ] Create view query/mutation hooks
3. [ ] Remove MobX analytics/view stores
4. [ ] Migrate analytics components (TanStack Table already in use)
5. [ ] Migrate view components
6. [ ] Test analytics data fetching
7. [ ] Test view CRUD operations

---

## Phase 8: Settings Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/:workspaceSlug/settings` | `app/(all)/[workspaceSlug]/settings/page.tsx` | `core/components/settings/` |
| `/:workspaceSlug/settings/members` | `app/(all)/[workspaceSlug]/settings/members/page.tsx` | `core/components/settings/` |
| `/:workspaceSlug/settings/billing` | `app/(all)/[workspaceSlug]/settings/billing/page.tsx` | `core/components/settings/` |
| `/:workspaceSlug/settings/integrations` | `app/(all)/[workspaceSlug]/settings/integrations/page.tsx` | `core/components/settings/` |
| `/:workspaceSlug/settings/imports` | `app/(all)/[workspaceSlug]/settings/imports/page.tsx` | `core/components/settings/` |
| `/:workspaceSlug/settings/exports` | `app/(all)/[workspaceSlug]/settings/exports/page.tsx` | `core/components/settings/` |
| `/:workspaceSlug/settings/webhooks` | `app/(all)/[workspaceSlug]/settings/webhooks/page.tsx` | `core/components/settings/` |
| `/:workspaceSlug/settings/api-tokens` | `app/(all)/[workspaceSlug]/settings/api-tokens/page.tsx` | `core/components/settings/` |

### TanStack Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-settings.ts
export const useWebhooksQuery = (workspaceSlug: string) => {
  return useQuery({
    queryKey: ['webhooks', workspaceSlug],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/webhooks`)
        .then(res => res.json()),
    enabled: !!workspaceSlug,
  });
};

export const useApiTokensQuery = (workspaceSlug: string) => {
  return useQuery({
    queryKey: ['apiTokens', workspaceSlug],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/api-tokens`)
        .then(res => res.json()),
    enabled: !!workspaceSlug,
  });
};

export const useIntegrationsQuery = (workspaceSlug: string) => {
  return useQuery({
    queryKey: ['integrations', workspaceSlug],
    queryFn: () =>
      fetch(`/api/workspaces/${workspaceSlug}/integrations`)
        .then(res => res.json()),
    enabled: !!workspaceSlug,
  });
};
```

### Migration Steps

1. [ ] Create settings query/mutation hooks
2. [ ] Migrate settings components
3. [ ] Migrate integration components
4. [ ] Migrate webhook components
5. [ ] Migrate API token components
6. [ ] Test all settings operations

---

## Phase 9: Profile Routes

### Routes to Migrate

| Route | File Location | Components |
|-------|--------------|------------|
| `/profile` | `app/(all)/profile/page.tsx` | `core/components/profile/` |
| `/profile/settings` | `app/(all)/profile/settings/page.tsx` | `core/components/profile/` |
| `/profile/activity` | `app/(all)/profile/activity/page.tsx` | `core/components/profile/` |
| `/profile/preferences` | `app/(all)/profile/preferences/page.tsx` | `core/components/profile/` |

### TanStack Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-profile.ts
export const useProfileQuery = () => {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => fetch('/api/users/me').then(res => res.json()),
  });
};

export const useUpdateProfileMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateProfileData) =>
      fetch('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    },
  });
};

export const useUserPreferencesQuery = () => {
  return useQuery({
    queryKey: ['userPreferences'],
    queryFn: () => fetch('/api/users/me/preferences').then(res => res.json()),
  });
};

export const useUpdatePreferencesMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdatePreferencesData) =>
      fetch('/api/users/me/preferences', {
        method: 'PATCH',
        body: JSON.stringify(data),
      }).then(res => res.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userPreferences'] });
    },
  });
};
```

### Migration Steps

1. [ ] Create profile query/mutation hooks
2. [ ] Create preferences Zustand store (theme, display settings)
3. [ ] Migrate profile components
4. [ ] Migrate preferences components
5. [ ] Test profile updates
6. [ ] Test preferences

---

## Dependency Removal Guide

### Remove from `package.json`

```diff
{
  "dependencies": {
-   "@sentry/react-router": "^x.x.x",
-   "mobx": "^6.x.x",
-   "mobx-react": "^x.x.x",
-   "mobx-react-lite": "^x.x.x",
-   "mobx-utils": "^x.x.x",
-   "swr": "^2.x.x",
+   "@tanstack/react-query": "^5.x.x",
+   "@tanstack/react-query-devtools": "^5.x.x",
+   "zustand": "^4.x.x"
  },
  "devDependencies": {
-   "vite": "^5.x.x",
-   "@vitejs/plugin-react": "^x.x.x"
  }
}
```

### Files to Exclude (Do NOT Copy to `web-next/`)

> **Reminder:** Per the preservation policy, do NOT delete files from `apps/web/`. The following files should simply not be copied to `apps/web-next/`:

```
# Vite (not needed in Bun stack)
vite.config.ts

# Sentry (removed from new stack)
app/entry.client.tsx

# MobX stores (replaced by TanStack Query + Zustand)
core/store/

# SWR related (if any dedicated files)
# DO copy service files - they contain reusable API logic
```

These files remain in `apps/web/` as reference implementations.

### New Files in `apps/web-next/`

#### `app/entry.tsx` (new entry point)
```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { App } from './app';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>
);
```

#### `app/root.tsx` (migrated, no Sentry)
```typescript
// No Sentry imports - just standard error handling
import { Outlet } from 'react-router';

export default function Root() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <Outlet />
      </body>
    </html>
  );
}

export function ErrorBoundary({ error }: { error: Error }) {
  console.error("Application error:", error);
  return (
    <div>
      <h1>Something went wrong</h1>
      <pre>{error.message}</pre>
    </div>
  );
}
```

---

## State Management Migration

### Principles

1. **Server State → TanStack Query**
   - All data from API (workspaces, projects, issues, etc.)
   - Caching, refetching, mutations

2. **UI State → Zustand**
   - Modal open/close states
   - Sidebar collapsed state
   - Selected layout (list/kanban/etc.)
   - Theme preferences
   - Selected items for bulk operations

### Zustand Store Structure

```
apps/web-next/core/store/
├── ui/
│   ├── app-ui.store.ts      # Global UI (theme, sidebar)
│   ├── issue-ui.store.ts    # Issue-specific UI
│   ├── project-ui.store.ts  # Project-specific UI
│   └── index.ts
```

### Example: Global UI Store

```typescript
// apps/web-next/core/store/ui/app-ui.store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppUIState {
  theme: 'light' | 'dark' | 'system';
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;

  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleSidebar: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
}

export const useAppUIStore = create<AppUIState>()(
  persist(
    (set) => ({
      theme: 'system',
      sidebarCollapsed: false,
      commandPaletteOpen: false,

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
    }),
    {
      name: 'app-ui-storage',
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed }),
    }
  )
);
```

---

## API Client Migration

### Before (axios with absolute URL in `apps/web/`)

```typescript
// apps/web/core/services/project.service.ts
import axios from 'axios';

const API_BASE_URL = process.env.VITE_API_BASE_URL;

export class ProjectService {
  async getProjects(workspaceSlug: string) {
    const response = await axios.get(`${API_BASE_URL}/api/workspaces/${workspaceSlug}/projects`);
    return response.data;
  }
}
```

### After (fetch with relative URL in `apps/web-next/`)

```typescript
// apps/web-next/core/lib/api.ts
class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new APIError(response.status, await response.text());
  }

  return response.json();
}

export const apiClient = {
  get: <T>(path: string) => api<T>(path),
  post: <T>(path: string, data: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string) => api<T>(path, { method: 'DELETE' }),
};
```

### Usage in Query Hooks

```typescript
// apps/web-next/core/hooks/queries/use-projects.ts
import { apiClient } from '@/lib/api';

export const useProjectsQuery = (workspaceSlug: string) => {
  return useQuery({
    queryKey: ['projects', workspaceSlug],
    queryFn: () => apiClient.get<Project[]>(`/api/workspaces/${workspaceSlug}/projects`),
    enabled: !!workspaceSlug,
  });
};
```

---

## E2E Test Verification Strategy

The existing Playwright E2E test suite (`apps/app/tests/e2e/`) can be used to verify each migration phase. The tests use a hybrid API-setup + UI-verification approach, making them ideal for catching regressions.

### Running Tests

```bash
cd apps/app/tests/e2e

# Run all tests
bun test

# Run specific feature tests
bunx playwright test specs/auth/
bunx playwright test specs/projects/
bunx playwright test specs/issues/

# Run with UI for debugging
bun test:ui

# Run headed (visible browser)
bun test:headed
```

### Test Coverage by Migration Phase

| Phase | Test Files to Run | Command |
|-------|------------------|---------|
| 1 - Auth | `specs/auth/*.spec.ts` | `bunx playwright test specs/auth/` |
| 2 - Workspaces | `specs/workspaces/*.spec.ts` | `bunx playwright test specs/workspaces/` |
| 3 - Projects | `specs/projects/*.spec.ts` | `bunx playwright test specs/projects/` |
| 4 - Issues | `specs/issues/*.spec.ts`, `specs/issue-*/*.spec.ts` | `bunx playwright test specs/issues/ specs/issue-comments/ specs/issue-relations/` |
| 5 - Cycles/Modules | `specs/cycles/*.spec.ts`, `specs/modules/*.spec.ts` | `bunx playwright test specs/cycles/ specs/modules/` |
| 6 - Pages | `specs/pages/*.spec.ts` | `bunx playwright test specs/pages/` |
| 7 - Views/Analytics | `specs/views/*.spec.ts` | `bunx playwright test specs/views/` |
| 8 - Settings | `specs/settings/*.spec.ts`, `specs/webhooks/*.spec.ts` | `bunx playwright test specs/settings/ specs/webhooks/` |
| 9 - Profile | `specs/user-profile/*.spec.ts` | `bunx playwright test specs/user-profile/` |

### Migration Verification Workflow

For each phase:

1. **Before migrating**: Run the relevant tests against the current implementation
   ```bash
   bunx playwright test specs/issues/ --reporter=json > before-migration.json
   ```

2. **After migrating**: Run the same tests against the new implementation
   ```bash
   bunx playwright test specs/issues/ --reporter=json > after-migration.json
   ```

3. **Compare results**: All tests that passed before should pass after

### Config Updates for Migration

The Playwright config (`playwright.config.ts`) should be updated to build from `web-next`:

```typescript
webServer: [
  {
    // Single Bun server serves both API and frontend
    command: `cd ../web-next && bun run build && cd ../app && DATABASE_URL=file:${path.resolve(__dirname, ".test-data/test.db")} PORT=${API_PORT} bun src/index.ts`,
    url: `http://localhost:${API_PORT}/api/health/`,
    reuseExistingServer: !process.env.CI,
  },
],
```

Note: The Bun server serves both the API (`/api/*`) and the built frontend (from `dist/web/`) on the same port.

### Key Test Files Reference

| Feature | Test File | What It Tests |
|---------|-----------|---------------|
| Sign up/in | `auth/signup-onboarding.spec.ts` | User registration, login, onboarding flow |
| Workspaces | `workspaces/workspace-ui.spec.ts` | Create, switch, sidebar navigation |
| Projects | `projects/project-ui.spec.ts` | Create, settings, list view |
| Issues | `issues/issue-ui.spec.ts` | CRUD, properties, comments, relations |
| Cycles | `cycles/cycle-ui.spec.ts` | Create, add issues, detail view |
| Modules | `modules/module-ui.spec.ts` | Create, add issues, detail view |
| Pages | `pages/page-ui.spec.ts` | Create, edit, list view |
| Views | `views/view-ui.spec.ts` | Create, filters, save |
| Bulk ops | `bulk-operations/bulk-operations-ui.spec.ts` | Multi-select, bulk update |
| Inbox | `intake/intake-ui.spec.ts` | Triage, accept, decline |

---

## Testing Checklist

### Phase 1: Authentication
- [ ] Sign in with email/password
- [ ] Sign in with SSO/OAuth
- [ ] Sign up new user
- [ ] Password reset flow
- [ ] Onboarding completion
- [ ] Session persistence
- [ ] Logout

### Phase 2: Workspaces
- [ ] Create workspace
- [ ] View workspace dashboard
- [ ] Switch workspaces
- [ ] Workspace home widgets
- [ ] Sidebar navigation
- [ ] Accept invitation

### Phase 3: Projects
- [ ] List/create/update/delete projects
- [ ] Project settings (general, members, states, labels)
- [ ] Archive/restore project

### Phase 4: Issues
- [ ] All view layouts (list, kanban, calendar, spreadsheet, gantt)
- [ ] Create/update/delete issues
- [ ] Bulk operations
- [ ] Filtering and sorting
- [ ] Issue detail/peek
- [ ] Comments, activities, attachments
- [ ] Sub-issues and relations
- [ ] Inbox workflow

### Phase 5: Cycles & Modules
- [ ] Cycle CRUD
- [ ] Module CRUD
- [ ] Add/remove issues
- [ ] Active cycles dashboard

### Phase 6: Pages
- [ ] Page CRUD
- [ ] Page editor
- [ ] Archive/restore

### Phase 7: Analytics & Views
- [ ] Analytics dashboard
- [ ] View CRUD

### Phase 8: Settings
- [ ] Workspace settings
- [ ] Integrations
- [ ] Webhooks
- [ ] API tokens

### Phase 9: Profile
- [ ] Profile settings
- [ ] Preferences

---

## Migration Progress Tracker

| Phase | Description | Queries | Stores | Components | Tests | Status |
|-------|-------------|---------|--------|------------|-------|--------|
| Pre-setup | Dependencies + Providers | - | - | - | - | ⬜ |
| 1 | Authentication | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 2 | Workspaces | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 3 | Projects | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 4 | Issues | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 5 | Cycles & Modules | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 6 | Pages | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 7 | Analytics & Views | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 8 | Settings | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| 9 | Profile | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

**Legend:** ⬜ Not Started | 🟡 In Progress | ✅ Complete

---

## Summary

### Architecture Overview

```
apps/
├── web/          # PRESERVED (original, do not modify)
├── web-next/     # NEW (migrated frontend)
└── app/          # Bun server (serves API + static files)
    └── dist/web/ # Built frontend from web-next
```

### What's Being Removed (from `web-next/`)
- **Sentry** - Error tracking (can add alternative later)
- **Vite** - Bun handles bundling
- **MobX** - Replaced by TanStack Query + Zustand
- **SWR** - Replaced by TanStack Query
- **axios** - Native fetch is sufficient
- **Absolute API URLs** - Now relative (same origin)

### What's Being Added (in `web-next/`)
- **TanStack Query** - Server state management
- **Zustand** - Minimal UI state management
- **Bun bundler** - Frontend build
- **Relative API calls** - `/api/*`

### What's Preserved (in `web/`)
- **Everything** - Original implementation remains untouched
- Use as reference during migration
- Enables safe rollback if needed

### Benefits
1. **Simpler stack** - Fewer dependencies
2. **Modern patterns** - TanStack Query is the standard
3. **Better DX** - Built-in devtools, optimistic updates
4. **Single server** - Bun serves both API and frontend
5. **Smaller bundle** - No MobX decorators/observers
6. **Type safety** - Better TypeScript integration
7. **Safe migration** - Original code preserved for reference/rollback
8. **Parallel development** - Can run both versions during transition

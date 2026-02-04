# Web Components Migration Plan: Django to Bun Server

> **Objective:** Migrate CE (Community Edition) web components/views to the Bun server with full feature parity.

## Migration Requirements

- ✅ Remove Sentry integration
- ✅ Remove Vite (Bun handles bundling/serving)
- ✅ Remove MobX (use TanStack Query + Zustand)
- ✅ Remove SWR (use TanStack Query)
- ✅ Relative API calls (same origin)
- ✅ CE components only (exclude `/ee/` folder)
- ✅ Full feature parity with existing web app

---

## Architecture Changes

### Before (Current Stack)
```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                           │
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
│                    Bun Server                           │
├─────────────────────────────────────────────────────────┤
│  Static file serving (built frontend)                  │
│  API routes (Hono)                                      │
│  Better Auth                                            │
│  Drizzle ORM + SQLite                                  │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                      Frontend                           │
├─────────────────────────────────────────────────────────┤
│  Bun (bundler)                                         │
│  React Router v7                                        │
│  TanStack Query (server state)                         │
│  Zustand (UI state)                                    │
│  TanStack Table (already in use)                       │
│  fetch → /api/* (relative)                             │
└─────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [Pre-Migration Setup](#1-pre-migration-setup)
2. [Route Migration Overview](#2-route-migration-overview)
3. [Phase 1: Authentication Routes](#phase-1-authentication-routes)
4. [Phase 2: Workspace Routes](#phase-2-workspace-routes)
5. [Phase 3: Project Routes](#phase-3-project-routes)
6. [Phase 4: Issue Management Routes](#phase-4-issue-management-routes)
7. [Phase 5: Cycles & Modules Routes](#phase-5-cycles--modules-routes)
8. [Phase 6: Pages Routes](#phase-6-pages-routes)
9. [Phase 7: Analytics & Views Routes](#phase-7-analytics--views-routes)
10. [Phase 8: Settings Routes](#phase-8-settings-routes)
11. [Phase 9: Profile Routes](#phase-9-profile-routes)
12. [Dependency Removal Guide](#dependency-removal-guide)
13. [State Management Migration](#state-management-migration)
14. [API Client Migration](#api-client-migration)
15. [Testing Checklist](#testing-checklist)

---

## 1. Pre-Migration Setup

### 1.1 Install New Dependencies

```bash
cd apps/app
bun add @tanstack/react-query @tanstack/react-query-devtools zustand
```

### 1.2 Remove Old Dependencies

```bash
cd apps/web
bun remove @sentry/react-router mobx mobx-react mobx-react-lite mobx-utils swr vite @vitejs/plugin-react
```

### 1.3 Remove Files

```bash
# Remove Vite config
rm vite.config.ts

# Remove Sentry entry
rm app/entry.client.tsx

# Remove MobX stores (will be replaced)
rm -rf core/store/
rm -rf ce/store/
```

### 1.4 Update Environment Variables

Remove from `.env`:
```diff
- VITE_API_BASE_URL=http://localhost:8000
- VITE_SENTRY_DSN=
- VITE_SENTRY_ENVIRONMENT=
- VITE_SENTRY_SEND_DEFAULT_PII=
- VITE_SENTRY_TRACES_SAMPLE_RATE=
- VITE_SENTRY_PROFILES_SAMPLE_RATE=
- VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE=
- VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE=
```

### 1.5 Configure Bun for Frontend Build

Update `apps/app/package.json`:
```json
{
  "scripts": {
    "build:web": "bun build ../web/app/entry.tsx --outdir=./dist/web --minify --splitting",
    "dev": "bun --watch src/index.ts",
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

// API routes
app.route('/api', apiRoutes);

// Serve static frontend assets
app.use('/*', serveStatic({ root: './dist/web' }));

// SPA fallback
app.get('*', serveStatic({ path: './dist/web/index.html' }));

export default app;
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

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/` (Home/Sign-in) | `app/(home)/page.tsx` | None (core only) |
| `/sign-up` | `app/(all)/sign-up/page.tsx` | None (core only) |
| `/accounts/forgot-password` | `app/(all)/accounts/forgot-password/page.tsx` | None |
| `/accounts/set-password` | `app/(all)/accounts/set-password/page.tsx` | None |
| `/accounts/reset-password` | `app/(all)/accounts/reset-password/page.tsx` | None |
| `/onboarding` | `app/(all)/onboarding/page.tsx` | `ce/components/onboarding/` |

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

ce/components/onboarding/
├── create-workspace/
├── invite-members/
├── profile-setup/
└── index.ts
```

### TanStack Query Hooks to Create

```typescript
// core/hooks/queries/use-auth.ts
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

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/create-workspace` | `app/(all)/create-workspace/page.tsx` | `ce/components/workspace/` |
| `/:workspaceSlug` | `app/(all)/[workspaceSlug]/page.tsx` | `ce/components/home/` |
| `/invitations` | `app/(all)/invitations/page.tsx` | None |
| `/workspace-invitations/:invitationId` | `app/(all)/workspace-invitations/page.tsx` | None |

### Components to Migrate

```
ce/components/workspace/
├── create/
├── settings/
├── views/
├── sidebar/
└── index.ts

ce/components/home/
├── root.tsx
├── widgets/
│   ├── assigned-issues/
│   ├── created-issues/
│   ├── recent-activity/
│   ├── recent-projects/
│   └── quick-links/
└── index.ts

ce/components/sidebar/
├── workspace-menu.tsx
├── project-list.tsx
├── favorites.tsx
└── index.ts

ce/components/app-rail/
├── app-rail.tsx
├── app-rail-item.tsx
└── index.ts
```

### MobX → Zustand Store Migration

**Before (MobX):**
```typescript
// ce/store/workspace/workspace.store.ts
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
// core/store/workspace-ui.store.ts
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
// core/hooks/queries/use-workspaces.ts
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
4. [ ] Migrate CE workspace components to use hooks
5. [ ] Migrate home dashboard widgets
6. [ ] Migrate sidebar components
7. [ ] Migrate app rail components
8. [ ] Test workspace creation
9. [ ] Test workspace switching
10. [ ] Test invitation acceptance

---

## Phase 3: Project Routes

### Routes to Migrate

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/:workspaceSlug/projects` | `app/(all)/[workspaceSlug]/projects/page.tsx` | `ce/components/projects/` |
| `/:workspaceSlug/projects/:projectId` | `app/(all)/[workspaceSlug]/projects/[projectId]/page.tsx` | `ce/components/projects/` |
| `/:workspaceSlug/projects/:projectId/settings/*` | `app/(all)/[workspaceSlug]/projects/[projectId]/settings/` | `ce/components/projects/settings/` |

### Components to Migrate

```
ce/components/projects/
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
// core/hooks/queries/use-projects.ts
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
// core/store/project-ui.store.ts
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

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/:workspaceSlug/projects/:projectId/issues` | `app/(all)/[workspaceSlug]/projects/[projectId]/issues/page.tsx` | `ce/components/issues/` |
| `/:workspaceSlug/projects/:projectId/issues/:issueId` | `app/(all)/[workspaceSlug]/projects/[projectId]/issues/[issueId]/page.tsx` | `ce/components/issues/` |
| `/:workspaceSlug/projects/:projectId/inbox` | `app/(all)/[workspaceSlug]/projects/[projectId]/inbox/page.tsx` | `ce/components/inbox/` |
| `/:workspaceSlug/projects/:projectId/archives/issues` | `app/(all)/[workspaceSlug]/projects/[projectId]/archives/issues/page.tsx` | `ce/components/issues/` |
| `/:workspaceSlug/projects/:projectId/draft-issues` | `app/(all)/[workspaceSlug]/projects/[projectId]/draft-issues/page.tsx` | `ce/components/issues/` |

### Components to Migrate

```
ce/components/issues/
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

ce/components/inbox/
├── inbox-root.tsx
├── inbox-list.tsx
├── inbox-item.tsx
├── inbox-filters.tsx
└── index.ts
```

### TanStack Query Hooks

```typescript
// core/hooks/queries/use-issues.ts
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
// core/store/issue-ui.store.ts
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

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/:workspaceSlug/projects/:projectId/cycles` | `app/(all)/[workspaceSlug]/projects/[projectId]/cycles/page.tsx` | `ce/components/cycles/` |
| `/:workspaceSlug/projects/:projectId/cycles/:cycleId` | `app/(all)/[workspaceSlug]/projects/[projectId]/cycles/[cycleId]/page.tsx` | `ce/components/cycles/` |
| `/:workspaceSlug/projects/:projectId/modules` | `app/(all)/[workspaceSlug]/projects/[projectId]/modules/page.tsx` | `ce/components/modules/` |
| `/:workspaceSlug/projects/:projectId/modules/:moduleId` | `app/(all)/[workspaceSlug]/projects/[projectId]/modules/[moduleId]/page.tsx` | `ce/components/modules/` |
| `/:workspaceSlug/active-cycles` | `app/(all)/[workspaceSlug]/active-cycles/page.tsx` | `ce/components/active-cycles/` |

### Components to Migrate

```
ce/components/cycles/
├── list/
├── board/
├── gantt/
├── detail/
├── modal/
├── sidebar/
├── transfer-issues/
└── index.ts

ce/components/modules/
├── list/
├── board/
├── gantt/
├── detail/
├── modal/
├── sidebar/
└── index.ts

ce/components/active-cycles/
├── active-cycle-root.tsx
├── active-cycle-stats.tsx
├── active-cycle-progress.tsx
└── index.ts
```

### TanStack Query Hooks

```typescript
// core/hooks/queries/use-cycles.ts
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

// core/hooks/queries/use-modules.ts
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

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/:workspaceSlug/projects/:projectId/pages` | `app/(all)/[workspaceSlug]/projects/[projectId]/pages/page.tsx` | `ce/components/pages/` |
| `/:workspaceSlug/projects/:projectId/pages/:pageId` | `app/(all)/[workspaceSlug]/projects/[projectId]/pages/[pageId]/page.tsx` | `ce/components/pages/` |
| `/:workspaceSlug/projects/:projectId/archives/pages` | `app/(all)/[workspaceSlug]/projects/[projectId]/archives/pages/page.tsx` | `ce/components/pages/` |

### Components to Migrate

```
ce/components/pages/
├── list/
├── editor/
├── modal/
├── detail/
├── loaders/
└── index.ts
```

### TanStack Query Hooks

```typescript
// core/hooks/queries/use-pages.ts
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

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/:workspaceSlug/analytics` | `app/(all)/[workspaceSlug]/analytics/page.tsx` | `ce/components/analytics/` |
| `/:workspaceSlug/analytics/:tabId` | `app/(all)/[workspaceSlug]/analytics/[tabId]/page.tsx` | `ce/components/analytics/` |
| `/:workspaceSlug/projects/:projectId/views` | `app/(all)/[workspaceSlug]/projects/[projectId]/views/page.tsx` | `ce/components/views/` |
| `/:workspaceSlug/projects/:projectId/views/:viewId` | `app/(all)/[workspaceSlug]/projects/[projectId]/views/[viewId]/page.tsx` | `ce/components/views/` |

### Components to Migrate

```
ce/components/analytics/
├── project-analytics/
├── custom-analytics/
└── index.ts

core/components/analytics/
├── insight-table/     # Already uses TanStack Table
├── work-items/
└── index.ts

ce/components/views/
├── view-list.tsx
├── view-list-item.tsx
├── view-modal.tsx
├── view-form.tsx
└── index.ts
```

### TanStack Query Hooks

```typescript
// core/hooks/queries/use-analytics.ts
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

// core/hooks/queries/use-views.ts
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

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/:workspaceSlug/settings` | `app/(all)/[workspaceSlug]/settings/page.tsx` | `ce/components/workspace/settings/` |
| `/:workspaceSlug/settings/members` | `app/(all)/[workspaceSlug]/settings/members/page.tsx` | - |
| `/:workspaceSlug/settings/billing` | `app/(all)/[workspaceSlug]/settings/billing/page.tsx` | - |
| `/:workspaceSlug/settings/integrations` | `app/(all)/[workspaceSlug]/settings/integrations/page.tsx` | - |
| `/:workspaceSlug/settings/imports` | `app/(all)/[workspaceSlug]/settings/imports/page.tsx` | - |
| `/:workspaceSlug/settings/exports` | `app/(all)/[workspaceSlug]/settings/exports/page.tsx` | - |
| `/:workspaceSlug/settings/webhooks` | `app/(all)/[workspaceSlug]/settings/webhooks/page.tsx` | - |
| `/:workspaceSlug/settings/api-tokens` | `app/(all)/[workspaceSlug]/settings/api-tokens/page.tsx` | - |

### TanStack Query Hooks

```typescript
// core/hooks/queries/use-settings.ts
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

| Route | File Location | CE Components |
|-------|--------------|---------------|
| `/profile` | `app/(all)/profile/page.tsx` | `ce/components/profile/` |
| `/profile/settings` | `app/(all)/profile/settings/page.tsx` | - |
| `/profile/activity` | `app/(all)/profile/activity/page.tsx` | - |
| `/profile/preferences` | `app/(all)/profile/preferences/page.tsx` | `ce/components/preferences/` |

### TanStack Query Hooks

```typescript
// core/hooks/queries/use-profile.ts
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

### Files to Delete

```bash
# Vite
rm vite.config.ts

# Sentry
rm app/entry.client.tsx

# MobX stores (all will be replaced)
rm -rf core/store/
rm -rf ce/store/

# SWR related (if any dedicated files)
# Keep service files - they contain API logic
```

### Files to Modify

#### `app/root.tsx`
```diff
- import * as Sentry from "@sentry/react-router";

// In error boundary
- Sentry.captureException(error);
+ console.error("Application error:", error);
```

#### `app/provider.tsx`
```typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

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

export function AppProvider({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
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
core/store/
├── ui/
│   ├── app-ui.store.ts      # Global UI (theme, sidebar)
│   ├── issue-ui.store.ts    # Issue-specific UI
│   ├── project-ui.store.ts  # Project-specific UI
│   └── index.ts
```

### Example: Global UI Store

```typescript
// core/store/ui/app-ui.store.ts
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

### Before (axios with absolute URL)

```typescript
// core/services/project.service.ts
import axios from 'axios';

const API_BASE_URL = process.env.VITE_API_BASE_URL;

export class ProjectService {
  async getProjects(workspaceSlug: string) {
    const response = await axios.get(`${API_BASE_URL}/api/workspaces/${workspaceSlug}/projects`);
    return response.data;
  }
}
```

### After (fetch with relative URL)

```typescript
// core/lib/api.ts
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
// core/hooks/queries/use-projects.ts
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

The Playwright config (`playwright.config.ts`) already supports the Bun server:

```typescript
webServer: [
  {
    // Bun API server
    command: `DATABASE_URL=file:${path.resolve(__dirname, ".test-data/test.db")} PORT=${API_PORT} bun src/index.ts`,
    url: `http://localhost:${API_PORT}/api/health/`,
  },
  {
    // Frontend (update this when migrating to Bun-served frontend)
    command: `bun run build:web && bun src/index.ts`, // Single server serves both
    url: `http://localhost:${WEB_PORT}`,
  },
],
```

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

### What's Being Removed
- **Sentry** - Error tracking (can add alternative later)
- **Vite** - Bun handles bundling
- **MobX** - Replaced by TanStack Query + Zustand
- **SWR** - Replaced by TanStack Query
- **axios** - Native fetch is sufficient
- **Absolute API URLs** - Now relative (same origin)

### What's Being Added
- **TanStack Query** - Server state management
- **Zustand** - Minimal UI state management
- **Bun bundler** - Frontend build
- **Relative API calls** - `/api/*`

### Benefits
1. **Simpler stack** - Fewer dependencies
2. **Modern patterns** - TanStack Query is the standard
3. **Better DX** - Built-in devtools, optimistic updates
4. **Single server** - Bun serves both API and frontend
5. **Smaller bundle** - No MobX decorators/observers
6. **Type safety** - Better TypeScript integration

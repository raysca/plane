/* eslint-disable */
// @ts-nocheck
// This file manually defines the route tree using createRoute
// for better control over the route hierarchy

import { createRoute } from '@tanstack/react-router'

// Import the root route from __root.tsx
import { Route as rootRoute } from './routes/__root'

// Import route modules to get their components and loaders
import { Route as IndexRouteModule } from './routes/index'
import { Route as SignUpRouteModule } from './routes/sign-up'
import { Route as OnboardingRouteModule } from './routes/onboarding'
import { Route as CreateWorkspaceRouteModule } from './routes/create-workspace'
import { Route as InvitationsRouteModule } from './routes/invitations'
import { Route as WorkspaceInvitationsRouteModule } from './routes/workspace-invitations'
import { Route as ForgotPasswordRouteModule } from './routes/accounts/forgot-password'
import { Route as ResetPasswordRouteModule } from './routes/accounts/reset-password'
import { Route as SetPasswordRouteModule } from './routes/accounts/set-password'
// Workspace routes
import { Route as WorkspaceLayoutRouteModule } from './routes/$workspaceSlug'
import { Route as WorkspaceHomeRouteModule } from './routes/$workspaceSlug/index'
import { Route as ProjectsLayoutRouteModule } from './routes/$workspaceSlug/projects'
import { Route as ProjectsListRouteModule } from './routes/$workspaceSlug/projects/index'
import { Route as ProjectLayoutRouteModule } from './routes/$workspaceSlug/projects/$projectId'
import { Route as IssuesLayoutRouteModule } from './routes/$workspaceSlug/projects/$projectId/issues'
import { Route as IssuesListRouteModule } from './routes/$workspaceSlug/projects/$projectId/issues/index'

// Helper to extract route options
function getRouteOptions(routeModule: any) {
  return {
    component: routeModule.options?.component,
    loader: routeModule.options?.loader,
    errorComponent: routeModule.options?.errorComponent,
    pendingComponent: routeModule.options?.pendingComponent,
  }
}

// Top-level routes (children of root)
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  ...getRouteOptions(IndexRouteModule),
})

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sign-up',
  ...getRouteOptions(SignUpRouteModule),
})

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  ...getRouteOptions(OnboardingRouteModule),
})

const createWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/create-workspace',
  ...getRouteOptions(CreateWorkspaceRouteModule),
})

const invitationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invitations',
  ...getRouteOptions(InvitationsRouteModule),
})

const workspaceInvitationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspace-invitations',
  ...getRouteOptions(WorkspaceInvitationsRouteModule),
})

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts/forgot-password',
  ...getRouteOptions(ForgotPasswordRouteModule),
})

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts/reset-password',
  ...getRouteOptions(ResetPasswordRouteModule),
})

const setPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accounts/set-password',
  ...getRouteOptions(SetPasswordRouteModule),
})

// Workspace layout route
const workspaceLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspaceSlug',
  ...getRouteOptions(WorkspaceLayoutRouteModule),
})

// Workspace index (home) route
const workspaceHomeRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: '/',
  ...getRouteOptions(WorkspaceHomeRouteModule),
})

// Projects layout route
const projectsLayoutRoute = createRoute({
  getParentRoute: () => workspaceLayoutRoute,
  path: 'projects',
  ...getRouteOptions(ProjectsLayoutRouteModule),
})

// Projects list route
const projectsListRoute = createRoute({
  getParentRoute: () => projectsLayoutRoute,
  path: '/',
  ...getRouteOptions(ProjectsListRouteModule),
})

// Project layout route
const projectLayoutRoute = createRoute({
  getParentRoute: () => projectsLayoutRoute,
  path: '$projectId',
  ...getRouteOptions(ProjectLayoutRouteModule),
})

// Issues layout route
const issuesLayoutRoute = createRoute({
  getParentRoute: () => projectLayoutRoute,
  path: 'issues',
  ...getRouteOptions(IssuesLayoutRouteModule),
})

// Issues list route
const issuesListRoute = createRoute({
  getParentRoute: () => issuesLayoutRoute,
  path: '/',
  ...getRouteOptions(IssuesListRouteModule),
})

// Create the route tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  signUpRoute,
  onboardingRoute,
  createWorkspaceRoute,
  invitationsRoute,
  workspaceInvitationsRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  setPasswordRoute,
  workspaceLayoutRoute.addChildren([
    workspaceHomeRoute,
    projectsLayoutRoute.addChildren([
      projectsListRoute,
      projectLayoutRoute.addChildren([
        issuesLayoutRoute.addChildren([
          issuesListRoute,
        ]),
      ]),
    ]),
  ]),
])

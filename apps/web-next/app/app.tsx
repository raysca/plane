import { BrowserRouter, Routes, Route } from "react-router";
import { HomePage } from "./pages/home";
import { ForgotPasswordPage } from "./pages/accounts/forgot-password";
import { ResetPasswordPage } from "./pages/accounts/reset-password";
import { CreateWorkspacePage, WorkspaceDashboardPage } from "./pages/workspace";
import { WorkspaceLayout } from "@/core/components/layout";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/accounts/sign-in" element={<HomePage />} />
        <Route path="/accounts/sign-up" element={<HomePage />} />
        <Route path="/accounts/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/accounts/reset-password" element={<ResetPasswordPage />} />

        {/* Workspace creation */}
        <Route path="/create-workspace" element={<CreateWorkspacePage />} />

        {/* Workspace routes */}
        <Route path="/:workspaceSlug" element={<WorkspaceLayout />}>
          <Route index element={<WorkspaceDashboardPage />} />
          {/* TODO: Add more workspace routes as they are migrated */}
          {/* <Route path="projects" element={<ProjectsPage />} /> */}
          {/* <Route path="projects/:projectId/*" element={<ProjectRoutes />} /> */}
          {/* <Route path="active-cycles" element={<ActiveCyclesPage />} /> */}
          {/* <Route path="all-issues" element={<AllIssuesPage />} /> */}
          {/* <Route path="analytics" element={<AnalyticsPage />} /> */}
          {/* <Route path="settings/*" element={<SettingsRoutes />} /> */}
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

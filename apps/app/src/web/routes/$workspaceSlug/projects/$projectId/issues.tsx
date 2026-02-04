import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/$workspaceSlug/projects/$projectId/issues"
)({
  component: IssuesLayout,
});

function IssuesLayout() {
  return <Outlet />;
}

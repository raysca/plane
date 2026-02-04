import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/$workspaceSlug/projects")({
  component: ProjectsLayout,
});

function ProjectsLayout() {
  return <Outlet />;
}

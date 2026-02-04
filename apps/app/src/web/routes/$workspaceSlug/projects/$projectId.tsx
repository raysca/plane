import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import {
  ListTodo,
  Repeat,
  Boxes,
  FileText,
  Eye,
  Settings,
  ChevronLeft,
} from "lucide-react";

export const Route = createFileRoute("/$workspaceSlug/projects/$projectId")({
  component: ProjectLayout,
  loader: async ({ params }) => {
    const response = await fetch(
      `/api/workspaces/${params.workspaceSlug}/projects/${params.projectId}/`,
      { credentials: "include" }
    );
    if (!response.ok) {
      throw new Error("Project not found");
    }
    return response.json();
  },
  errorComponent: ProjectError,
});

function ProjectError({ error }: { error: Error }) {
  const navigate = useNavigate();
  const { workspaceSlug } = Route.useParams();

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h1 className="text-xl font-semibold text-custom-text-100 mb-2">
          Project not found
        </h1>
        <p className="text-custom-text-300 mb-4">{error.message}</p>
        <button
          onClick={() => navigate({ to: `/${workspaceSlug}/projects` })}
          className="px-4 py-2 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
        >
          Back to Projects
        </button>
      </div>
    </div>
  );
}

type Project = {
  id: string;
  name: string;
  identifier: string;
  description: string;
  logo_props: Record<string, unknown>;
  cycle_view: boolean;
  module_view: boolean;
  page_view: boolean;
  issue_views_view: boolean;
};

function ProjectLayout() {
  const { workspaceSlug, projectId } = Route.useParams();
  const project = Route.useLoaderData() as Project;

  const tabs = [
    {
      name: "Issues",
      href: `/${workspaceSlug}/projects/${projectId}/issues`,
      icon: ListTodo,
      enabled: true,
    },
    {
      name: "Cycles",
      href: `/${workspaceSlug}/projects/${projectId}/cycles`,
      icon: Repeat,
      enabled: project.cycle_view,
    },
    {
      name: "Modules",
      href: `/${workspaceSlug}/projects/${projectId}/modules`,
      icon: Boxes,
      enabled: project.module_view,
    },
    {
      name: "Views",
      href: `/${workspaceSlug}/projects/${projectId}/views`,
      icon: Eye,
      enabled: project.issue_views_view,
    },
    {
      name: "Pages",
      href: `/${workspaceSlug}/projects/${projectId}/pages`,
      icon: FileText,
      enabled: project.page_view,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Project Header */}
      <div className="border-b border-custom-border-200 bg-custom-background-100">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              to={`/${workspaceSlug}/projects`}
              className="p-1 hover:bg-custom-background-80 rounded"
            >
              <ChevronLeft className="h-5 w-5 text-custom-text-300" />
            </Link>
            <div className="h-8 w-8 rounded-lg bg-custom-background-80 flex items-center justify-center text-xs font-medium text-custom-text-200">
              {project.identifier?.[0] || project.name?.[0] || "P"}
            </div>
            <div>
              <h1 className="text-sm font-medium text-custom-text-100">
                {project.name}
              </h1>
              <p className="text-xs text-custom-text-400">
                {project.identifier}
              </p>
            </div>
            <Link
              to={`/${workspaceSlug}/settings/projects/${projectId}`}
              className="ml-auto p-2 hover:bg-custom-background-80 rounded"
            >
              <Settings className="h-4 w-4 text-custom-text-400" />
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-4">
          <nav className="flex gap-1 -mb-px">
            {tabs
              .filter((tab) => tab.enabled)
              .map((tab) => (
                <Link
                  key={tab.name}
                  to={tab.href}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-custom-text-300 hover:text-custom-text-100 border-b-2 border-transparent transition-colors"
                  activeProps={{
                    className:
                      "text-custom-primary-100 border-custom-primary-100 hover:text-custom-primary-100",
                  }}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.name}
                </Link>
              ))}
          </nav>
        </div>
      </div>

      {/* Page Content */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}

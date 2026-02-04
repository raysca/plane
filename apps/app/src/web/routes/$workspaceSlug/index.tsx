import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FolderKanban, ArrowRight, Clock, Activity, X, Sparkles } from "lucide-react";

export const Route = createFileRoute("/$workspaceSlug/")({
  component: WorkspaceHomePage,
});

type Project = {
  id: string;
  name: string;
  identifier: string;
  logo_props: Record<string, unknown>;
  created_at: string;
  total_members?: number;
};

type User = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  is_tour_completed: boolean;
};

function WorkspaceHomePage() {
  const { workspaceSlug } = Route.useParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const [projectsRes, userRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceSlug}/projects/`, {
            credentials: "include",
          }),
          fetch("/api/users/me/", { credentials: "include" }),
        ]);

        if (projectsRes.ok) {
          const data = await projectsRes.json();
          setProjects(data);
        }

        if (userRes.ok) {
          const data = await userRes.json();
          setUser(data);
          // Show welcome modal if tour not completed
          if (!data.is_tour_completed) {
            setShowWelcome(true);
          }
        }
      } catch (err) {
        console.error("Failed to fetch data:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [workspaceSlug]);

  async function handleDismissWelcome() {
    setShowWelcome(false);
    // Mark tour as completed
    try {
      await fetch("/api/users/me/tour-completed/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_tour_completed: true }),
        credentials: "include",
      });
    } catch (err) {
      console.error("Failed to update tour status:", err);
    }
  }

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <>
      {/* Welcome Modal */}
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg mx-4 bg-custom-background-100 rounded-xl shadow-xl overflow-hidden">
            {/* Header */}
            <div className="bg-custom-primary-100 p-8 text-center relative">
              <button
                onClick={handleDismissWelcome}
                className="absolute top-4 right-4 p-1 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-white" />
              </button>
              <Sparkles className="h-12 w-12 text-white mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white">
                Welcome to Plane!
              </h2>
            </div>
            {/* Content */}
            <div className="p-6">
              <p className="text-custom-text-200 text-center mb-6">
                Hi {user?.first_name || "there"}! We're excited to have you.
                Plane helps you manage your projects with ease. Get started by
                exploring your workspace.
              </p>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-custom-background-90 rounded-lg">
                  <FolderKanban className="h-5 w-5 text-custom-primary-100 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-custom-text-100">Projects</h4>
                    <p className="text-xs text-custom-text-400">Organize work into projects with customizable workflows</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-custom-background-90 rounded-lg">
                  <Activity className="h-5 w-5 text-custom-primary-100 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-medium text-custom-text-100">Issues</h4>
                    <p className="text-xs text-custom-text-400">Track tasks, bugs, and features with detailed issues</p>
                  </div>
                </div>
              </div>
              <button
                onClick={handleDismissWelcome}
                className="w-full mt-6 py-2.5 px-4 bg-custom-primary-100 text-white rounded-lg hover:bg-custom-primary-200 transition-colors font-medium"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="p-6 max-w-6xl mx-auto">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-custom-text-100 mb-1">
            {greeting()},{" "}
            {user?.first_name || user?.display_name || "there"}
          </h1>
          <p className="text-custom-text-300">
            Here's what's happening in your workspace
          </p>
        </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link
          to={`/${workspaceSlug}/projects`}
          className="p-4 bg-custom-background-90 border border-custom-border-200 rounded-lg hover:border-custom-primary-100 transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <FolderKanban className="h-5 w-5 text-custom-primary-100" />
            <ArrowRight className="h-4 w-4 text-custom-text-400 group-hover:text-custom-primary-100 transition-colors" />
          </div>
          <h3 className="text-sm font-medium text-custom-text-100">
            View Projects
          </h3>
          <p className="text-xs text-custom-text-400 mt-1">
            {projects.length} project{projects.length !== 1 ? "s" : ""} in
            workspace
          </p>
        </Link>

        <div className="p-4 bg-custom-background-90 border border-custom-border-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <Clock className="h-5 w-5 text-custom-text-400" />
          </div>
          <h3 className="text-sm font-medium text-custom-text-100">
            Recent Activity
          </h3>
          <p className="text-xs text-custom-text-400 mt-1">
            Track your recent work
          </p>
        </div>

        <div className="p-4 bg-custom-background-90 border border-custom-border-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <Activity className="h-5 w-5 text-custom-text-400" />
          </div>
          <h3 className="text-sm font-medium text-custom-text-100">
            My Issues
          </h3>
          <p className="text-xs text-custom-text-400 mt-1">
            Issues assigned to you
          </p>
        </div>
      </div>

      {/* Projects Grid */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-custom-text-100">
            Your Projects
          </h2>
          <Link
            to={`/${workspaceSlug}/projects`}
            className="text-sm text-custom-primary-100 hover:underline"
          >
            View all
          </Link>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-32 bg-custom-background-90 border border-custom-border-200 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-12 bg-custom-background-90 border border-custom-border-200 rounded-lg">
            <FolderKanban className="h-12 w-12 text-custom-text-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-custom-text-100 mb-2">
              No projects yet
            </h3>
            <p className="text-custom-text-300 mb-4">
              Create your first project to get started
            </p>
            <Link
              to={`/${workspaceSlug}/projects`}
              search={{ create: true }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
            >
              Create Project
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.slice(0, 6).map((project) => (
              <Link
                key={project.id}
                to={`/${workspaceSlug}/projects/${project.id}/issues`}
                className="p-4 bg-custom-background-90 border border-custom-border-200 rounded-lg hover:border-custom-primary-100 transition-colors group"
              >
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-custom-background-80 flex items-center justify-center text-sm font-medium text-custom-text-200">
                    {project.identifier?.[0] || project.name?.[0] || "P"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-custom-text-100 truncate group-hover:text-custom-primary-100 transition-colors">
                      {project.name}
                    </h3>
                    <p className="text-xs text-custom-text-400 mt-0.5">
                      {project.identifier}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      </div>
    </>
  );
}

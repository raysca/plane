import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Home,
  FolderKanban,
  Settings,
  Search,
  Bell,
  ChevronDown,
  Plus,
  LogOut,
  User,
  Menu,
  X,
} from "lucide-react";

export const Route = createFileRoute("/$workspaceSlug")({
  component: WorkspaceLayout,
  loader: async ({ params }) => {
    // Fetch workspace data
    const response = await fetch(`/api/workspaces/${params.workspaceSlug}/`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Workspace not found");
    }
    return response.json();
  },
  errorComponent: WorkspaceError,
});

function WorkspaceError({ error }: { error: Error }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-custom-background-100">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-custom-text-100 mb-2">
          Workspace not found
        </h1>
        <p className="text-custom-text-300 mb-4">{error.message}</p>
        <button
          onClick={() => navigate({ to: "/" })}
          className="px-4 py-2 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
        >
          Go to Sign In
        </button>
      </div>
    </div>
  );
}

type Workspace = {
  id: string;
  name: string;
  slug: string;
  logo: string;
  logo_url: string | null;
};

type Project = {
  id: string;
  name: string;
  identifier: string;
  logo_props: Record<string, unknown>;
  sort_order: number;
};

type User = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  avatar: string;
  avatar_url: string;
};

function WorkspaceLayout() {
  const { workspaceSlug } = Route.useParams();
  const workspace = Route.useLoaderData() as Workspace;
  const [projects, setProjects] = useState<Project[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        // Fetch projects and user in parallel
        const [projectsRes, userRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceSlug}/projects/`, {
            credentials: "include",
          }),
          fetch("/api/users/me/", { credentials: "include" }),
        ]);

        if (projectsRes.ok) {
          const projectsData = await projectsRes.json();
          setProjects(projectsData);
        }

        if (userRes.ok) {
          const userData = await userRes.json();
          setUser(userData);
        }
      } catch (err) {
        console.error("Failed to fetch workspace data:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [workspaceSlug]);

  async function handleSignOut() {
    try {
      await fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
      });
      window.location.href = "/";
    } catch (err) {
      console.error("Sign out failed:", err);
    }
  }

  const navItems = [
    {
      name: "Home",
      href: `/${workspaceSlug}`,
      icon: Home,
    },
    {
      name: "Projects",
      href: `/${workspaceSlug}/projects`,
      icon: FolderKanban,
    },
  ];

  return (
    <div className="min-h-screen bg-custom-background-100 flex">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-16"
        } bg-custom-background-90 border-r border-custom-border-200 flex flex-col transition-all duration-200`}
      >
        {/* Workspace Header */}
        <div className="h-14 px-3 flex items-center justify-between border-b border-custom-border-200">
          {sidebarOpen ? (
            <button
              onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
              className="flex items-center gap-2 hover:bg-custom-background-80 rounded-md px-2 py-1.5 w-full"
            >
              <div className="h-6 w-6 rounded bg-custom-primary-100/10 flex items-center justify-center text-xs font-medium text-custom-primary-100">
                {workspace.name?.[0]?.toUpperCase() || "W"}
              </div>
              <span className="text-sm font-medium text-custom-text-100 truncate flex-1">
                {workspace.name}
              </span>
              <ChevronDown className="h-4 w-4 text-custom-text-300" />
            </button>
          ) : (
            <div className="h-6 w-6 rounded bg-custom-primary-100/10 flex items-center justify-center text-xs font-medium text-custom-primary-100 mx-auto">
              {workspace.name?.[0]?.toUpperCase() || "W"}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2">
          <div className="space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className="flex items-center gap-3 px-3 py-2 text-sm text-custom-text-200 hover:bg-custom-background-80 rounded-md transition-colors"
                activeProps={{
                  className:
                    "bg-custom-primary-100/10 text-custom-primary-100 hover:bg-custom-primary-100/10",
                }}
              >
                <item.icon className="h-4 w-4 flex-shrink-0" />
                {sidebarOpen && <span>{item.name}</span>}
              </Link>
            ))}
          </div>

          {/* Projects Section */}
          {sidebarOpen && (
            <div className="mt-6">
              <div className="px-3 mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-custom-text-400 uppercase tracking-wider">
                  Projects
                </span>
                <Link
                  to={`/${workspaceSlug}/projects`}
                  search={{ create: true }}
                  className="p-1 hover:bg-custom-background-80 rounded"
                >
                  <Plus className="h-3.5 w-3.5 text-custom-text-400" />
                </Link>
              </div>
              <div className="space-y-0.5">
                {isLoading ? (
                  <div className="px-3 py-2">
                    <div className="h-4 bg-custom-background-80 rounded animate-pulse" />
                  </div>
                ) : projects.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-custom-text-400">
                    No projects yet
                  </div>
                ) : (
                  projects.slice(0, 5).map((project) => (
                    <Link
                      key={project.id}
                      to={`/${workspaceSlug}/projects/${project.id}/issues`}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm text-custom-text-200 hover:bg-custom-background-80 rounded-md transition-colors"
                      activeProps={{
                        className: "bg-custom-background-80",
                      }}
                    >
                      <span className="h-5 w-5 rounded bg-custom-background-80 flex items-center justify-center text-[10px] font-medium text-custom-text-300">
                        {project.identifier?.[0] || project.name?.[0] || "P"}
                      </span>
                      <span className="truncate">{project.name}</span>
                    </Link>
                  ))
                )}
                {projects.length > 5 && (
                  <Link
                    to={`/${workspaceSlug}/projects`}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-custom-text-400 hover:text-custom-text-200"
                  >
                    View all {projects.length} projects
                  </Link>
                )}
              </div>
            </div>
          )}
        </nav>

        {/* User Section */}
        <div className="p-2 border-t border-custom-border-200">
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className={`flex items-center gap-2 w-full px-2 py-2 hover:bg-custom-background-80 rounded-md ${
                sidebarOpen ? "" : "justify-center"
              }`}
            >
              <div className="h-7 w-7 rounded-full bg-custom-primary-100/10 flex items-center justify-center text-xs font-medium text-custom-primary-100 flex-shrink-0">
                {user?.first_name?.[0]?.toUpperCase() ||
                  user?.email?.[0]?.toUpperCase() ||
                  "U"}
              </div>
              {sidebarOpen && (
                <>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-custom-text-100 truncate">
                      {user?.display_name || user?.first_name || user?.email}
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-custom-text-300" />
                </>
              )}
            </button>

            {/* User Dropdown */}
            {userMenuOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-full min-w-[200px] bg-custom-background-100 border border-custom-border-200 rounded-md shadow-lg py-1 z-50">
                <Link
                  to={`/${workspaceSlug}/settings/account`}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-custom-text-200 hover:bg-custom-background-80"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <User className="h-4 w-4" />
                  Profile
                </Link>
                <Link
                  to={`/${workspaceSlug}/settings`}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-custom-text-200 hover:bg-custom-background-80"
                  onClick={() => setUserMenuOpen(false)}
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
                <hr className="my-1 border-custom-border-200" />
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-custom-background-80 w-full"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 px-4 flex items-center justify-between border-b border-custom-border-200 bg-custom-background-100">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 hover:bg-custom-background-80 rounded-md"
            >
              {sidebarOpen ? (
                <X className="h-5 w-5 text-custom-text-300" />
              ) : (
                <Menu className="h-5 w-5 text-custom-text-300" />
              )}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-custom-background-80 rounded-md">
              <Search className="h-5 w-5 text-custom-text-300" />
            </button>
            <button className="p-2 hover:bg-custom-background-80 rounded-md">
              <Bell className="h-5 w-5 text-custom-text-300" />
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Click outside handlers */}
      {(userMenuOpen || workspaceMenuOpen) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setUserMenuOpen(false);
            setWorkspaceMenuOpen(false);
          }}
        />
      )}
    </div>
  );
}

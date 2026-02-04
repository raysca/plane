import { Outlet, useParams, Link, useNavigate } from "react-router";
import { useWorkspaceQuery, useWorkspacesQuery } from "@/core/hooks/queries";
import { useAppUIStore } from "@/core/store/ui";

export function WorkspaceLayout() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar } = useAppUIStore();

  const { data: workspace, isLoading: workspaceLoading } = useWorkspaceQuery(workspaceSlug || "");
  const { data: workspaces } = useWorkspacesQuery();

  if (workspaceLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-canvas">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-primary" />
          <span className="text-secondary">Loading workspace...</span>
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-screen bg-canvas">
        <div className="flex flex-col items-center gap-4">
          <span className="text-xl font-semibold text-primary">Workspace not found</span>
          <Link to="/" className="text-accent-primary hover:underline">
            Go back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-surface-1 border-r border-strong transition-all duration-200 ${
          sidebarCollapsed ? "w-16" : "w-64"
        }`}
      >
        {/* Workspace selector */}
        <div className="flex items-center gap-3 p-4 border-b border-strong">
          <div className="flex items-center justify-center w-8 h-8 rounded-md bg-accent-primary text-white font-semibold text-sm">
            {workspace.name.charAt(0).toUpperCase()}
          </div>
          {!sidebarCollapsed && (
            <div className="flex-1 min-w-0">
              <select
                value={workspaceSlug}
                onChange={(e) => navigate(`/${e.target.value}`)}
                className="w-full bg-transparent text-primary font-medium truncate focus:outline-none cursor-pointer"
              >
                {workspaces?.map((ws) => (
                  <option key={ws.id} value={ws.slug}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 overflow-y-auto">
          <ul className="space-y-1">
            <NavItem
              to={`/${workspaceSlug}`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                  />
                </svg>
              }
              label="Home"
              collapsed={sidebarCollapsed}
            />
            <NavItem
              to={`/${workspaceSlug}/projects`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
              }
              label="Projects"
              collapsed={sidebarCollapsed}
            />
            <NavItem
              to={`/${workspaceSlug}/active-cycles`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              }
              label="Active Cycles"
              collapsed={sidebarCollapsed}
            />
            <NavItem
              to={`/${workspaceSlug}/all-issues`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                  />
                </svg>
              }
              label="All Issues"
              collapsed={sidebarCollapsed}
            />
            <NavItem
              to={`/${workspaceSlug}/analytics`}
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
              }
              label="Analytics"
              collapsed={sidebarCollapsed}
            />
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-2 border-t border-strong">
          <button
            onClick={toggleSidebar}
            className="flex items-center justify-center w-full h-8 rounded-md hover:bg-layer-1 text-secondary transition-colors"
          >
            <svg
              className={`w-5 h-5 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
}

function NavItem({ to, icon, label, collapsed }: NavItemProps) {
  return (
    <li>
      <Link
        to={to}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-secondary hover:bg-layer-1 hover:text-primary transition-colors ${
          collapsed ? "justify-center" : ""
        }`}
        title={collapsed ? label : undefined}
      >
        {icon}
        {!collapsed && <span className="text-sm font-medium">{label}</span>}
      </Link>
    </li>
  );
}

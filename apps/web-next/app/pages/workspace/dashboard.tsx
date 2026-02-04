import { useParams } from "react-router";
import { useWorkspaceQuery } from "@/core/hooks/queries";

export function WorkspaceDashboardPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { data: workspace } = useWorkspaceQuery(workspaceSlug || "");

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-primary">Welcome back!</h1>
        <p className="text-secondary mt-1">
          Here's what's happening in <span className="font-medium">{workspace?.name}</span>
        </p>
      </div>

      {/* Widgets grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Assigned Issues Widget */}
        <div className="bg-surface-1 rounded-lg border border-strong p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-primary">Assigned to you</h2>
            <span className="text-sm text-tertiary">View all</span>
          </div>
          <div className="space-y-3">
            <EmptyState message="No issues assigned to you" />
          </div>
        </div>

        {/* Created Issues Widget */}
        <div className="bg-surface-1 rounded-lg border border-strong p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-primary">Created by you</h2>
            <span className="text-sm text-tertiary">View all</span>
          </div>
          <div className="space-y-3">
            <EmptyState message="No issues created by you" />
          </div>
        </div>

        {/* Recent Activity Widget */}
        <div className="bg-surface-1 rounded-lg border border-strong p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-primary">Recent Activity</h2>
          </div>
          <div className="space-y-3">
            <EmptyState message="No recent activity" />
          </div>
        </div>

        {/* Recent Projects Widget */}
        <div className="bg-surface-1 rounded-lg border border-strong p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium text-primary">Recent Projects</h2>
            <span className="text-sm text-tertiary">View all</span>
          </div>
          <div className="space-y-3">
            <EmptyState message="No projects yet. Create your first project!" />
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-primary mb-4">Quick Links</h2>
        <div className="flex flex-wrap gap-3">
          <QuickLink
            href={`/${workspaceSlug}/projects`}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
            }
            label="Create Project"
          />
          <QuickLink
            href={`/${workspaceSlug}/settings/members`}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
                />
              </svg>
            }
            label="Invite Members"
          />
          <QuickLink
            href={`/${workspaceSlug}/settings`}
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            }
            label="Workspace Settings"
          />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-tertiary">
      <span className="text-sm">{message}</span>
    </div>
  );
}

interface QuickLinkProps {
  href: string;
  icon: React.ReactNode;
  label: string;
}

function QuickLink({ href, icon, label }: QuickLinkProps) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 px-4 py-2 rounded-md bg-surface-1 border border-strong text-secondary hover:text-primary hover:border-accent-primary transition-colors"
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </a>
  );
}

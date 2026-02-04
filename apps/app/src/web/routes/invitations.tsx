import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/invitations")({
  component: InvitationsPage,
});

interface Invitation {
  id: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
    logo?: string;
  };
  role: string;
  invitedBy: {
    name: string;
    email: string;
  };
  createdAt: string;
}

function InvitationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: invitations, isLoading } = useQuery<Invitation[]>({
    queryKey: ["invitations"],
    queryFn: async () => {
      const response = await fetch("/api/users/me/invitations", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch invitations");
      }
      return response.json();
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await fetch(
        `/api/users/me/invitations/${invitationId}/accept`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      if (!response.ok) {
        throw new Error("Failed to accept invitation");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
      // Navigate to the workspace
      if (data.workspace?.slug) {
        navigate({
          to: "/$workspaceSlug",
          params: { workspaceSlug: data.workspace.slug },
        });
      }
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await fetch(
        `/api/users/me/invitations/${invitationId}/decline`,
        {
          method: "POST",
          credentials: "include",
        }
      );
      if (!response.ok) {
        throw new Error("Failed to decline invitation");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-custom-background-100">
        <svg
          className="animate-spin h-8 w-8 text-custom-text-300"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
    );
  }

  const hasInvitations = invitations && invitations.length > 0;

  return (
    <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
      <div className="w-full max-w-lg bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
        <div className="p-6 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-12 w-12 rounded-full bg-custom-primary-100/10 flex items-center justify-center">
              {/* Mail Icon */}
              <svg
                className="h-6 w-6 text-custom-primary-100"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-custom-text-100">
            Workspace Invitations
          </h1>
          <p className="text-sm text-custom-text-300 mt-1">
            {hasInvitations
              ? "You have pending invitations to join workspaces"
              : "You don't have any pending invitations"}
          </p>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {hasInvitations ? (
            <>
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-custom-border-200"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-custom-background-80 flex items-center justify-center text-custom-text-200">
                      {invitation.workspace.logo ? (
                        <img
                          src={invitation.workspace.logo}
                          alt={invitation.workspace.name}
                          className="h-10 w-10 rounded-full"
                        />
                      ) : (
                        invitation.workspace.name[0]?.toUpperCase()
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-custom-text-100">
                        {invitation.workspace.name}
                      </p>
                      <p className="text-sm text-custom-text-300">
                        Invited by {invitation.invitedBy.name} as{" "}
                        <span className="capitalize">{invitation.role}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => declineMutation.mutate(invitation.id)}
                      disabled={declineMutation.isPending}
                      className="h-9 w-9 flex items-center justify-center border border-custom-border-200 rounded-md bg-custom-background-100 hover:bg-custom-background-80 transition-colors disabled:opacity-50"
                    >
                      {declineMutation.isPending ? (
                        <svg
                          className="animate-spin h-4 w-4 text-custom-text-300"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="h-4 w-4 text-custom-text-200"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => acceptMutation.mutate(invitation.id)}
                      disabled={acceptMutation.isPending}
                      className="h-9 px-3 flex items-center justify-center bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors disabled:opacity-50"
                    >
                      {acceptMutation.isPending ? (
                        <svg
                          className="animate-spin h-4 w-4"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      ) : (
                        <>
                          <svg
                            className="h-4 w-4 mr-1"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Accept
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}

              <div className="border-t border-custom-border-200 pt-4">
                <div className="flex justify-center">
                  <Link to="/create-workspace">
                    <button
                      type="button"
                      className="h-10 px-4 rounded-md text-custom-text-200 hover:bg-custom-background-80 transition-colors"
                    >
                      Or create a new workspace
                    </button>
                  </Link>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center space-y-4">
              <p className="text-custom-text-300">
                When someone invites you to a workspace, it will appear here.
              </p>
              <div className="flex flex-col gap-2">
                <Link to="/create-workspace">
                  <button
                    type="button"
                    className="w-full h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
                  >
                    Create a workspace
                  </button>
                </Link>
                <Link to="/">
                  <button
                    type="button"
                    className="w-full h-10 px-4 rounded-md text-custom-text-200 hover:bg-custom-background-80 transition-colors"
                  >
                    Back to sign in
                  </button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

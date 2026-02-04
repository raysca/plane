import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/workspace-invitations")({
  component: WorkspaceInvitationsPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      token: (search.token as string) || "",
      workspaceSlug: (search.workspace as string) || "",
    };
  },
});

interface InvitationDetails {
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
}

function WorkspaceInvitationsPage() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInvitation() {
      if (!token) {
        setError("Invalid invitation link");
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/invitations/details?token=${encodeURIComponent(token)}`,
          { credentials: "include" }
        );

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || "Invalid or expired invitation");
        }

        const data = await response.json();
        setInvitation(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load invitation"
        );
      } finally {
        setIsLoading(false);
      }
    }

    fetchInvitation();
  }, [token]);

  async function handleAccept() {
    if (!token) return;

    setIsAccepting(true);
    try {
      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to accept invitation");
      }

      // Navigate to the workspace
      if (invitation?.workspace.slug) {
        navigate({
          to: "/$workspaceSlug",
          params: { workspaceSlug: invitation.workspace.slug },
        });
      } else {
        navigate({ to: "/" });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to accept invitation"
      );
    } finally {
      setIsAccepting(false);
    }
  }

  async function handleDecline() {
    if (!token) return;

    setIsDeclining(true);
    try {
      const response = await fetch("/api/invitations/decline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Failed to decline invitation");
      }

      navigate({ to: "/" });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to decline invitation"
      );
    } finally {
      setIsDeclining(false);
    }
  }

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

  if (error || !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
        <div className="w-full max-w-md bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
          <div className="p-6 text-center">
            <div className="flex justify-center mb-4">
              <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
                {/* Alert Circle Icon */}
                <svg
                  className="h-6 w-6 text-red-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
            </div>
            <h1 className="text-2xl font-bold text-custom-text-100">
              Invalid Invitation
            </h1>
            <p className="text-sm text-custom-text-300 mt-1">
              {error || "This invitation link is invalid or has expired."}
            </p>
          </div>
          <div className="px-6 pb-6">
            <button
              type="button"
              onClick={() => navigate({ to: "/" })}
              className="w-full h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
            >
              Go to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
      <div className="w-full max-w-md bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
        <div className="p-6 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-custom-background-80 flex items-center justify-center text-2xl text-custom-text-200">
              {invitation.workspace.logo ? (
                <img
                  src={invitation.workspace.logo}
                  alt={invitation.workspace.name}
                  className="h-16 w-16 rounded-full"
                />
              ) : (
                invitation.workspace.name[0]?.toUpperCase()
              )}
            </div>
          </div>
          <h1 className="text-2xl font-bold text-custom-text-100">
            Join {invitation.workspace.name}
          </h1>
          <p className="text-sm text-custom-text-300 mt-1">
            {invitation.invitedBy.name} has invited you to join as a{" "}
            <span className="capitalize font-medium">{invitation.role}</span>
          </p>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleDecline}
              disabled={isDeclining || isAccepting}
              className="flex-1 h-10 px-4 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 hover:bg-custom-background-80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isDeclining ? (
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
                    className="h-4 w-4 mr-2"
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
                  Decline
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={isAccepting || isDeclining}
              className="flex-1 h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isAccepting ? (
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
                    className="h-4 w-4 mr-2"
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
      </div>
    </div>
  );
}

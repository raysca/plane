import { Navigate, useLocation } from "react-router";
import { useCurrentUser } from "@/core/hooks/queries";

interface AuthGuardProps {
  children: React.ReactNode;
  /** If true, redirects authenticated users away (for login pages) */
  requireUnauthenticated?: boolean;
  /** Path to redirect to when not authenticated */
  redirectTo?: string;
  /** Path to redirect authenticated users to (when requireUnauthenticated is true) */
  authenticatedRedirect?: string;
}

/**
 * AuthGuard component that protects routes based on authentication state.
 *
 * Usage:
 * - Wrap protected routes: <AuthGuard><ProtectedPage /></AuthGuard>
 * - For login pages: <AuthGuard requireUnauthenticated><LoginPage /></AuthGuard>
 */
export function AuthGuard({
  children,
  requireUnauthenticated = false,
  redirectTo = "/",
  authenticatedRedirect = "/",
}: AuthGuardProps) {
  const location = useLocation();
  const { data: session, isLoading, isError } = useCurrentUser();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  const isAuthenticated = !!session?.user;

  // For pages that require unauthenticated users (login, signup)
  if (requireUnauthenticated) {
    if (isAuthenticated) {
      // Check if user needs onboarding
      const user = session.user as { isOnboarded?: boolean };
      if (user.isOnboarded === false) {
        return <Navigate to="/onboarding" replace />;
      }
      return <Navigate to={authenticatedRedirect} replace />;
    }
    return <>{children}</>;
  }

  // For protected pages that require authentication
  if (!isAuthenticated) {
    // Save the attempted URL for redirecting after login
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

/**
 * Higher-order component version of AuthGuard
 */
export function withAuthGuard<P extends object>(
  Component: React.ComponentType<P>,
  options?: Omit<AuthGuardProps, "children">
) {
  return function AuthGuardedComponent(props: P) {
    return (
      <AuthGuard {...options}>
        <Component {...props} />
      </AuthGuard>
    );
  };
}

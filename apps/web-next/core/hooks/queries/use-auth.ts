import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authClient, type Session } from "@/core/lib/auth-client";

// Query keys
export const authKeys = {
  all: ["auth"] as const,
  session: () => [...authKeys.all, "session"] as const,
  user: () => [...authKeys.all, "user"] as const,
};

/**
 * Hook to get current session/user
 * Uses TanStack Query for caching and automatic refetching
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: async () => {
      const result = await authClient.getSession();
      if (!result.data) {
        return null;
      }
      return result.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });
}

/**
 * Sign in with email and password
 */
export function useSignIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        throw new Error(result.error.message || "Sign in failed");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}

/**
 * Sign up with email and password
 */
export function useSignUp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      email,
      password,
      name,
    }: {
      email: string;
      password: string;
      name: string;
    }) => {
      const result = await authClient.signUp.email({ email, password, name });
      if (result.error) {
        throw new Error(result.error.message || "Sign up failed");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
    },
  });
}

/**
 * Sign out current user
 */
export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) {
        throw new Error(result.error.message || "Sign out failed");
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.setQueryData(authKeys.session(), null);
      queryClient.invalidateQueries({ queryKey: authKeys.all });
    },
  });
}

/**
 * Request password reset email
 * Uses the Better Auth forget-password endpoint directly
 */
export function useForgotPassword() {
  return useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      const response = await fetch("/api/auth/forget-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirectTo: "/accounts/reset-password",
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to send reset email");
      }

      return response.json();
    },
  });
}

/**
 * Reset password with token
 * Uses the Better Auth reset-password endpoint directly
 */
export function useResetPassword() {
  return useMutation({
    mutationFn: async ({ token, newPassword }: { token: string; newPassword: string }) => {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to reset password");
      }

      return response.json();
    },
  });
}

/**
 * Sign in with OAuth provider
 */
export function useOAuthSignIn() {
  return useMutation({
    mutationFn: async ({
      provider,
      callbackURL = "/",
    }: {
      provider: "google" | "github" | "gitlab";
      callbackURL?: string;
    }) => {
      const result = await authClient.signIn.social({ provider, callbackURL });
      if (result.error) {
        throw new Error(result.error.message || "OAuth sign in failed");
      }
      // OAuth will redirect, so we don't return anything useful here
      return result.data;
    },
  });
}

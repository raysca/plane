import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { CircleCheck, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  component: SignInPage,
  validateSearch: (search: Record<string, unknown>) => ({
    email: (search.email as string) || "",
    next_path: (search.next_path as string) || "",
  }),
});

type SignInFormValues = {
  email: string;
  password: string;
};

type InstanceConfig = {
  is_google_enabled: boolean;
  is_github_enabled: boolean;
  is_gitlab_enabled: boolean;
  is_magic_login_enabled: boolean;
  is_email_password_enabled: boolean;
  enable_signup: boolean;
};

function SignInPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authStep, setAuthStep] = useState<"email" | "password">("email");
  const [instanceConfig, setInstanceConfig] = useState<InstanceConfig | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<SignInFormValues>({
    defaultValues: {
      email: search.email || "",
      password: "",
    },
  });

  const email = watch("email");

  // Fetch instance config on mount
  useEffect(() => {
    async function fetchInstanceConfig() {
      try {
        const response = await fetch("/api/instances/");
        if (response.ok) {
          const data = await response.json();
          setInstanceConfig(data.config);
        }
      } catch (err) {
        console.error("Failed to fetch instance config:", err);
      }
    }
    fetchInstanceConfig();
  }, []);

  async function handleEmailSubmit(data: SignInFormValues) {
    if (!data.email) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/email-check/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.existing || result.status === "CREDENTIAL") {
          setAuthStep("password");
        } else {
          navigate({ to: "/sign-up", search: { email: data.email } });
        }
      } else {
        setAuthStep("password");
      }
    } catch {
      setAuthStep("password");
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePasswordSubmit(data: SignInFormValues) {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Invalid email or password");
      }

      const nextPath = search.next_path || "/onboarding";
      window.location.href = nextPath;
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  function handleOAuthSignIn(provider: "google" | "github" | "gitlab") {
    window.location.href = `/api/auth/${provider}/`;
  }

  // Check if any OAuth provider is enabled
  const hasOAuthEnabled =
    instanceConfig?.is_google_enabled ||
    instanceConfig?.is_github_enabled ||
    instanceConfig?.is_gitlab_enabled;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-custom-background-100">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-custom-primary-100/20 via-custom-background-100 to-custom-background-100" />

      {/* Content */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 py-8">
        {/* Logo */}
        <div className="mb-8">
          <svg className="h-12 w-12 text-custom-primary-100" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L2 7L12 12L22 7L12 2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 17L12 22L22 17"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 12L12 17L22 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* Auth card */}
        <div className="w-full max-w-[400px] rounded-xl border border-custom-border-200 bg-custom-background-100 p-6 shadow-lg">
          <div className="mb-6 text-center">
            <h1 className="text-xl font-semibold text-custom-text-100">
              {authStep === "email" ? "Welcome to Plane" : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-custom-text-400">
              {authStep === "email"
                ? "Enter your email to get started"
                : "Enter your password to sign in"}
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-500">
              {error}
            </div>
          )}

          {authStep === "email" ? (
            <>
              {/* OAuth buttons - only show if enabled */}
              {hasOAuthEnabled && (
                <>
                  <div className="flex gap-3 mb-4">
                    {instanceConfig?.is_google_enabled && (
                      <button
                        type="button"
                        onClick={() => handleOAuthSignIn("google")}
                        className="flex-1 flex items-center justify-center gap-2 rounded-md border border-custom-border-200 bg-custom-background-100 px-4 py-2.5 text-sm font-medium text-custom-text-200 hover:bg-custom-background-80 transition-colors"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Google
                      </button>
                    )}
                    {instanceConfig?.is_github_enabled && (
                      <button
                        type="button"
                        onClick={() => handleOAuthSignIn("github")}
                        className="flex-1 flex items-center justify-center gap-2 rounded-md border border-custom-border-200 bg-custom-background-100 px-4 py-2.5 text-sm font-medium text-custom-text-200 hover:bg-custom-background-80 transition-colors"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                        </svg>
                        GitHub
                      </button>
                    )}
                    {instanceConfig?.is_gitlab_enabled && (
                      <button
                        type="button"
                        onClick={() => handleOAuthSignIn("gitlab")}
                        className="flex-1 flex items-center justify-center gap-2 rounded-md border border-custom-border-200 bg-custom-background-100 px-4 py-2.5 text-sm font-medium text-custom-text-200 hover:bg-custom-background-80 transition-colors"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" fill="#E24329"/>
                        </svg>
                        GitLab
                      </button>
                    )}
                  </div>

                  <div className="relative my-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-custom-border-200" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-custom-background-100 px-2 text-custom-text-400">or</span>
                    </div>
                  </div>
                </>
              )}

              {/* Email form */}
              <form onSubmit={handleSubmit(handleEmailSubmit)} className="space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-custom-text-200">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    className="w-full rounded-md border border-custom-border-200 bg-custom-background-100 px-3 py-2.5 text-sm text-custom-text-100 placeholder:text-custom-text-400 focus:border-custom-primary-100 focus:outline-none focus:ring-1 focus:ring-custom-primary-100"
                    {...register("email", {
                      required: "Email is required",
                      pattern: {
                        value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                        message: "Invalid email address",
                      },
                    })}
                  />
                  {errors.email && (
                    <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-md bg-custom-primary-100 px-4 py-2.5 text-sm font-medium text-white hover:bg-custom-primary-200 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Please wait...
                    </span>
                  ) : (
                    "Continue"
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Email display */}
              <div className="mb-4 flex items-center justify-between rounded-md bg-custom-background-80 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <CircleCheck className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-custom-text-200">{email}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAuthStep("email")}
                  className="text-sm text-custom-primary-100 hover:underline"
                >
                  Change
                </button>
              </div>

              {/* Password form */}
              <form onSubmit={handleSubmit(handlePasswordSubmit)} className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="password" className="text-sm font-medium text-custom-text-200">
                      Password
                    </label>
                    <Link
                      to="/accounts/forgot-password"
                      search={{ email }}
                      className="text-sm text-custom-primary-100 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <input
                    id="password"
                    type="password"
                    placeholder="Enter your password"
                    className="w-full rounded-md border border-custom-border-200 bg-custom-background-100 px-3 py-2.5 text-sm text-custom-text-100 placeholder:text-custom-text-400 focus:border-custom-primary-100 focus:outline-none focus:ring-1 focus:ring-custom-primary-100"
                    {...register("password", {
                      required: "Password is required",
                      minLength: {
                        value: 8,
                        message: "Password must be at least 8 characters",
                      },
                    })}
                  />
                  {errors.password && (
                    <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full rounded-md bg-custom-primary-100 px-4 py-2.5 text-sm font-medium text-white hover:bg-custom-primary-200 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in...
                    </span>
                  ) : (
                    "Sign in"
                  )}
                </button>
              </form>
            </>
          )}

          {/* Sign up link - only show if signup is enabled */}
          {instanceConfig?.enable_signup !== false && (
            <div className="mt-6 text-center text-sm text-custom-text-400">
              Don't have an account?{" "}
              <Link to="/sign-up" className="text-custom-primary-100 hover:underline">
                Sign up
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SignInPage;

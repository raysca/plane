import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/sign-up")({
  component: SignUpPage,
});

type InstanceConfig = {
  is_google_enabled: boolean;
  is_github_enabled: boolean;
  is_gitlab_enabled: boolean;
  is_magic_login_enabled: boolean;
  is_email_password_enabled: boolean;
  enable_signup: boolean;
};

type SignUpFormValues = {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  acceptTerms: boolean;
};

function SignUpPage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instanceConfig, setInstanceConfig] = useState<InstanceConfig | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<SignUpFormValues>({
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
      acceptTerms: false,
    },
  });

  const password = watch("password");

  useEffect(() => {
    async function fetchInstanceConfig() {
      try {
        const response = await fetch("/api/instances/");
        if (response.ok) {
          const data = await response.json();
          setInstanceConfig(data.config);
          // Redirect to sign-in if signup is disabled
          if (!data.config?.enable_signup) {
            navigate({ to: "/" });
          }
        }
      } catch (err) {
        console.error("Failed to fetch instance config:", err);
      }
    }
    fetchInstanceConfig();
  }, [navigate]);

  async function onSubmit(data: SignUpFormValues) {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: data.email,
          password: data.password,
          first_name: data.firstName,
          last_name: data.lastName,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create account");
      }

      // Redirect to onboarding
      navigate({ to: "/onboarding" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleOAuthSignIn(provider: "google" | "github" | "gitlab") {
    window.location.href = `/api/auth/sign-in/social?provider=${provider}`;
  }

  const hasOAuthEnabled =
    instanceConfig?.is_google_enabled ||
    instanceConfig?.is_github_enabled ||
    instanceConfig?.is_gitlab_enabled;

  return (
    <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
      <div className="w-full max-w-md bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
        {/* Header */}
        <div className="p-6 pb-0 text-center space-y-1">
          <div className="flex justify-center mb-4">
            <svg
              className="h-10 w-10 text-custom-text-100"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
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
          <h1 className="text-2xl font-bold text-custom-text-100">
            Create an account
          </h1>
          <p className="text-sm text-custom-text-300">
            Get started with Plane today
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* OAuth Buttons */}
          {hasOAuthEnabled && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {instanceConfig?.is_google_enabled && (
                  <button
                    type="button"
                    onClick={() => handleOAuthSignIn("google")}
                    disabled={isLoading}
                    className="flex items-center justify-center h-10 px-4 border border-custom-border-200 rounded-md bg-custom-background-100 hover:bg-custom-background-80 transition-colors disabled:opacity-50"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                  </button>
                )}
                {instanceConfig?.is_github_enabled && (
                  <button
                    type="button"
                    onClick={() => handleOAuthSignIn("github")}
                    disabled={isLoading}
                    className="flex items-center justify-center h-10 px-4 border border-custom-border-200 rounded-md bg-custom-background-100 hover:bg-custom-background-80 transition-colors disabled:opacity-50"
                  >
                    <svg
                      className="h-4 w-4 text-custom-text-100"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                      />
                    </svg>
                  </button>
                )}
                {instanceConfig?.is_gitlab_enabled && (
                  <button
                    type="button"
                    onClick={() => handleOAuthSignIn("gitlab")}
                    disabled={isLoading}
                    className="flex items-center justify-center h-10 px-4 border border-custom-border-200 rounded-md bg-custom-background-100 hover:bg-custom-background-80 transition-colors disabled:opacity-50"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="#E24329"
                    >
                      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-custom-border-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-custom-background-100 px-2 text-custom-text-400">
                    Or continue with email
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Sign Up Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                {error}
              </div>
            )}

            {/* Name fields */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label
                  htmlFor="firstName"
                  className="text-sm font-medium text-custom-text-200"
                >
                  First name
                </label>
                <input
                  id="firstName"
                  type="text"
                  placeholder="John"
                  autoComplete="given-name"
                  className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                  {...register("firstName", {
                    required: "First name is required",
                  })}
                />
                {errors.firstName && (
                  <p className="text-sm text-red-600">
                    {errors.firstName.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="lastName"
                  className="text-sm font-medium text-custom-text-200"
                >
                  Last name
                </label>
                <input
                  id="lastName"
                  type="text"
                  placeholder="Doe"
                  autoComplete="family-name"
                  className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                  {...register("lastName")}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium text-custom-text-200"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                {...register("email", {
                  required: "Email is required",
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: "Invalid email address",
                  },
                })}
              />
              {errors.email && (
                <p className="text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium text-custom-text-200"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                placeholder="Create a password"
                autoComplete="new-password"
                className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                {...register("password", {
                  required: "Password is required",
                  minLength: {
                    value: 8,
                    message: "Password must be at least 8 characters",
                  },
                })}
              />
              {errors.password && (
                <p className="text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="confirmPassword"
                className="text-sm font-medium text-custom-text-200"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                placeholder="Confirm your password"
                autoComplete="new-password"
                className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                {...register("confirmPassword", {
                  required: "Please confirm your password",
                  validate: (value) =>
                    value === password || "Passwords don't match",
                })}
              />
              {errors.confirmPassword && (
                <p className="text-sm text-red-600">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <div className="flex items-start space-x-3">
              <input
                id="acceptTerms"
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-custom-border-200 text-custom-primary-100 focus:ring-custom-primary-100"
                {...register("acceptTerms", {
                  required: "You must accept the terms and conditions",
                })}
              />
              <label
                htmlFor="acceptTerms"
                className="text-sm text-custom-text-200"
              >
                I agree to the{" "}
                <a
                  href="/terms"
                  className="text-custom-primary-100 hover:underline"
                  target="_blank"
                >
                  Terms of Service
                </a>{" "}
                and{" "}
                <a
                  href="/privacy"
                  className="text-custom-primary-100 hover:underline"
                  target="_blank"
                >
                  Privacy Policy
                </a>
              </label>
            </div>
            {errors.acceptTerms && (
              <p className="text-sm text-red-600">{errors.acceptTerms.message}</p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {isLoading ? (
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
                "Create account"
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-center">
          <p className="text-sm text-custom-text-300">
            Already have an account?{" "}
            <Link to="/" className="text-custom-primary-100 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

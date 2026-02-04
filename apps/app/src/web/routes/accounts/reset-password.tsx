import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useState } from "react";

export const Route = createFileRoute("/accounts/reset-password")({
  component: ResetPasswordPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      token: (search.token as string) || "",
    };
  },
});

type ResetPasswordFormValues = {
  password: string;
  confirmPassword: string;
};

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const password = watch("password");

  // Check if token is provided
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
        <div className="w-full max-w-md bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
          <div className="p-6 text-center space-y-1">
            <div className="flex justify-center mb-4">
              {/* X Circle Icon */}
              <svg
                className="h-12 w-12 text-red-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-custom-text-100">
              Invalid link
            </h1>
            <p className="text-sm text-custom-text-300">
              This password reset link is invalid or has expired.
            </p>
          </div>
          <div className="px-6 pb-6">
            <Link to="/accounts/forgot-password">
              <button
                type="button"
                className="w-full h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
              >
                Request a new link
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  async function onSubmit(data: ResetPasswordFormValues) {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          newPassword: data.password,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to reset password");
      }

      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
        <div className="w-full max-w-md bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
          <div className="p-6 text-center space-y-1">
            <div className="flex justify-center mb-4">
              {/* Check Circle Icon */}
              <svg
                className="h-12 w-12 text-green-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-custom-text-100">
              Password reset successful
            </h1>
            <p className="text-sm text-custom-text-300">
              Your password has been reset. You can now sign in with your new
              password.
            </p>
          </div>
          <div className="px-6 pb-6">
            <Link to="/">
              <button
                type="button"
                className="w-full h-10 px-4 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
              >
                Sign in
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
      <div className="w-full max-w-md bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
        <div className="p-6 pb-0 text-center space-y-1">
          <h1 className="text-2xl font-bold text-custom-text-100">
            Reset your password
          </h1>
          <p className="text-sm text-custom-text-300">
            Enter your new password below
          </p>
        </div>

        <div className="p-6 space-y-4">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium text-custom-text-200"
              >
                New password
              </label>
              <input
                id="password"
                type="password"
                placeholder="Enter new password"
                autoComplete="new-password"
                className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                {...register("password", {
                  required: "Password is required",
                  minLength: {
                    value: 8,
                    message: "Password must be at least 8 characters",
                  },
                  pattern: {
                    value: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
                    message:
                      "Password must contain at least one uppercase letter, one lowercase letter, and one number",
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
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                placeholder="Confirm new password"
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
                "Reset password"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

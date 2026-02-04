import { createFileRoute, Link } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useState } from "react";

export const Route = createFileRoute("/accounts/forgot-password")({
  component: ForgotPasswordPage,
});

type ForgotPasswordFormValues = {
  email: string;
};

function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEmailSent, setIsEmailSent] = useState(false);

  const {
    register,
    handleSubmit,
    getValues,
    reset,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(data: ForgotPasswordFormValues) {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/forget-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: data.email,
          redirectTo: `${window.location.origin}/accounts/reset-password`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to send reset email");
      }

      setIsEmailSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  if (isEmailSent) {
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
              Check your email
            </h1>
            <p className="text-sm text-custom-text-300">
              We've sent a password reset link to{" "}
              <span className="font-medium text-custom-text-100">
                {getValues("email")}
              </span>
            </p>
          </div>

          <div className="px-6 pb-6 space-y-4">
            <p className="text-sm text-custom-text-300 text-center">
              If you don't see the email, check your spam folder. The link will
              expire in 5 minutes.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsEmailSent(false);
                  reset();
                }}
                className="w-full h-10 px-4 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 hover:bg-custom-background-80 transition-colors"
              >
                Try a different email
              </button>
              <Link to="/">
                <button
                  type="button"
                  className="w-full h-10 px-4 rounded-md text-custom-text-200 hover:bg-custom-background-80 transition-colors flex items-center justify-center"
                >
                  {/* Arrow Left Icon */}
                  <svg
                    className="mr-2 h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    />
                  </svg>
                  Back to sign in
                </button>
              </Link>
            </div>
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
            Forgot password?
          </h1>
          <p className="text-sm text-custom-text-300">
            Enter your email and we'll send you a reset link
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
                "Send reset link"
              )}
            </button>
          </form>

          <Link to="/">
            <button
              type="button"
              className="w-full h-10 px-4 rounded-md text-custom-text-200 hover:bg-custom-background-80 transition-colors flex items-center justify-center"
            >
              {/* Arrow Left Icon */}
              <svg
                className="mr-2 h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Back to sign in
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

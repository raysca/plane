import { useState } from "react";
import { useForm } from "react-hook-form";
import { useResetPassword } from "@/core/hooks/queries";
import { useSearchParams, useNavigate } from "react-router";

interface ResetPasswordFormData {
  password: string;
  confirmPassword: string;
}

export function ResetPasswordForm() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [success, setSuccess] = useState(false);
  const resetPassword = useResetPassword();

  const token = searchParams.get("token");

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormData>();

  const password = watch("password");

  const onSubmit = async (data: ResetPasswordFormData) => {
    if (!token) return;

    try {
      await resetPassword.mutateAsync({
        token,
        newPassword: data.password,
      });
      setSuccess(true);
    } catch (error) {
      // Error is handled by mutation
    }
  };

  if (!token) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
          <svg
            className="h-6 w-6 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900">Invalid reset link</h3>
        <p className="mt-2 text-sm text-gray-500">
          This password reset link is invalid or has expired.
        </p>
        <a
          href="/accounts/forgot-password"
          className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-500"
        >
          Request a new link
        </a>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-6 w-6 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900">Password reset successful</h3>
        <p className="mt-2 text-sm text-gray-500">
          Your password has been reset. You can now sign in with your new password.
        </p>
        <button
          onClick={() => navigate("/")}
          className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <p className="mb-4 text-sm text-gray-600">Enter your new password below.</p>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          New Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          {...register("password", {
            required: "Password is required",
            minLength: {
              value: 8,
              message: "Password must be at least 8 characters",
            },
          })}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
          Confirm New Password
        </label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          {...register("confirmPassword", {
            required: "Please confirm your password",
            validate: (value) => value === password || "Passwords do not match",
          })}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.confirmPassword && (
          <p className="mt-1 text-sm text-red-600">{errors.confirmPassword.message}</p>
        )}
      </div>

      {resetPassword.error && (
        <div className="rounded-md bg-red-50 p-3">
          <p className="text-sm text-red-700">{resetPassword.error.message}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || resetPassword.isPending}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {resetPassword.isPending ? "Resetting..." : "Reset password"}
      </button>
    </form>
  );
}

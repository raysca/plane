import { useState } from "react";
import { useForm } from "react-hook-form";
import { useForgotPassword } from "@/core/hooks/queries";

interface ForgotPasswordFormData {
  email: string;
}

export function ForgotPasswordForm() {
  const [emailSent, setEmailSent] = useState(false);
  const forgotPassword = useForgotPassword();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormData>();

  const onSubmit = async (data: ForgotPasswordFormData) => {
    try {
      await forgotPassword.mutateAsync(data);
      setEmailSent(true);
    } catch (error) {
      // Error is handled by mutation
    }
  };

  if (emailSent) {
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
        <h3 className="text-lg font-medium text-gray-900">Check your email</h3>
        <p className="mt-2 text-sm text-gray-500">
          We've sent a password reset link to your email address. Please check your inbox.
        </p>
        <a href="/" className="mt-4 inline-block text-sm text-blue-600 hover:text-blue-500">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <p className="mb-4 text-sm text-gray-600">
          Enter your email address and we'll send you a link to reset your password.
        </p>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          {...register("email", {
            required: "Email is required",
            pattern: {
              value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
              message: "Invalid email address",
            },
          })}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>}
      </div>

      {forgotPassword.error && (
        <div className="rounded-md bg-red-50 p-3">
          <p className="text-sm text-red-700">{forgotPassword.error.message}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || forgotPassword.isPending}
        className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
      >
        {forgotPassword.isPending ? "Sending..." : "Send reset link"}
      </button>

      <p className="text-center text-sm text-gray-600">
        Remember your password?{" "}
        <a href="/" className="text-blue-600 hover:text-blue-500">
          Sign in
        </a>
      </p>
    </form>
  );
}

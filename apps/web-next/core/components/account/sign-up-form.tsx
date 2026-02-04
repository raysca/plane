import { useForm } from "react-hook-form";
import { useSignUp } from "@/core/hooks/queries";
import { useNavigate } from "react-router";

interface SignUpFormData {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface SignUpFormProps {
  onToggleMode?: () => void;
}

export function SignUpForm({ onToggleMode }: SignUpFormProps) {
  const navigate = useNavigate();
  const signUp = useSignUp();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormData>();

  const password = watch("password");

  const onSubmit = async (data: SignUpFormData) => {
    try {
      await signUp.mutateAsync({
        name: data.name,
        email: data.email,
        password: data.password,
      });
      navigate("/onboarding");
    } catch (error) {
      // Error is handled by mutation
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 w-full">
      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm font-medium text-secondary">
          Full Name
        </label>
        <div
          className={`relative flex items-center rounded-md bg-surface-1 border ${
            errors.name ? "border-danger-strong" : "border-strong"
          }`}
        >
          <input
            id="name"
            type="text"
            autoComplete="name"
            placeholder="John Doe"
            {...register("name", {
              required: "Name is required",
              minLength: {
                value: 2,
                message: "Name must be at least 2 characters",
              },
            })}
            className="disable-autofill-style h-10 w-full px-3 rounded-md bg-transparent placeholder:text-placeholder border-0 focus:outline-none text-primary"
          />
        </div>
        {errors.name && <p className="text-xs text-danger-strong">{errors.name.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-secondary">
          Email
        </label>
        <div
          className={`relative flex items-center rounded-md bg-surface-1 border ${
            errors.email ? "border-danger-strong" : "border-strong"
          }`}
        >
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            {...register("email", {
              required: "Email is required",
              pattern: {
                value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                message: "Invalid email address",
              },
            })}
            className="disable-autofill-style h-10 w-full px-3 rounded-md bg-transparent placeholder:text-placeholder border-0 focus:outline-none text-primary"
          />
        </div>
        {errors.email && <p className="text-xs text-danger-strong">{errors.email.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-secondary">
          Password
        </label>
        <div
          className={`relative flex items-center rounded-md bg-surface-1 border ${
            errors.password ? "border-danger-strong" : "border-strong"
          }`}
        >
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a password"
            {...register("password", {
              required: "Password is required",
              minLength: {
                value: 8,
                message: "Password must be at least 8 characters",
              },
            })}
            className="disable-autofill-style h-10 w-full px-3 rounded-md bg-transparent placeholder:text-placeholder border-0 focus:outline-none text-primary"
          />
        </div>
        {errors.password && <p className="text-xs text-danger-strong">{errors.password.message}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirmPassword" className="text-sm font-medium text-secondary">
          Confirm Password
        </label>
        <div
          className={`relative flex items-center rounded-md bg-surface-1 border ${
            errors.confirmPassword ? "border-danger-strong" : "border-strong"
          }`}
        >
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Confirm your password"
            {...register("confirmPassword", {
              required: "Please confirm your password",
              validate: (value) => value === password || "Passwords do not match",
            })}
            className="disable-autofill-style h-10 w-full px-3 rounded-md bg-transparent placeholder:text-placeholder border-0 focus:outline-none text-primary"
          />
        </div>
        {errors.confirmPassword && (
          <p className="text-xs text-danger-strong">{errors.confirmPassword.message}</p>
        )}
      </div>

      {signUp.error && (
        <div className="rounded-md bg-danger-muted p-3">
          <p className="text-sm text-danger-strong">{signUp.error.message}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || signUp.isPending}
        className="w-full h-10 rounded-md bg-accent-primary text-white font-medium hover:bg-accent-primary/90 focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {signUp.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Creating account...
          </span>
        ) : (
          "Create account"
        )}
      </button>

      {onToggleMode && (
        <p className="text-center text-sm text-tertiary">
          Already have an account?{" "}
          <button
            type="button"
            onClick={onToggleMode}
            className="text-accent-primary hover:text-accent-primary/80 transition-colors"
          >
            Sign in
          </button>
        </p>
      )}
    </form>
  );
}

import { useForm } from "react-hook-form";
import { useSignIn } from "@/core/hooks/queries";
import { useNavigate } from "react-router";

interface SignInFormData {
  email: string;
  password: string;
}

interface SignInFormProps {
  onToggleMode?: () => void;
}

export function SignInForm({ onToggleMode }: SignInFormProps) {
  const navigate = useNavigate();
  const signIn = useSignIn();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInFormData>();

  const onSubmit = async (data: SignInFormData) => {
    try {
      await signIn.mutateAsync(data);
      navigate("/");
    } catch (error) {
      // Error is handled by mutation
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 w-full">
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
            autoComplete="current-password"
            placeholder="Enter your password"
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

      {signIn.error && (
        <div className="rounded-md bg-danger-muted p-3">
          <p className="text-sm text-danger-strong">{signIn.error.message}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || signIn.isPending}
        className="w-full h-10 rounded-md bg-accent-primary text-white font-medium hover:bg-accent-primary/90 focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {signIn.isPending ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Signing in...
          </span>
        ) : (
          "Continue"
        )}
      </button>

      <div className="flex items-center justify-between text-sm">
        <a href="/accounts/forgot-password" className="text-accent-primary hover:text-accent-primary/80 transition-colors">
          Forgot password?
        </a>
        {onToggleMode && (
          <button
            type="button"
            onClick={onToggleMode}
            className="text-accent-primary hover:text-accent-primary/80 transition-colors"
          >
            Create an account
          </button>
        )}
      </div>
    </form>
  );
}

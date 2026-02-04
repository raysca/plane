import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { useCreateWorkspaceMutation } from "@/core/hooks/queries";

interface CreateWorkspaceFormData {
  name: string;
  slug: string;
}

export function CreateWorkspacePage() {
  const navigate = useNavigate();
  const createWorkspace = useCreateWorkspaceMutation();
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateWorkspaceFormData>({
    defaultValues: {
      name: "",
      slug: "",
    },
  });

  const name = watch("name");

  // Auto-generate slug from name unless manually edited
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (!slugManuallyEdited) {
      const generatedSlug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      setValue("slug", generatedSlug);
    }
  };

  const onSubmit = async (data: CreateWorkspaceFormData) => {
    try {
      const workspace = await createWorkspace.mutateAsync(data);
      navigate(`/${workspace.slug}`);
    } catch (error) {
      // Error handled by mutation
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-6">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-accent-primary">
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
            <span className="text-2xl font-semibold text-primary">Plane</span>
          </div>
          <h1 className="text-xl font-semibold text-primary">Create a new workspace</h1>
          <p className="text-secondary mt-2">
            Workspaces are shared environments where teams can collaborate on projects.
          </p>
        </div>

        {/* Form */}
        <div className="bg-surface-1 rounded-lg border border-strong p-6">
          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
            {/* Workspace name */}
            <div className="flex flex-col gap-1">
              <label htmlFor="name" className="text-sm font-medium text-secondary">
                Workspace name
              </label>
              <div
                className={`relative flex items-center rounded-md bg-canvas border ${
                  errors.name ? "border-danger-strong" : "border-strong"
                }`}
              >
                <input
                  id="name"
                  type="text"
                  placeholder="My Workspace"
                  {...register("name", {
                    required: "Workspace name is required",
                    minLength: {
                      value: 2,
                      message: "Name must be at least 2 characters",
                    },
                    maxLength: {
                      value: 80,
                      message: "Name must be less than 80 characters",
                    },
                  })}
                  onChange={(e) => {
                    register("name").onChange(e);
                    handleNameChange(e);
                  }}
                  className="disable-autofill-style h-10 w-full px-3 rounded-md bg-transparent placeholder:text-placeholder border-0 focus:outline-none text-primary"
                />
              </div>
              {errors.name && <p className="text-xs text-danger-strong">{errors.name.message}</p>}
            </div>

            {/* Workspace URL */}
            <div className="flex flex-col gap-1">
              <label htmlFor="slug" className="text-sm font-medium text-secondary">
                Workspace URL
              </label>
              <div
                className={`relative flex items-center rounded-md bg-canvas border ${
                  errors.slug ? "border-danger-strong" : "border-strong"
                }`}
              >
                <span className="pl-3 text-tertiary text-sm">plane.so/</span>
                <input
                  id="slug"
                  type="text"
                  placeholder="my-workspace"
                  {...register("slug", {
                    required: "URL is required",
                    minLength: {
                      value: 2,
                      message: "URL must be at least 2 characters",
                    },
                    maxLength: {
                      value: 48,
                      message: "URL must be less than 48 characters",
                    },
                    pattern: {
                      value: /^[a-z0-9-]+$/,
                      message: "URL can only contain lowercase letters, numbers, and dashes",
                    },
                  })}
                  onChange={(e) => {
                    register("slug").onChange(e);
                    setSlugManuallyEdited(true);
                  }}
                  className="disable-autofill-style h-10 w-full px-1 rounded-md bg-transparent placeholder:text-placeholder border-0 focus:outline-none text-primary"
                />
              </div>
              {errors.slug && <p className="text-xs text-danger-strong">{errors.slug.message}</p>}
            </div>

            {/* Error message */}
            {createWorkspace.error && (
              <div className="rounded-md bg-danger-muted p-3">
                <p className="text-sm text-danger-strong">{createWorkspace.error.message}</p>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSubmitting || createWorkspace.isPending}
              className="w-full h-10 rounded-md bg-accent-primary text-white font-medium hover:bg-accent-primary/90 focus:outline-none focus:ring-2 focus:ring-accent-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {createWorkspace.isPending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Creating...
                </span>
              ) : (
                "Create Workspace"
              )}
            </button>

            {/* Back link */}
            <p className="text-center text-sm text-tertiary">
              <a href="/" className="text-accent-primary hover:text-accent-primary/80 transition-colors">
                ← Back to home
              </a>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

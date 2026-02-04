import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/create-workspace")({
  component: CreateWorkspacePage,
});

type WorkspaceFormValues = {
  name: string;
  slug: string;
};

function CreateWorkspacePage() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [isCheckingSlug, setIsCheckingSlug] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError: setFormError,
    formState: { errors },
  } = useForm<WorkspaceFormValues>({
    defaultValues: {
      name: "",
      slug: "",
    },
  });

  const name = watch("name");
  const slug = watch("slug");

  // Generate slug from name
  const handleNameChange = (nameValue: string) => {
    const generatedSlug = nameValue
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    setValue("slug", generatedSlug);
  };

  // Check slug availability
  useEffect(() => {
    if (!slug || slug.length < 2) {
      setSlugAvailable(null);
      return;
    }

    const checkSlug = async () => {
      setIsCheckingSlug(true);
      try {
        const response = await fetch(
          `/api/workspace-slug-check?slug=${encodeURIComponent(slug)}`
        );
        if (!response.ok) {
          setSlugAvailable(null);
          return;
        }
        const data = await response.json();
        setSlugAvailable(data.status);
      } catch {
        setSlugAvailable(null);
      } finally {
        setIsCheckingSlug(false);
      }
    };

    const debounce = setTimeout(checkSlug, 500);
    return () => clearTimeout(debounce);
  }, [slug]);

  async function onSubmit(data: WorkspaceFormValues) {
    if (!slugAvailable) {
      setFormError("slug", { message: "This URL is already taken" });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/workspaces/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: data.name,
          slug: data.slug,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create workspace");
      }

      const workspace = await response.json();

      // Navigate to the new workspace
      navigate({
        to: "/$workspaceSlug",
        params: { workspaceSlug: workspace.slug },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-custom-background-100 p-4">
      <div className="w-full max-w-md bg-custom-background-100 border border-custom-border-200 rounded-lg shadow-sm">
        <div className="p-6 text-center">
          <h1 className="text-2xl font-bold text-custom-text-100">
            Create a workspace
          </h1>
          <p className="text-sm text-custom-text-300 mt-1">
            Workspaces are shared environments where teams collaborate on
            projects
          </p>
        </div>

        <div className="px-6 pb-6">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                {error}
              </div>
            )}

            {/* Workspace Logo Placeholder */}
            <div className="flex justify-center">
              <div className="h-20 w-20 rounded-full bg-custom-primary-100/10 flex items-center justify-center text-2xl text-custom-primary-100">
                {name?.[0]?.toUpperCase() || "W"}
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="name"
                className="text-sm font-medium text-custom-text-200"
              >
                Workspace name
              </label>
              <input
                id="name"
                type="text"
                placeholder="Acme Inc."
                className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                {...register("name", {
                  required: "Name is required",
                  minLength: {
                    value: 2,
                    message: "Name must be at least 2 characters",
                  },
                  onChange: (e) => handleNameChange(e.target.value),
                })}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="slug"
                className="text-sm font-medium text-custom-text-200"
              >
                Workspace URL
              </label>
              <div className="relative flex items-center">
                <input
                  id="slug"
                  type="text"
                  placeholder="acme"
                  className="flex-1 h-10 px-3 border border-custom-border-200 rounded-r-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                  {...register("slug", {
                    required: "Slug is required",
                    minLength: {
                      value: 2,
                      message: "Slug must be at least 2 characters",
                    },
                    pattern: {
                      value: /^[a-z0-9-]+$/,
                      message:
                        "Slug can only contain lowercase letters, numbers, and hyphens",
                    },
                  })}
                />
                {slug && slug.length >= 2 && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {isCheckingSlug ? (
                      <svg
                        className="animate-spin h-4 w-4 text-custom-text-300"
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
                    ) : slugAvailable === true ? (
                      <svg
                        className="h-4 w-4 text-green-500"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : slugAvailable === false ? (
                      <svg
                        className="h-4 w-4 text-red-500"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    ) : null}
                  </div>
                )}
              </div>
              <p className="text-sm text-custom-text-400">
                This will be your workspace's unique URL
              </p>
              {errors.slug && (
                <p className="text-sm text-red-600">{errors.slug.message}</p>
              )}
              {slugAvailable === false && (
                <p className="text-sm text-red-600">This URL is already taken</p>
              )}
            </div>

            <button
              type="submit"
              disabled={
                isLoading || slugAvailable === false || isCheckingSlug
              }
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
                "Create workspace"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  FolderKanban,
  Plus,
  Search,
  Grid3X3,
  List,
  X,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/$workspaceSlug/projects/")({
  component: ProjectsListPage,
  validateSearch: (search: Record<string, unknown>) => ({
    create: search.create === true || search.create === "true",
    view: (search.view as "grid" | "list") || "grid",
  }),
});

type Project = {
  id: string;
  name: string;
  identifier: string;
  description: string;
  logo_props: Record<string, unknown>;
  network: number;
  created_at: string;
  total_members?: number;
  member_role?: number | null;
  is_favorite?: boolean;
};

type CreateProjectForm = {
  name: string;
  identifier: string;
  description: string;
  network: number;
};

function ProjectsListPage() {
  const { workspaceSlug } = Route.useParams();
  const { create, view } = Route.useSearch();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(create || false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<CreateProjectForm>({
    defaultValues: {
      name: "",
      identifier: "",
      description: "",
      network: 2, // Public by default
    },
  });

  const projectName = watch("name");

  // Generate identifier from project name
  useEffect(() => {
    if (projectName) {
      const identifier = projectName
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 5)
        .toUpperCase();
      setValue("identifier", identifier);
    }
  }, [projectName, setValue]);

  // Fetch projects
  useEffect(() => {
    async function fetchProjects() {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceSlug}/projects/`,
          { credentials: "include" }
        );
        if (response.ok) {
          const data = await response.json();
          setProjects(data);
        }
      } catch (err) {
        console.error("Failed to fetch projects:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchProjects();
  }, [workspaceSlug]);

  // Handle modal state from URL
  useEffect(() => {
    if (create) {
      setIsModalOpen(true);
    }
  }, [create]);

  function closeModal() {
    setIsModalOpen(false);
    setCreateError(null);
    reset();
    // Remove create param from URL
    navigate({
      to: `/${workspaceSlug}/projects`,
      search: { view },
      replace: true,
    });
  }

  async function onCreateProject(data: CreateProjectForm) {
    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/projects/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          credentials: "include",
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message ||
            errorData.identifier?.[0] ||
            "Failed to create project"
        );
      }

      const project = await response.json();
      setProjects((prev) => [...prev, project]);
      closeModal();

      // Navigate to the new project
      navigate({
        to: `/${workspaceSlug}/projects/${project.id}/issues`,
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsCreating(false);
    }
  }

  const filteredProjects = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.identifier.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const setView = (newView: "grid" | "list") => {
    navigate({
      to: `/${workspaceSlug}/projects`,
      search: { view: newView, create: undefined },
      replace: true,
    });
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-custom-text-100">
            Projects
          </h1>
          <p className="text-sm text-custom-text-300 mt-1">
            Manage all projects in your workspace
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {/* Filters & View Toggle */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-custom-text-400" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-10 pr-4 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-1 bg-custom-background-90 border border-custom-border-200 rounded-md p-0.5">
          <button
            onClick={() => setView("grid")}
            className={`p-1.5 rounded ${
              view === "grid"
                ? "bg-custom-background-100 text-custom-text-100"
                : "text-custom-text-400 hover:text-custom-text-200"
            }`}
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView("list")}
            className={`p-1.5 rounded ${
              view === "list"
                ? "bg-custom-background-100 text-custom-text-100"
                : "text-custom-text-400 hover:text-custom-text-200"
            }`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Projects List/Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-custom-primary-100" />
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="text-center py-12 bg-custom-background-90 border border-custom-border-200 rounded-lg">
          {searchQuery ? (
            <>
              <Search className="h-12 w-12 text-custom-text-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-custom-text-100 mb-2">
                No results found
              </h3>
              <p className="text-custom-text-300">
                No projects match "{searchQuery}"
              </p>
            </>
          ) : (
            <>
              <FolderKanban className="h-12 w-12 text-custom-text-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-custom-text-100 mb-2">
                No projects yet
              </h3>
              <p className="text-custom-text-300 mb-4">
                Create your first project to get started
              </p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create Project
              </button>
            </>
          )}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <Link
              key={project.id}
              to={`/${workspaceSlug}/projects/${project.id}/issues`}
              className="p-4 bg-custom-background-90 border border-custom-border-200 rounded-lg hover:border-custom-primary-100 transition-colors group"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-custom-background-80 flex items-center justify-center text-sm font-medium text-custom-text-200 flex-shrink-0">
                  {project.identifier?.[0] || project.name?.[0] || "P"}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-custom-text-100 truncate group-hover:text-custom-primary-100 transition-colors">
                    {project.name}
                  </h3>
                  <p className="text-xs text-custom-text-400 mt-0.5">
                    {project.identifier}
                  </p>
                </div>
              </div>
              {project.description && (
                <p className="mt-3 text-xs text-custom-text-300 line-clamp-2">
                  {project.description}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    project.network === 2
                      ? "bg-green-500/10 text-green-500"
                      : "bg-yellow-500/10 text-yellow-500"
                  }`}
                >
                  {project.network === 2 ? "Public" : "Private"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="bg-custom-background-90 border border-custom-border-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-custom-border-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-custom-text-400 uppercase tracking-wider">
                  Project
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-custom-text-400 uppercase tracking-wider">
                  Identifier
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-custom-text-400 uppercase tracking-wider">
                  Network
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-custom-border-200">
              {filteredProjects.map((project) => (
                <tr
                  key={project.id}
                  className="hover:bg-custom-background-80 transition-colors cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: `/${workspaceSlug}/projects/${project.id}/issues`,
                    })
                  }
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded bg-custom-background-80 flex items-center justify-center text-xs font-medium text-custom-text-200">
                        {project.identifier?.[0] || project.name?.[0] || "P"}
                      </div>
                      <span className="text-sm font-medium text-custom-text-100">
                        {project.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-custom-text-300">
                      {project.identifier}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        project.network === 2
                          ? "bg-green-500/10 text-green-500"
                          : "bg-yellow-500/10 text-yellow-500"
                      }`}
                    >
                      {project.network === 2 ? "Public" : "Private"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-custom-background-100 border border-custom-border-200 rounded-lg w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-custom-border-200">
              <h2 className="text-lg font-semibold text-custom-text-100">
                Create Project
              </h2>
              <button
                onClick={closeModal}
                className="p-1 hover:bg-custom-background-80 rounded"
              >
                <X className="h-5 w-5 text-custom-text-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onCreateProject)} className="p-6">
              {createError && (
                <div className="mb-4 p-3 text-sm text-red-600 bg-red-50 rounded-md">
                  {createError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium text-custom-text-200 mb-1.5"
                  >
                    Project Name
                  </label>
                  <input
                    id="name"
                    type="text"
                    placeholder="My Project"
                    className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                    {...register("name", {
                      required: "Project name is required",
                      minLength: {
                        value: 1,
                        message: "Name must be at least 1 character",
                      },
                    })}
                  />
                  {errors.name && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="identifier"
                    className="block text-sm font-medium text-custom-text-200 mb-1.5"
                  >
                    Project Identifier
                  </label>
                  <input
                    id="identifier"
                    type="text"
                    placeholder="PROJ"
                    className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent uppercase"
                    {...register("identifier", {
                      required: "Identifier is required",
                      pattern: {
                        value: /^[A-Z][A-Z0-9]*$/,
                        message:
                          "Must start with a letter and contain only uppercase letters and numbers",
                      },
                      minLength: {
                        value: 1,
                        message: "Must be at least 1 character",
                      },
                      maxLength: {
                        value: 12,
                        message: "Must be at most 12 characters",
                      },
                    })}
                  />
                  <p className="mt-1 text-xs text-custom-text-400">
                    Used as a prefix for issue IDs (e.g., {watch("identifier") || "PROJ"}-1)
                  </p>
                  {errors.identifier && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.identifier.message}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="description"
                    className="block text-sm font-medium text-custom-text-200 mb-1.5"
                  >
                    Description (optional)
                  </label>
                  <textarea
                    id="description"
                    rows={3}
                    placeholder="What's this project about?"
                    className="w-full px-3 py-2 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent resize-none"
                    {...register("description")}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-custom-text-200 mb-1.5">
                    Network
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value={2}
                        {...register("network", { valueAsNumber: true })}
                        className="w-4 h-4 text-custom-primary-100 border-custom-border-200 focus:ring-custom-primary-100"
                      />
                      <span className="text-sm text-custom-text-200">
                        Public
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        value={0}
                        {...register("network", { valueAsNumber: true })}
                        className="w-4 h-4 text-custom-primary-100 border-custom-border-200 focus:ring-custom-primary-100"
                      />
                      <span className="text-sm text-custom-text-200">
                        Private
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-custom-border-200">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-custom-text-200 hover:bg-custom-background-80 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="px-4 py-2 text-sm bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Project
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

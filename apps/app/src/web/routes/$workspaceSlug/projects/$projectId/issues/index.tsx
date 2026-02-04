import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Plus,
  Search,
  Filter,
  List,
  LayoutGrid,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  ChevronDown,
} from "lucide-react";

export const Route = createFileRoute(
  "/$workspaceSlug/projects/$projectId/issues/"
)({
  component: IssuesListPage,
  validateSearch: (search: Record<string, unknown>) => ({
    layout: (search.layout as "list" | "kanban") || "list",
  }),
});

type Issue = {
  id: string;
  name: string;
  state_id: string | null;
  state__group: string;
  priority: number;
  sequence_id: number;
  assignee_ids: string[];
  label_ids: string[];
  created_at: string;
  updated_at: string;
};

type State = {
  id: string;
  name: string;
  color: string;
  group: string;
  sequence: number;
};

type CreateIssueForm = {
  name: string;
  priority: number;
  state_id: string;
};

const priorityColors: Record<number, string> = {
  0: "text-custom-text-400", // None
  1: "text-red-500", // Urgent
  2: "text-orange-500", // High
  3: "text-yellow-500", // Medium
  4: "text-blue-500", // Low
};

const priorityLabels: Record<number, string> = {
  0: "None",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

const stateGroupIcons: Record<string, typeof Circle> = {
  backlog: Circle,
  unstarted: Circle,
  started: Clock,
  completed: CheckCircle2,
  cancelled: XCircle,
};

const stateGroupColors: Record<string, string> = {
  backlog: "text-custom-text-400",
  unstarted: "text-custom-text-400",
  started: "text-yellow-500",
  completed: "text-green-500",
  cancelled: "text-red-500",
};

function IssuesListPage() {
  const { workspaceSlug, projectId } = Route.useParams();
  const { layout } = Route.useSearch();
  const navigate = useNavigate();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [states, setStates] = useState<State[]>([]);
  const [projectIdentifier, setProjectIdentifier] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CreateIssueForm>({
    defaultValues: {
      name: "",
      priority: 0,
      state_id: "",
    },
  });

  // Fetch issues, states, and project
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      try {
        const [issuesRes, statesRes, projectRes] = await Promise.all([
          fetch(
            `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/`,
            { credentials: "include" }
          ),
          fetch(
            `/api/workspaces/${workspaceSlug}/projects/${projectId}/states/`,
            { credentials: "include" }
          ),
          fetch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/`, {
            credentials: "include",
          }),
        ]);

        if (issuesRes.ok) {
          const data = await issuesRes.json();
          // Handle both paginated and non-paginated responses
          setIssues(Array.isArray(data) ? data : data.results || []);
        }

        if (statesRes.ok) {
          const data = await statesRes.json();
          setStates(data);
          // Set default state for new issues
          const defaultState = data.find((s: State) => s.group === "backlog");
          if (defaultState) {
            setValue("state_id", defaultState.id);
          }
        }

        if (projectRes.ok) {
          const data = await projectRes.json();
          setProjectIdentifier(data.identifier);
        }
      } catch (err) {
        console.error("Failed to fetch issues:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchData();
  }, [workspaceSlug, projectId, setValue]);

  function closeModal() {
    setIsModalOpen(false);
    setCreateError(null);
    reset();
  }

  async function onCreateIssue(data: CreateIssueForm) {
    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          credentials: "include",
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create issue");
      }

      const issue = await response.json();
      setIssues((prev) => [issue, ...prev]);
      closeModal();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsCreating(false);
    }
  }

  const getStateById = (stateId: string | null): State | undefined => {
    return states.find((s) => s.id === stateId);
  };

  const filteredIssues = issues.filter((issue) =>
    issue.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group issues by state for potential kanban view
  const issuesByState = states.reduce((acc, state) => {
    acc[state.id] = filteredIssues.filter((i) => i.state_id === state.id);
    return acc;
  }, {} as Record<string, Issue[]>);

  const setLayout = (newLayout: "list" | "kanban") => {
    navigate({
      to: `/${workspaceSlug}/projects/${projectId}/issues`,
      search: { layout: newLayout },
      replace: true,
    });
  };

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-custom-text-400" />
            <input
              type="text"
              placeholder="Search issues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-64 pl-9 pr-4 border border-custom-border-200 rounded-md bg-custom-background-100 text-sm text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
            />
          </div>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-custom-text-300 hover:bg-custom-background-80 rounded border border-custom-border-200">
            <Filter className="h-4 w-4" />
            Filters
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-custom-background-90 border border-custom-border-200 rounded-md p-0.5">
            <button
              onClick={() => setLayout("list")}
              className={`p-1.5 rounded ${
                layout === "list"
                  ? "bg-custom-background-100 text-custom-text-100"
                  : "text-custom-text-400 hover:text-custom-text-200"
              }`}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setLayout("kanban")}
              className={`p-1.5 rounded ${
                layout === "kanban"
                  ? "bg-custom-background-100 text-custom-text-100"
                  : "text-custom-text-400 hover:text-custom-text-200"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-custom-primary-100 text-white text-sm rounded-md hover:bg-custom-primary-200 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Issue
          </button>
        </div>
      </div>

      {/* Issues List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-custom-primary-100" />
        </div>
      ) : filteredIssues.length === 0 ? (
        <div className="text-center py-12 bg-custom-background-90 border border-custom-border-200 rounded-lg">
          {searchQuery ? (
            <>
              <Search className="h-12 w-12 text-custom-text-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-custom-text-100 mb-2">
                No results found
              </h3>
              <p className="text-custom-text-300">
                No issues match "{searchQuery}"
              </p>
            </>
          ) : (
            <>
              <AlertCircle className="h-12 w-12 text-custom-text-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-custom-text-100 mb-2">
                No issues yet
              </h3>
              <p className="text-custom-text-300 mb-4">
                Create your first issue to get started
              </p>
              <button
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-custom-primary-100 text-white rounded-md hover:bg-custom-primary-200 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create Issue
              </button>
            </>
          )}
        </div>
      ) : layout === "list" ? (
        <div className="bg-custom-background-90 border border-custom-border-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-custom-border-200 bg-custom-background-80">
                <th className="text-left px-4 py-2 text-xs font-medium text-custom-text-400 uppercase tracking-wider w-16">
                  ID
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-custom-text-400 uppercase tracking-wider">
                  Issue
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-custom-text-400 uppercase tracking-wider w-32">
                  State
                </th>
                <th className="text-left px-4 py-2 text-xs font-medium text-custom-text-400 uppercase tracking-wider w-24">
                  Priority
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-custom-border-200">
              {filteredIssues.map((issue) => {
                const state = getStateById(issue.state_id);
                const StateIcon = stateGroupIcons[state?.group || "backlog"];
                return (
                  <tr
                    key={issue.id}
                    className="hover:bg-custom-background-80 transition-colors cursor-pointer"
                    onClick={() =>
                      navigate({
                        to: `/${workspaceSlug}/projects/${projectId}/issues/${issue.id}`,
                      })
                    }
                  >
                    <td className="px-4 py-3">
                      <span className="text-xs text-custom-text-400">
                        {projectIdentifier}-{issue.sequence_id}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-custom-text-100">
                        {issue.name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {state && (
                        <div className="flex items-center gap-2">
                          <StateIcon
                            className={`h-4 w-4 ${
                              stateGroupColors[state.group]
                            }`}
                            style={{ color: state.color }}
                          />
                          <span className="text-sm text-custom-text-300">
                            {state.name}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-sm ${priorityColors[issue.priority]}`}
                      >
                        {priorityLabels[issue.priority]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        // Kanban View
        <div className="flex gap-4 overflow-x-auto pb-4">
          {states
            .sort((a, b) => a.sequence - b.sequence)
            .map((state) => (
              <div
                key={state.id}
                className="flex-shrink-0 w-72 bg-custom-background-90 rounded-lg"
              >
                <div className="px-3 py-2 border-b border-custom-border-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: state.color }}
                    />
                    <span className="text-sm font-medium text-custom-text-100">
                      {state.name}
                    </span>
                    <span className="text-xs text-custom-text-400 bg-custom-background-80 px-1.5 py-0.5 rounded">
                      {issuesByState[state.id]?.length || 0}
                    </span>
                  </div>
                </div>
                <div className="p-2 space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto">
                  {issuesByState[state.id]?.map((issue) => (
                    <div
                      key={issue.id}
                      className="p-3 bg-custom-background-100 border border-custom-border-200 rounded-md hover:border-custom-primary-100 cursor-pointer transition-colors"
                      onClick={() =>
                        navigate({
                          to: `/${workspaceSlug}/projects/${projectId}/issues/${issue.id}`,
                        })
                      }
                    >
                      <div className="text-xs text-custom-text-400 mb-1">
                        {projectIdentifier}-{issue.sequence_id}
                      </div>
                      <div className="text-sm text-custom-text-100">
                        {issue.name}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={`text-xs ${priorityColors[issue.priority]}`}
                        >
                          {priorityLabels[issue.priority]}
                        </span>
                      </div>
                    </div>
                  ))}
                  {(!issuesByState[state.id] ||
                    issuesByState[state.id].length === 0) && (
                    <div className="text-center py-4 text-sm text-custom-text-400">
                      No issues
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Create Issue Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-custom-background-100 border border-custom-border-200 rounded-lg w-full max-w-lg mx-4 shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-custom-border-200">
              <h2 className="text-lg font-semibold text-custom-text-100">
                Create Issue
              </h2>
              <button
                onClick={closeModal}
                className="p-1 hover:bg-custom-background-80 rounded"
              >
                <X className="h-5 w-5 text-custom-text-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onCreateIssue)} className="p-6">
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
                    Issue Title
                  </label>
                  <input
                    id="name"
                    type="text"
                    placeholder="What needs to be done?"
                    className="w-full h-10 px-3 border border-custom-border-200 rounded-md bg-custom-background-100 text-custom-text-100 placeholder:text-custom-text-400 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent"
                    {...register("name", {
                      required: "Issue title is required",
                    })}
                  />
                  {errors.name && (
                    <p className="mt-1 text-xs text-red-500">
                      {errors.name.message}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-custom-text-200 mb-1.5">
                      State
                    </label>
                    <div className="relative">
                      <select
                        className="w-full h-10 px-3 pr-8 border border-custom-border-200 rounded-md bg-custom-background-100 text-sm text-custom-text-100 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent appearance-none"
                        {...register("state_id")}
                      >
                        {states.map((state) => (
                          <option key={state.id} value={state.id}>
                            {state.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-custom-text-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-custom-text-200 mb-1.5">
                      Priority
                    </label>
                    <div className="relative">
                      <select
                        className="w-full h-10 px-3 pr-8 border border-custom-border-200 rounded-md bg-custom-background-100 text-sm text-custom-text-100 focus:outline-none focus:ring-2 focus:ring-custom-primary-100 focus:border-transparent appearance-none"
                        {...register("priority", { valueAsNumber: true })}
                      >
                        <option value={0}>None</option>
                        <option value={1}>Urgent</option>
                        <option value={2}>High</option>
                        <option value={3}>Medium</option>
                        <option value={4}>Low</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-custom-text-400 pointer-events-none" />
                    </div>
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
                  Create Issue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

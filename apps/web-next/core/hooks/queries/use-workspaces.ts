import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Types
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
}

export interface WorkspaceMember {
  id: string;
  userId: string;
  workspaceId: string;
  role: "admin" | "member" | "guest";
  isActive: boolean;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
}

export interface CreateWorkspaceData {
  name: string;
  slug: string;
  logo?: string;
}

export interface UpdateWorkspaceData {
  name?: string;
  slug?: string;
  logo?: string;
}

// Query: Get all workspaces for current user
export function useWorkspacesQuery() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: async (): Promise<Workspace[]> => {
      const response = await fetch("/api/workspaces");
      if (!response.ok) {
        throw new Error("Failed to fetch workspaces");
      }
      return response.json();
    },
  });
}

// Query: Get single workspace by slug
export function useWorkspaceQuery(slug: string) {
  return useQuery({
    queryKey: ["workspace", slug],
    queryFn: async (): Promise<Workspace> => {
      const response = await fetch(`/api/workspaces/${slug}`);
      if (!response.ok) {
        throw new Error("Failed to fetch workspace");
      }
      return response.json();
    },
    enabled: !!slug,
  });
}

// Query: Get workspace members
export function useWorkspaceMembersQuery(slug: string) {
  return useQuery({
    queryKey: ["workspace", slug, "members"],
    queryFn: async (): Promise<WorkspaceMember[]> => {
      const response = await fetch(`/api/workspaces/${slug}/members`);
      if (!response.ok) {
        throw new Error("Failed to fetch workspace members");
      }
      return response.json();
    },
    enabled: !!slug,
  });
}

// Mutation: Create workspace
export function useCreateWorkspaceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateWorkspaceData): Promise<Workspace> => {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to create workspace");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

// Mutation: Update workspace
export function useUpdateWorkspaceMutation(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateWorkspaceData): Promise<Workspace> => {
      const response = await fetch(`/api/workspaces/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to update workspace");
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspace", slug] });
      // If slug changed, also invalidate the new slug
      if (data.slug !== slug) {
        queryClient.invalidateQueries({ queryKey: ["workspace", data.slug] });
      }
    },
  });
}

// Mutation: Delete workspace
export function useDeleteWorkspaceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slug: string): Promise<void> => {
      const response = await fetch(`/api/workspaces/${slug}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to delete workspace");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

// Mutation: Invite member to workspace
export function useInviteWorkspaceMemberMutation(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { email: string; role: "admin" | "member" | "guest" }): Promise<void> => {
      const response = await fetch(`/api/workspaces/${slug}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to invite member");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace", slug, "members"] });
    },
  });
}

// Query: Get workspace invitations (pending)
export function useWorkspaceInvitationsQuery() {
  return useQuery({
    queryKey: ["workspace-invitations"],
    queryFn: async () => {
      const response = await fetch("/api/users/me/workspace-invitations");
      if (!response.ok) {
        throw new Error("Failed to fetch invitations");
      }
      return response.json();
    },
  });
}

// Mutation: Accept workspace invitation
export function useAcceptInvitationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string): Promise<void> => {
      const response = await fetch(`/api/users/me/workspace-invitations/${invitationId}/accept`, {
        method: "POST",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to accept invitation");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-invitations"] });
    },
  });
}

// Mutation: Decline workspace invitation
export function useDeclineInvitationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (invitationId: string): Promise<void> => {
      const response = await fetch(`/api/users/me/workspace-invitations/${invitationId}/decline`, {
        method: "POST",
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Failed to decline invitation");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-invitations"] });
    },
  });
}

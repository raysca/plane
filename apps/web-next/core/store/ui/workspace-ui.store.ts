import { create } from "zustand";

type SidebarTab = "projects" | "favorites" | "all";

interface WorkspaceUIState {
  // Active sidebar tab
  activeSidebarTab: SidebarTab;
  setActiveSidebarTab: (tab: SidebarTab) => void;

  // Create workspace modal
  createWorkspaceModalOpen: boolean;
  openCreateWorkspaceModal: () => void;
  closeCreateWorkspaceModal: () => void;

  // Invite modal
  inviteModalOpen: boolean;
  openInviteModal: () => void;
  closeInviteModal: () => void;

  // Workspace settings modal
  settingsModalOpen: boolean;
  openSettingsModal: () => void;
  closeSettingsModal: () => void;
}

export const useWorkspaceUIStore = create<WorkspaceUIState>((set) => ({
  // Active sidebar tab
  activeSidebarTab: "projects",
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),

  // Create workspace modal
  createWorkspaceModalOpen: false,
  openCreateWorkspaceModal: () => set({ createWorkspaceModalOpen: true }),
  closeCreateWorkspaceModal: () => set({ createWorkspaceModalOpen: false }),

  // Invite modal
  inviteModalOpen: false,
  openInviteModal: () => set({ inviteModalOpen: true }),
  closeInviteModal: () => set({ inviteModalOpen: false }),

  // Workspace settings modal
  settingsModalOpen: false,
  openSettingsModal: () => set({ settingsModalOpen: true }),
  closeSettingsModal: () => set({ settingsModalOpen: false }),
}));

import { set } from "lodash-es";
import { action, observable, runInAction, makeObservable, computed } from "mobx";
import { InstanceWorkspaceService } from "@plane/services";
import type { IWorkspace, TLoader, TPaginationInfo } from "@plane/types";
import type { RootStore } from "./root.store";

export interface IWorkspaceStore {
  loader: TLoader;
  workspaces: Record<string, IWorkspace>;
  paginationInfo: TPaginationInfo | undefined;
  workspaceIds: string[];
  hydrate: (data: Record<string, IWorkspace>) => void;
  getWorkspaceById: (workspaceId: string) => IWorkspace | undefined;
  fetchWorkspaces: () => Promise<IWorkspace[]>;
  fetchNextWorkspaces: () => Promise<IWorkspace[]>;
  createWorkspace: (data: IWorkspace) => Promise<IWorkspace>;
}

export class WorkspaceStore implements IWorkspaceStore {
  loader: TLoader = "init-loader";
  workspaces: Record<string, IWorkspace> = {};
  paginationInfo: TPaginationInfo | undefined = undefined;
  instanceWorkspaceService;

  constructor(private store: RootStore) {
    makeObservable(this, {
      loader: observable,
      workspaces: observable,
      paginationInfo: observable,
      workspaceIds: computed,
      hydrate: action,
      getWorkspaceById: action,
      fetchWorkspaces: action,
      fetchNextWorkspaces: action,
      createWorkspace: action,
    });
    this.instanceWorkspaceService = new InstanceWorkspaceService();
  }

  get workspaceIds() {
    return Object.keys(this.workspaces);
  }

  hydrate = (data: Record<string, IWorkspace>) => {
    if (data) this.workspaces = data;
  };

  getWorkspaceById = (workspaceId: string) => this.workspaces[workspaceId];

  fetchWorkspaces = async (): Promise<IWorkspace[]> => {
    try {
      if (this.workspaceIds.length > 0) {
        this.loader = "mutation";
      } else {
        this.loader = "init-loader";
      }
      const paginatedWorkspaceData = await this.instanceWorkspaceService.list();
      runInAction(() => {
        const { results, ...paginationInfo } = paginatedWorkspaceData;
        results.forEach((workspace: IWorkspace) => {
          set(this.workspaces, [workspace.id], workspace);
        });
        set(this, "paginationInfo", paginationInfo);
      });
      return paginatedWorkspaceData.results;
    } catch (error) {
      console.error("Error fetching workspaces", error);
      throw error;
    } finally {
      this.loader = "loaded";
    }
  };

  fetchNextWorkspaces = async (): Promise<IWorkspace[]> => {
    if (!this.paginationInfo || this.paginationInfo.next_page_results === false) return [];
    try {
      this.loader = "pagination";
      const paginatedWorkspaceData = await this.instanceWorkspaceService.list(this.paginationInfo.next_cursor);
      runInAction(() => {
        const { results, ...paginationInfo } = paginatedWorkspaceData;
        results.forEach((workspace: IWorkspace) => {
          set(this.workspaces, [workspace.id], workspace);
        });
        set(this, "paginationInfo", paginationInfo);
      });
      return paginatedWorkspaceData.results;
    } catch (error) {
      console.error("Error fetching next workspaces", error);
      throw error;
    } finally {
      this.loader = "loaded";
    }
  };

  createWorkspace = async (data: IWorkspace): Promise<IWorkspace> => {
    try {
      this.loader = "mutation";
      const workspace = await this.instanceWorkspaceService.create(data);
      runInAction(() => {
        set(this.workspaces, [workspace.id], workspace);
      });
      return workspace;
    } catch (error) {
      console.error("Error creating workspace", error);
      throw error;
    } finally {
      this.loader = "loaded";
    }
  };
}

import { enableStaticRendering } from "mobx-react";
import type { IInstanceStore } from "./instance.store";
import { InstanceStore } from "./instance.store";
import type { IThemeStore } from "./theme.store";
import { ThemeStore } from "./theme.store";
import type { IUserStore } from "./user.store";
import { UserStore } from "./user.store";
import type { IWorkspaceStore } from "./workspace.store";
import { WorkspaceStore } from "./workspace.store";

enableStaticRendering(typeof window === "undefined");

export class RootStore {
  theme: IThemeStore;
  instance: IInstanceStore;
  user: IUserStore;
  workspace: IWorkspaceStore;

  constructor() {
    this.theme = new ThemeStore(this);
    this.instance = new InstanceStore(this);
    this.user = new UserStore(this);
    this.workspace = new WorkspaceStore(this);
  }

  hydrate(initialData: any) {
    if (initialData?.theme) this.theme.hydrate(initialData.theme);
    if (initialData?.instance) this.instance.hydrate(initialData.instance);
    if (initialData?.user) this.user.hydrate(initialData.user);
    if (initialData?.workspace) this.workspace.hydrate(initialData.workspace);
  }

  resetOnSignOut() {
    localStorage.setItem("theme", "system");
    this.instance = new InstanceStore(this);
    this.user = new UserStore(this);
    this.theme = new ThemeStore(this);
    this.workspace = new WorkspaceStore(this);
  }
}

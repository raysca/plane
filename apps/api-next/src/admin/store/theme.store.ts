import { action, observable, makeObservable } from "mobx";
import type { RootStore } from "./root.store";

type TTheme = "dark" | "light";
export interface IThemeStore {
  isNewUserPopup: boolean;
  theme: string | undefined;
  isSidebarCollapsed: boolean | undefined;
  hydrate: (data: any) => void;
  toggleNewUserPopup: () => void;
  toggleSidebar: (collapsed: boolean) => void;
  setTheme: (currentTheme: TTheme) => void;
}

export class ThemeStore implements IThemeStore {
  isNewUserPopup: boolean = false;
  isSidebarCollapsed: boolean | undefined = undefined;
  theme: string | undefined = undefined;

  constructor(private store: RootStore) {
    makeObservable(this, {
      isNewUserPopup: observable.ref,
      isSidebarCollapsed: observable.ref,
      theme: observable.ref,
      toggleNewUserPopup: action,
      toggleSidebar: action,
      setTheme: action,
    });
  }

  hydrate = (data: any) => {
    if (data) this.theme = data;
  };

  toggleNewUserPopup = () => (this.isNewUserPopup = !this.isNewUserPopup);

  toggleSidebar = (isCollapsed: boolean) => {
    if (isCollapsed === undefined) this.isSidebarCollapsed = !this.isSidebarCollapsed;
    else this.isSidebarCollapsed = isCollapsed;
    localStorage.setItem("god_mode_sidebar_collapsed", isCollapsed.toString());
  };

  setTheme = async (currentTheme: TTheme) => {
    try {
      localStorage.setItem("theme", currentTheme);
      this.theme = currentTheme;
    } catch (error) {
      console.error("setting user theme error", error);
    }
  };
}

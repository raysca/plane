import { action, observable, runInAction, makeObservable } from "mobx";
import type { TUserStatus } from "@plane/constants";
import { EUserStatus } from "@plane/constants";
import { AuthService, UserService } from "@plane/services";
import type { IUser } from "@plane/types";
import type { RootStore } from "./root.store";

export interface IUserStore {
  isLoading: boolean;
  userStatus: TUserStatus | undefined;
  isUserLoggedIn: boolean | undefined;
  currentUser: IUser | undefined;
  hydrate: (data: any) => void;
  fetchCurrentUser: () => Promise<IUser>;
  reset: () => void;
  signOut: () => void;
}

export class UserStore implements IUserStore {
  isLoading: boolean = true;
  userStatus: TUserStatus | undefined = undefined;
  isUserLoggedIn: boolean | undefined = undefined;
  currentUser: IUser | undefined = undefined;
  userService;
  authService;

  constructor(private store: RootStore) {
    makeObservable(this, {
      isLoading: observable.ref,
      userStatus: observable,
      isUserLoggedIn: observable.ref,
      currentUser: observable,
      fetchCurrentUser: action,
      reset: action,
      signOut: action,
    });
    this.userService = new UserService();
    this.authService = new AuthService();
  }

  hydrate = (data: any) => {
    if (data) this.currentUser = data;
  };

  fetchCurrentUser = async () => {
    try {
      if (this.currentUser === undefined) this.isLoading = true;
      const currentUser = await this.userService.adminDetails();
      if (currentUser) {
        await this.store.instance.fetchInstanceAdmins();
        runInAction(() => {
          this.isUserLoggedIn = true;
          this.currentUser = currentUser;
          this.isLoading = false;
        });
      } else {
        runInAction(() => {
          this.isUserLoggedIn = false;
          this.currentUser = undefined;
          this.isLoading = false;
        });
      }
      return currentUser;
    } catch (error: any) {
      this.isLoading = false;
      this.isUserLoggedIn = false;
      if (error.status === 403)
        this.userStatus = {
          status: EUserStatus.AUTHENTICATION_NOT_DONE,
          message: error?.message || "",
        };
      else
        this.userStatus = {
          status: EUserStatus.ERROR,
          message: error?.message || "",
        };
      throw error;
    }
  };

  reset = async () => {
    this.isUserLoggedIn = false;
    this.currentUser = undefined;
    this.isLoading = false;
    this.userStatus = undefined;
  };

  signOut = async () => {
    this.store.resetOnSignOut();
  };
}

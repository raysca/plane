import { createContext } from "react";
import { RootStore } from "../store/root.store";

let rootStore = new RootStore();

export const StoreContext = createContext(rootStore);

function initializeStore(initialData = {}) {
  const singletonRootStore = rootStore ?? new RootStore();
  if (initialData) {
    singletonRootStore.hydrate(initialData);
  }
  if (typeof window === "undefined") return singletonRootStore;
  if (!rootStore) rootStore = singletonRootStore;
  return singletonRootStore;
}

export type StoreProviderProps = {
  children: React.ReactNode;
  initialState?: any;
};

export function StoreProvider({ children, initialState = {} }: StoreProviderProps) {
  const store = initializeStore(initialState);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

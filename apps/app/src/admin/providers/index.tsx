import { CoreProviders } from "./core";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <CoreProviders>{children}</CoreProviders>;
}

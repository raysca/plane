import { observer } from "mobx-react";
import useSWR from "swr";
import { useInstance } from "../hooks/store";

export const InstanceProvider = observer(function InstanceProvider(props: React.PropsWithChildren) {
  const { children } = props;
  const { fetchInstanceInfo } = useInstance();

  useSWR("INSTANCE_DETAILS", () => fetchInstanceInfo(), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    errorRetryCount: 0,
  });

  return <>{children}</>;
});

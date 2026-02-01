import { observer } from "mobx-react";
import { Link } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { getButtonStyling } from "@plane/propel/button";
import type { TInstanceAuthenticationMethodKeys } from "@plane/types";
import { ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
import { useInstance } from "../../hooks/store";

type Props = {
  disabled: boolean;
  updateConfig: (key: TInstanceAuthenticationMethodKeys, value: string) => void;
};

export const GitlabConfiguration = observer(function GitlabConfiguration(props: Props) {
  const { disabled, updateConfig } = props;
  const { formattedConfig } = useInstance();
  const enableGitlabConfig = formattedConfig?.IS_GITLAB_ENABLED ?? "";
  const isGitlabConfigured = !!formattedConfig?.GITLAB_CLIENT_ID && !!formattedConfig?.GITLAB_CLIENT_SECRET;

  return (
    <>
      {isGitlabConfigured ? (
        <div className="flex items-center gap-4">
          <Link to="/authentication/gitlab" className={cn(getButtonStyling("link", "base"), "font-medium")}>Edit</Link>
          <ToggleSwitch
            value={Boolean(parseInt(enableGitlabConfig))}
            onChange={() => {
              const newVal = Boolean(parseInt(enableGitlabConfig)) === true ? "0" : "1";
              updateConfig("IS_GITLAB_ENABLED", newVal);
            }}
            size="sm"
            disabled={disabled}
          />
        </div>
      ) : (
        <Link to="/authentication/gitlab" className={cn(getButtonStyling("secondary", "base"), "text-tertiary")}>
          <Settings2 className="h-4 w-4 p-0.5 text-tertiary" />Configure
        </Link>
      )}
    </>
  );
});

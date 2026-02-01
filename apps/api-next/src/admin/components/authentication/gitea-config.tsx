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

export const GiteaConfiguration = observer(function GiteaConfiguration(props: Props) {
  const { disabled, updateConfig } = props;
  const { formattedConfig } = useInstance();
  const GiteaConfig = formattedConfig?.IS_GITEA_ENABLED ?? "";
  const GiteaConfigured = !!formattedConfig?.GITEA_HOST && !!formattedConfig?.GITEA_CLIENT_ID && !!formattedConfig?.GITEA_CLIENT_SECRET;

  return (
    <>
      {GiteaConfigured ? (
        <div className="flex items-center gap-4">
          <Link to="/authentication/gitea" className={cn(getButtonStyling("link", "base"), "font-medium")}>Edit</Link>
          <ToggleSwitch
            value={Boolean(parseInt(GiteaConfig))}
            onChange={() => {
              Boolean(parseInt(GiteaConfig)) === true
                ? updateConfig("IS_GITEA_ENABLED", "0")
                : updateConfig("IS_GITEA_ENABLED", "1");
            }}
            size="sm"
            disabled={disabled}
          />
        </div>
      ) : (
        <Link to="/authentication/gitea" className={cn(getButtonStyling("secondary", "base"), "text-tertiary")}>
          <Settings2 className="h-4 w-4 p-0.5 text-tertiary" />Configure
        </Link>
      )}
    </>
  );
});

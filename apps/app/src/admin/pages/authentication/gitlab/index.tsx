import { useState } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { isEmpty } from "lodash-es";
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";
import { Button, getButtonStyling } from "@plane/propel/button";
import { setPromiseToast, TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IFormattedInstanceConfiguration, TInstanceGitlabAuthenticationConfigurationKeys } from "@plane/types";
import { Loader, ToggleSwitch } from "@plane/ui";
import GitlabLogo from "../../../assets/logos/gitlab-logo.svg";
import { AuthenticationMethodCard } from "../../../components/authentication/authentication-method-card";
import { CodeBlock } from "../../../components/common/code-block";
import { ConfirmDiscardModal } from "../../../components/common/confirm-discard-modal";
import type { TControllerInputFormField } from "../../../components/common/controller-input";
import { ControllerInput } from "../../../components/common/controller-input";
import type { TControllerSwitchFormField } from "../../../components/common/controller-switch";
import { ControllerSwitch } from "../../../components/common/controller-switch";
import type { TCopyField } from "../../../components/common/copy-field";
import { CopyField } from "../../../components/common/copy-field";
import { PageWrapper } from "../../../components/common/page-wrapper";
import { useInstance } from "../../../hooks/store";

type GitlabConfigFormValues = Record<TInstanceGitlabAuthenticationConfigurationKeys, string>;

function InstanceGitlabConfigForm({ config }: { config: IFormattedInstanceConfiguration }) {
  const [isDiscardChangesModalOpen, setIsDiscardChangesModalOpen] = useState(false);
  const { updateInstanceConfigurations } = useInstance();
  const {
    handleSubmit, control, reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<GitlabConfigFormValues>({
    defaultValues: {
      GITLAB_HOST: config["GITLAB_HOST"],
      GITLAB_CLIENT_ID: config["GITLAB_CLIENT_ID"],
      GITLAB_CLIENT_SECRET: config["GITLAB_CLIENT_SECRET"],
      ENABLE_GITLAB_SYNC: config["ENABLE_GITLAB_SYNC"] || "0",
    },
  });

  const originURL = !isEmpty(API_BASE_URL) ? API_BASE_URL : typeof window !== "undefined" ? window.location.origin : "";

  const GITLAB_FORM_FIELDS: TControllerInputFormField[] = [
    { key: "GITLAB_HOST", type: "text", label: "Host", description: <>This is either https://gitlab.com or the <CodeBlock>domain.tld</CodeBlock> where you host GitLab.</>, placeholder: "https://gitlab.com", error: Boolean(errors.GITLAB_HOST), required: true },
    { key: "GITLAB_CLIENT_ID", type: "text", label: "Application ID", description: <>Get this from your <a tabIndex={-1} href="https://docs.gitlab.com/ee/integration/oauth_provider.html" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">GitLab OAuth application settings</a>.</>, placeholder: "c2ef2e7fc4e9d15aa7630f5637d59e8e4a27ff01dceebdb26b0d267b9adcf3c3", error: Boolean(errors.GITLAB_CLIENT_ID), required: true },
    { key: "GITLAB_CLIENT_SECRET", type: "password", label: "Secret", description: <>The client secret is also found in your <a tabIndex={-1} href="https://docs.gitlab.com/ee/integration/oauth_provider.html" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">GitLab OAuth application settings</a>.</>, placeholder: "gloas-f79cfa9a03c97f6ffab303177a5a6778a53c61e3914ba093412f68a9298a1b28", error: Boolean(errors.GITLAB_CLIENT_SECRET), required: true },
  ];

  const GITLAB_FORM_SWITCH_FIELD: TControllerSwitchFormField<GitlabConfigFormValues> = { name: "ENABLE_GITLAB_SYNC", label: "GitLab" };

  const GITLAB_SERVICE_FIELD: TCopyField[] = [
    { key: "Callback_URL", label: "Callback URL", url: `${originURL}/auth/gitlab/callback/`, description: <>We will auto-generate this. Paste this into the <CodeBlock darkerShade>Redirect URI</CodeBlock> field of your <a tabIndex={-1} href="https://docs.gitlab.com/ee/integration/oauth_provider.html" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">GitLab OAuth application</a>.</> },
  ];

  const onSubmit = async (formData: GitlabConfigFormValues) => {
    try {
      const response = await updateInstanceConfigurations(formData);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Done!", message: "Your GitLab authentication is configured. You should test it now." });
      reset({
        GITLAB_HOST: response.find((item) => item.key === "GITLAB_HOST")?.value,
        GITLAB_CLIENT_ID: response.find((item) => item.key === "GITLAB_CLIENT_ID")?.value,
        GITLAB_CLIENT_SECRET: response.find((item) => item.key === "GITLAB_CLIENT_SECRET")?.value,
        ENABLE_GITLAB_SYNC: response.find((item) => item.key === "ENABLE_GITLAB_SYNC")?.value,
      });
    } catch (err) { console.error(err); }
  };

  const handleGoBack = (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
    if (isDirty) { e.preventDefault(); setIsDiscardChangesModalOpen(true); }
  };

  return (
    <>
      <ConfirmDiscardModal isOpen={isDiscardChangesModalOpen} onDiscardHref="/authentication" handleClose={() => setIsDiscardChangesModalOpen(false)} />
      <div className="flex flex-col gap-8">
        <div className="grid grid-cols-2 gap-x-12 gap-y-8 w-full">
          <div className="flex flex-col gap-y-4 col-span-2 md:col-span-1 pt-1">
            <div className="pt-2.5 text-18 font-medium">GitLab-provided details for Plane</div>
            {GITLAB_FORM_FIELDS.map((field) => (
              <ControllerInput key={field.key} control={control} type={field.type} name={field.key} label={field.label} description={field.description} placeholder={field.placeholder} error={field.error} required={field.required} />
            ))}
            <ControllerSwitch control={control} field={GITLAB_FORM_SWITCH_FIELD} />
            <div className="flex flex-col gap-1 pt-4">
              <div className="flex items-center gap-4">
                <Button variant="primary" size="lg" onClick={(e) => void handleSubmit(onSubmit)(e)} loading={isSubmitting} disabled={!isDirty}>{isSubmitting ? "Saving" : "Save changes"}</Button>
                <Link to="/authentication" className={getButtonStyling("secondary", "lg")} onClick={handleGoBack}>Go back</Link>
              </div>
            </div>
          </div>
          <div className="col-span-2 md:col-span-1">
            <div className="flex flex-col gap-y-4 px-6 pt-1.5 pb-4 bg-layer-3 rounded-lg">
              <div className="pt-2 text-18 font-medium">Plane-provided details for GitLab</div>
              {GITLAB_SERVICE_FIELD.map((field) => (
                <CopyField key={field.key} label={field.label} url={field.url} description={field.description} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const InstanceGitlabAuthenticationPage = observer(function InstanceGitlabAuthenticationPage() {
  const { fetchInstanceConfigurations, formattedConfig, updateInstanceConfigurations } = useInstance();
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const enableGitlabConfig = formattedConfig?.IS_GITLAB_ENABLED ?? "";

  useSWR("INSTANCE_CONFIGURATIONS", () => fetchInstanceConfigurations());

  const updateConfig = async (key: "IS_GITLAB_ENABLED", value: string) => {
    setIsSubmitting(true);
    const updateConfigPromise = updateInstanceConfigurations({ [key]: value });
    setPromiseToast(updateConfigPromise, {
      loading: "Saving Configuration",
      success: { title: "Configuration saved", message: () => `GitLab authentication is now ${value === "1" ? "active" : "disabled"}.` },
      error: { title: "Error", message: () => "Failed to save configuration" },
    });
    await updateConfigPromise.then(() => setIsSubmitting(false)).catch((err) => { console.error(err); setIsSubmitting(false); });
  };

  return (
    <PageWrapper
      customHeader={
        <AuthenticationMethodCard
          name="GitLab"
          description="Allow members to login or sign up to plane with their GitLab accounts."
          icon={<img src={GitlabLogo} height={24} width={24} alt="GitLab Logo" />}
          config={<ToggleSwitch value={Boolean(parseInt(enableGitlabConfig))} onChange={() => { if (Boolean(parseInt(enableGitlabConfig)) === true) updateConfig("IS_GITLAB_ENABLED", "0"); else updateConfig("IS_GITLAB_ENABLED", "1"); }} size="sm" disabled={isSubmitting || !formattedConfig} />}
          disabled={isSubmitting || !formattedConfig}
          withBorder={false}
        />
      }
    >
      {formattedConfig ? (
        <InstanceGitlabConfigForm config={formattedConfig} />
      ) : (
        <Loader className="space-y-8"><Loader.Item height="50px" width="25%" /><Loader.Item height="50px" /><Loader.Item height="50px" /><Loader.Item height="50px" /><Loader.Item height="50px" width="50%" /></Loader>
      )}
    </PageWrapper>
  );
});

export default InstanceGitlabAuthenticationPage;

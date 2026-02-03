import { useState } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { isEmpty } from "lodash-es";
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";
import { Button, getButtonStyling } from "@plane/propel/button";
import { setPromiseToast, TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IFormattedInstanceConfiguration, TInstanceGiteaAuthenticationConfigurationKeys } from "@plane/types";
import { Loader, ToggleSwitch } from "@plane/ui";
import giteaLogo from "../../../assets/logos/gitea-logo.svg";
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

type GiteaConfigFormValues = Record<TInstanceGiteaAuthenticationConfigurationKeys, string>;

function InstanceGiteaConfigForm({ config }: { config: IFormattedInstanceConfiguration }) {
  const [isDiscardChangesModalOpen, setIsDiscardChangesModalOpen] = useState(false);
  const { updateInstanceConfigurations } = useInstance();
  const {
    handleSubmit, control, reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<GiteaConfigFormValues>({
    defaultValues: {
      GITEA_HOST: config["GITEA_HOST"] || "https://gitea.com",
      GITEA_CLIENT_ID: config["GITEA_CLIENT_ID"],
      GITEA_CLIENT_SECRET: config["GITEA_CLIENT_SECRET"],
      ENABLE_GITEA_SYNC: config["ENABLE_GITEA_SYNC"] || "0",
    },
  });

  const originURL = !isEmpty(API_BASE_URL) ? API_BASE_URL : typeof window !== "undefined" ? window.location.origin : "";

  const GITEA_FORM_FIELDS: TControllerInputFormField[] = [
    { key: "GITEA_HOST", type: "text", label: "Gitea Host", description: <>Use the URL of your Gitea instance. For the official Gitea instance, use &quot;https://gitea.com&quot;.</>, placeholder: "https://gitea.com", error: Boolean(errors.GITEA_HOST), required: true },
    { key: "GITEA_CLIENT_ID", type: "text", label: "Client ID", description: <>You will get this from your <a tabIndex={-1} href="https://gitea.com/user/settings/applications" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">Gitea OAuth application settings.</a></>, placeholder: "70a44354520df8bd9bcd", error: Boolean(errors.GITEA_CLIENT_ID), required: true },
    { key: "GITEA_CLIENT_SECRET", type: "password", label: "Client secret", description: <>Your client secret is also found in your <a tabIndex={-1} href="https://gitea.com/user/settings/applications" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">Gitea OAuth application settings.</a></>, placeholder: "9b0050f94ec1b744e32ce79ea4ffacd40d4119cb", error: Boolean(errors.GITEA_CLIENT_SECRET), required: true },
  ];

  const GITEA_FORM_SWITCH_FIELD: TControllerSwitchFormField<GiteaConfigFormValues> = { name: "ENABLE_GITEA_SYNC", label: "Gitea" };

  const GITEA_SERVICE_FIELD: TCopyField[] = [
    { key: "Callback_URI", label: "Callback URI", url: `${originURL}/auth/gitea/callback/`, description: <>We will auto-generate this. Paste this into your <CodeBlock darkerShade>Authorized Callback URI</CodeBlock> field <a tabIndex={-1} href={`${control._formValues.GITEA_HOST || "https://gitea.com"}/user/settings/applications`} target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">here.</a></> },
  ];

  const onSubmit = async (formData: GiteaConfigFormValues) => {
    try {
      const response = await updateInstanceConfigurations(formData);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Done!", message: "Your Gitea authentication is configured. You should test it now." });
      reset({
        GITEA_HOST: response.find((item) => item.key === "GITEA_HOST")?.value,
        GITEA_CLIENT_ID: response.find((item) => item.key === "GITEA_CLIENT_ID")?.value,
        GITEA_CLIENT_SECRET: response.find((item) => item.key === "GITEA_CLIENT_SECRET")?.value,
        ENABLE_GITEA_SYNC: response.find((item) => item.key === "ENABLE_GITEA_SYNC")?.value,
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
            <div className="pt-2.5 text-18 font-medium">Gitea-provided details for Plane</div>
            {GITEA_FORM_FIELDS.map((field) => (
              <ControllerInput key={field.key} control={control} type={field.type} name={field.key} label={field.label} description={field.description} placeholder={field.placeholder} error={field.error} required={field.required} />
            ))}
            <ControllerSwitch control={control} field={GITEA_FORM_SWITCH_FIELD} />
            <div className="flex flex-col gap-1 pt-4">
              <div className="flex items-center gap-4">
                <Button variant="primary" size="lg" onClick={(e) => void handleSubmit(onSubmit)(e)} loading={isSubmitting} disabled={!isDirty}>{isSubmitting ? "Saving" : "Save changes"}</Button>
                <Link to="/authentication" className={getButtonStyling("secondary", "lg")} onClick={handleGoBack}>Go back</Link>
              </div>
            </div>
          </div>
          <div className="col-span-2 md:col-span-1">
            <div className="flex flex-col gap-y-4 px-6 pt-1.5 pb-4 bg-layer-1 rounded-lg">
              <div className="pt-2 text-18 font-medium">Plane-provided details for Gitea</div>
              {GITEA_SERVICE_FIELD.map((field) => (
                <CopyField key={field.key} label={field.label} url={field.url} description={field.description} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const InstanceGiteaAuthenticationPage = observer(function InstanceGiteaAuthenticationPage() {
  const { fetchInstanceConfigurations, formattedConfig, updateInstanceConfigurations } = useInstance();
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const enableGiteaConfig = formattedConfig?.IS_GITEA_ENABLED ?? "";

  useSWR("INSTANCE_CONFIGURATIONS", () => fetchInstanceConfigurations());

  const updateConfig = async (key: "IS_GITEA_ENABLED", value: string) => {
    setIsSubmitting(true);
    const updateConfigPromise = updateInstanceConfigurations({ [key]: value });
    setPromiseToast(updateConfigPromise, {
      loading: "Saving Configuration",
      success: { title: "Configuration saved", message: () => `Gitea authentication is now ${value === "1" ? "active" : "disabled"}.` },
      error: { title: "Error", message: () => "Failed to save configuration" },
    });
    await updateConfigPromise.then(() => setIsSubmitting(false)).catch((err) => { console.error(err); setIsSubmitting(false); });
  };

  const isGiteaEnabled = enableGiteaConfig === "1";

  return (
    <PageWrapper
      customHeader={
        <AuthenticationMethodCard
          name="Gitea"
          description="Allow members to login or sign up to plane with their Gitea accounts."
          icon={<img src={giteaLogo} height={24} width={24} alt="Gitea Logo" />}
          config={<ToggleSwitch value={isGiteaEnabled} onChange={() => updateConfig("IS_GITEA_ENABLED", isGiteaEnabled ? "0" : "1")} size="sm" disabled={isSubmitting || !formattedConfig} />}
          disabled={isSubmitting || !formattedConfig}
          withBorder={false}
        />
      }
    >
      {formattedConfig ? (
        <InstanceGiteaConfigForm config={formattedConfig} />
      ) : (
        <Loader className="space-y-8"><Loader.Item height="50px" width="25%" /><Loader.Item height="50px" /><Loader.Item height="50px" /><Loader.Item height="50px" /><Loader.Item height="50px" width="50%" /></Loader>
      )}
    </PageWrapper>
  );
});

export default InstanceGiteaAuthenticationPage;

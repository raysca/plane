import { useState } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { isEmpty } from "lodash-es";
import { Monitor } from "lucide-react";
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";
import { Button, getButtonStyling } from "@plane/propel/button";
import { setPromiseToast, TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IFormattedInstanceConfiguration, TInstanceGoogleAuthenticationConfigurationKeys } from "@plane/types";
import { Loader, ToggleSwitch } from "@plane/ui";
import GoogleLogo from "../../../assets/logos/google-logo.svg";
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

type GoogleConfigFormValues = Record<TInstanceGoogleAuthenticationConfigurationKeys, string>;

function InstanceGoogleConfigForm({ config }: { config: IFormattedInstanceConfiguration }) {
  const [isDiscardChangesModalOpen, setIsDiscardChangesModalOpen] = useState(false);
  const { updateInstanceConfigurations } = useInstance();
  const {
    handleSubmit, control, reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<GoogleConfigFormValues>({
    defaultValues: {
      GOOGLE_CLIENT_ID: config["GOOGLE_CLIENT_ID"],
      GOOGLE_CLIENT_SECRET: config["GOOGLE_CLIENT_SECRET"],
      ENABLE_GOOGLE_SYNC: config["ENABLE_GOOGLE_SYNC"] || "0",
    },
  });

  const originURL = !isEmpty(API_BASE_URL) ? API_BASE_URL : typeof window !== "undefined" ? window.location.origin : "";

  const GOOGLE_FORM_FIELDS: TControllerInputFormField[] = [
    { key: "GOOGLE_CLIENT_ID", type: "text", label: "Client ID", description: <>Your client ID lives in your Google API Console. <a tabIndex={-1} href="https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#creatingcred" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">Learn more</a></>, placeholder: "840195096245-0p2tstej9j5nc4l8o1ah2dqondscqc1g.apps.googleusercontent.com", error: Boolean(errors.GOOGLE_CLIENT_ID), required: true },
    { key: "GOOGLE_CLIENT_SECRET", type: "password", label: "Client secret", description: <>Your client secret should also be in your Google API Console. <a tabIndex={-1} href="https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">Learn more</a></>, placeholder: "GOCShX-ADp4cI0kPqav1gGCBg5bE02E", error: Boolean(errors.GOOGLE_CLIENT_SECRET), required: true },
  ];

  const GOOGLE_FORM_SWITCH_FIELD: TControllerSwitchFormField<GoogleConfigFormValues> = { name: "ENABLE_GOOGLE_SYNC", label: "Google" };

  const GOOGLE_COMMON_SERVICE_DETAILS: TCopyField[] = [
    { key: "Origin_URL", label: "Origin URL", url: originURL, description: <p>We will auto-generate this. Paste this into your <CodeBlock darkerShade>Authorized JavaScript origins</CodeBlock> field. For this OAuth client <a href="https://console.cloud.google.com/apis/credentials/oauthclient" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">here.</a></p> },
  ];

  const GOOGLE_SERVICE_DETAILS: TCopyField[] = [
    { key: "Callback_URI", label: "Callback URI", url: `${originURL}/auth/google/callback/`, description: <p>We will auto-generate this. Paste this into your <CodeBlock darkerShade>Authorized Redirect URI</CodeBlock> field. For this OAuth client <a href="https://console.cloud.google.com/apis/credentials/oauthclient" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">here.</a></p> },
  ];

  const onSubmit = async (formData: GoogleConfigFormValues) => {
    try {
      const response = await updateInstanceConfigurations(formData);
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Done!", message: "Your Google authentication is configured. You should test it now." });
      reset({
        GOOGLE_CLIENT_ID: response.find((item) => item.key === "GOOGLE_CLIENT_ID")?.value,
        GOOGLE_CLIENT_SECRET: response.find((item) => item.key === "GOOGLE_CLIENT_SECRET")?.value,
        ENABLE_GOOGLE_SYNC: response.find((item) => item.key === "ENABLE_GOOGLE_SYNC")?.value,
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
            <div className="pt-2.5 text-18 font-medium">Google-provided details for Plane</div>
            {GOOGLE_FORM_FIELDS.map((field) => (
              <ControllerInput key={field.key} control={control} type={field.type} name={field.key} label={field.label} description={field.description} placeholder={field.placeholder} error={field.error} required={field.required} />
            ))}
            <ControllerSwitch control={control} field={GOOGLE_FORM_SWITCH_FIELD} />
            <div className="flex flex-col gap-1 pt-4">
              <div className="flex items-center gap-4">
                <Button variant="primary" size="lg" onClick={(e) => void handleSubmit(onSubmit)(e)} loading={isSubmitting} disabled={!isDirty}>{isSubmitting ? "Saving" : "Save changes"}</Button>
                <Link to="/authentication" className={getButtonStyling("secondary", "lg")} onClick={handleGoBack}>Go back</Link>
              </div>
            </div>
          </div>
          <div className="col-span-2 md:col-span-1 flex flex-col gap-y-6">
            <div className="pt-2 text-18 font-medium">Plane-provided details for Google</div>
            <div className="flex flex-col gap-y-4">
              <div className="flex flex-col gap-y-4 px-6 py-4 bg-layer-1 rounded-lg">
                {GOOGLE_COMMON_SERVICE_DETAILS.map((field) => (
                  <CopyField key={field.key} label={field.label} url={field.url} description={field.description} />
                ))}
              </div>
              <div className="flex flex-col rounded-lg overflow-hidden">
                <div className="px-6 py-3 bg-layer-3 font-medium text-11 uppercase flex items-center gap-x-3 text-secondary"><Monitor className="w-3 h-3" />Web</div>
                <div className="px-6 py-4 flex flex-col gap-y-4 bg-layer-1">
                  {GOOGLE_SERVICE_DETAILS.map((field) => (
                    <CopyField key={field.key} label={field.label} url={field.url} description={field.description} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const InstanceGoogleAuthenticationPage = observer(function InstanceGoogleAuthenticationPage() {
  const { fetchInstanceConfigurations, formattedConfig, updateInstanceConfigurations } = useInstance();
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const enableGoogleConfig = formattedConfig?.IS_GOOGLE_ENABLED ?? "";

  useSWR("INSTANCE_CONFIGURATIONS", () => fetchInstanceConfigurations());

  const updateConfig = async (key: "IS_GOOGLE_ENABLED", value: string) => {
    setIsSubmitting(true);
    const updateConfigPromise = updateInstanceConfigurations({ [key]: value });
    setPromiseToast(updateConfigPromise, {
      loading: "Saving Configuration",
      success: { title: "Configuration saved", message: () => `Google authentication is now ${value === "1" ? "active" : "disabled"}.` },
      error: { title: "Error", message: () => "Failed to save configuration" },
    });
    await updateConfigPromise.then(() => setIsSubmitting(false)).catch((err) => { console.error(err); setIsSubmitting(false); });
  };

  return (
    <PageWrapper
      customHeader={
        <AuthenticationMethodCard
          name="Google"
          description="Allow members to login or sign up to plane with their Google accounts."
          icon={<img src={GoogleLogo} height={24} width={24} alt="Google Logo" />}
          config={<ToggleSwitch value={Boolean(parseInt(enableGoogleConfig))} onChange={() => { if (Boolean(parseInt(enableGoogleConfig)) === true) updateConfig("IS_GOOGLE_ENABLED", "0"); else updateConfig("IS_GOOGLE_ENABLED", "1"); }} size="sm" disabled={isSubmitting || !formattedConfig} />}
          disabled={isSubmitting || !formattedConfig}
          withBorder={false}
        />
      }
    >
      {formattedConfig ? (
        <InstanceGoogleConfigForm config={formattedConfig} />
      ) : (
        <Loader className="space-y-8"><Loader.Item height="50px" width="25%" /><Loader.Item height="50px" /><Loader.Item height="50px" /><Loader.Item height="50px" /><Loader.Item height="50px" width="50%" /></Loader>
      )}
    </PageWrapper>
  );
});

export default InstanceGoogleAuthenticationPage;

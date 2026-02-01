import { useState } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
import useSWR from "swr";
import { Telescope, MessageSquare } from "lucide-react";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IInstance, IInstanceAdmin, IFormattedInstanceConfiguration } from "@plane/types";
import { Input, ToggleSwitch } from "@plane/ui";
import { ControllerInput } from "../components/common/controller-input";
import { PageWrapper } from "../components/common/page-wrapper";
import { useInstance } from "../hooks/store";

// Intercom config sub-component
const IntercomConfig = observer(function IntercomConfig({ isTelemetryEnabled }: { isTelemetryEnabled: boolean }) {
  const { instanceConfigurations, updateInstanceConfigurations, fetchInstanceConfigurations } = useInstance();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isIntercomEnabled = isTelemetryEnabled
    ? instanceConfigurations ? instanceConfigurations?.find((c) => c.key === "IS_INTERCOM_ENABLED")?.value === "1" : undefined
    : false;
  const { isLoading } = useSWR(isTelemetryEnabled ? "INSTANCE_CONFIGURATIONS" : null, () => isTelemetryEnabled ? fetchInstanceConfigurations() : null);
  const initialLoader = isLoading && isIntercomEnabled === undefined;

  return (
    <div className="flex items-center gap-14">
      <div className="grow flex items-center gap-4">
        <div className="shrink-0"><div className="flex items-center justify-center size-11 bg-layer-1 rounded-lg"><MessageSquare className="size-5 text-tertiary p-0.5" /></div></div>
        <div className="grow">
          <div className="text-13 font-medium text-primary leading-5">Chat with us</div>
          <div className="text-11 font-regular text-tertiary leading-5">Let your users chat with us via Intercom. Toggling Telemetry off turns this off automatically.</div>
        </div>
        <div className="ml-auto">
          <ToggleSwitch value={isIntercomEnabled ? true : false} onChange={() => { setIsSubmitting(true); updateInstanceConfigurations({ IS_INTERCOM_ENABLED: isIntercomEnabled ? "0" : "1" }).finally(() => setIsSubmitting(false)); }} size="sm" disabled={!isTelemetryEnabled || isSubmitting || initialLoader} />
        </div>
      </div>
    </div>
  );
});

// General form
const GeneralConfigurationForm = observer(function GeneralConfigurationForm({ instance, instanceAdmins }: { instance: IInstance; instanceAdmins: IInstanceAdmin[] }) {
  const { instanceConfigurations, updateInstanceInfo, updateInstanceConfigurations } = useInstance();
  const { handleSubmit, control, formState: { errors, isSubmitting }, watch } = useForm<Partial<IInstance>>({
    defaultValues: { instance_name: instance?.instance_name, is_telemetry_enabled: instance?.is_telemetry_enabled },
  });

  const onSubmit = async (formData: Partial<IInstance>) => {
    const payload = { ...formData };
    const isIntercomEnabled = instanceConfigurations?.find((c) => c.key === "IS_INTERCOM_ENABLED")?.value === "1";
    if (!payload.is_telemetry_enabled && isIntercomEnabled) {
      try { await updateInstanceConfigurations({ IS_INTERCOM_ENABLED: "0" }); } catch (e) { console.error(e); }
    }
    await updateInstanceInfo(payload)
      .then(() => setToast({ type: TOAST_TYPE.SUCCESS, title: "Success", message: "Settings updated successfully" }))
      .catch((err) => console.error(err));
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="text-16 font-medium text-primary">Instance details</div>
        <div className="grid-col grid w-full grid-cols-1 items-center justify-between gap-8 md:grid-cols-2 lg:grid-cols-3">
          <ControllerInput key="instance_name" name="instance_name" control={control} type="text" label="Name of instance" placeholder="Instance name" error={Boolean(errors.instance_name)} required />
          <div className="flex flex-col gap-1">
            <h4 className="text-13 text-tertiary">Email</h4>
            <Input id="email" name="email" type="email" value={instanceAdmins[0]?.user_detail?.email ?? ""} placeholder="Admin email" className="w-full cursor-not-allowed !text-placeholder" autoComplete="on" disabled />
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-13 text-tertiary">Instance ID</h4>
            <Input id="instance_id" name="instance_id" type="text" value={instance.instance_id} className="w-full cursor-not-allowed rounded-md font-medium !text-placeholder" disabled />
          </div>
        </div>
      </div>
      <div className="space-y-6">
        <div className="text-16 font-medium text-primary pb-1.5 border-b border-subtle">Chat + telemetry</div>
        <IntercomConfig isTelemetryEnabled={watch("is_telemetry_enabled") ?? false} />
        <div className="flex items-center gap-14">
          <div className="grow flex items-center gap-4">
            <div className="shrink-0"><div className="flex items-center justify-center size-11 bg-layer-1 rounded-lg"><Telescope className="size-5 text-tertiary" /></div></div>
            <div className="grow">
              <div className="text-13 font-medium text-primary leading-5">Let Plane collect anonymous usage data</div>
              <div className="text-11 font-regular text-tertiary leading-5">No PII is collected. <a href="https://developers.plane.so/self-hosting/telemetry" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">Our Telemetry Policy.</a></div>
            </div>
          </div>
          <div className={`shrink-0 ${isSubmitting && "opacity-70"}`}>
            <Controller control={control} name="is_telemetry_enabled" render={({ field: { value, onChange } }) => (<ToggleSwitch value={value ?? false} onChange={onChange} size="sm" disabled={isSubmitting} />)} />
          </div>
        </div>
      </div>
      <div>
        <Button variant="primary" size="lg" onClick={() => { void handleSubmit(onSubmit)(); }} loading={isSubmitting}>{isSubmitting ? "Saving" : "Save changes"}</Button>
      </div>
    </div>
  );
});

function GeneralPage() {
  const { instance, instanceAdmins } = useInstance();
  return (
    <PageWrapper header={{ title: "General settings", description: "Change the name of your instance and instance admin e-mail addresses. Enable or disable telemetry in your instance." }}>
      {instance && instanceAdmins && <GeneralConfigurationForm instance={instance} instanceAdmins={instanceAdmins} />}
    </PageWrapper>
  );
}

export default observer(GeneralPage);

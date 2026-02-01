import { observer } from "mobx-react";
import { useForm } from "react-hook-form";
import { Lightbulb } from "lucide-react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IFormattedInstanceConfiguration, TInstanceAIConfigurationKeys } from "@plane/types";
import { Loader } from "@plane/ui";
import type { TControllerInputFormField } from "../../components/common/controller-input";
import { ControllerInput } from "../../components/common/controller-input";
import { PageWrapper } from "../../components/common/page-wrapper";
import { useInstance } from "../../hooks/store";

type AIFormValues = Record<TInstanceAIConfigurationKeys, string>;

function InstanceAIForm({ config }: { config: IFormattedInstanceConfiguration }) {
  const { updateInstanceConfigurations } = useInstance();
  const {
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AIFormValues>({
    defaultValues: {
      LLM_API_KEY: config["LLM_API_KEY"],
      LLM_MODEL: config["LLM_MODEL"],
    },
  });

  const aiFormFields: TControllerInputFormField[] = [
    {
      key: "LLM_MODEL",
      type: "text",
      label: "LLM Model",
      description: (
        <>
          Choose an OpenAI engine.{" "}
          <a href="https://platform.openai.com/docs/models/overview" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">
            Learn more
          </a>
        </>
      ),
      placeholder: "gpt-4o-mini",
      error: Boolean(errors.LLM_MODEL),
      required: false,
    },
    {
      key: "LLM_API_KEY",
      type: "password",
      label: "API key",
      description: (
        <>
          You will find your API key{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" className="text-accent-primary hover:underline" rel="noreferrer">
            here.
          </a>
        </>
      ),
      placeholder: "sk-asddassdfasdefqsdfasd23das3dasdcasd",
      error: Boolean(errors.LLM_API_KEY),
      required: false,
    },
  ];

  const onSubmit = async (formData: AIFormValues) => {
    const payload: Partial<AIFormValues> = { ...formData };
    await updateInstanceConfigurations(payload)
      .then(() => setToast({ type: TOAST_TYPE.SUCCESS, title: "Success", message: "AI Settings updated successfully" }))
      .catch((err) => console.error(err));
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <div className="pb-1 text-18 font-medium text-primary">OpenAI</div>
          <div className="text-13 font-regular text-tertiary">If you use ChatGPT, this is for you.</div>
        </div>
        <div className="grid-col grid w-full grid-cols-1 items-center justify-between gap-x-12 gap-y-8 lg:grid-cols-3">
          {aiFormFields.map((field) => (
            <ControllerInput key={field.key} control={control} type={field.type} name={field.key} label={field.label} description={field.description} placeholder={field.placeholder} error={field.error} required={field.required} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4 items-start">
        <Button variant="primary" size="lg" onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
          {isSubmitting ? "Saving" : "Save changes"}
        </Button>
        <div className="relative inline-flex items-center gap-1.5 rounded-sm border border-accent-subtle bg-accent-subtle px-4 py-2 text-caption-sm-regular text-accent-secondary">
          <Lightbulb className="size-4" />
          <div>
            If you have a preferred AI models vendor, please get in{" "}
            <a className="underline font-medium" href="https://plane.so/contact">touch with us.</a>
          </div>
        </div>
      </div>
    </div>
  );
}

const InstanceAIPage = observer(function InstanceAIPage() {
  const { fetchInstanceConfigurations, formattedConfig } = useInstance();
  useSWR("INSTANCE_CONFIGURATIONS", () => fetchInstanceConfigurations());

  return (
    <PageWrapper
      header={{
        title: "AI features for all your workspaces",
        description: "Configure your AI API credentials so Plane AI features are turned on for all your workspaces.",
      }}
    >
      {formattedConfig ? (
        <InstanceAIForm config={formattedConfig} />
      ) : (
        <Loader className="space-y-8">
          <Loader.Item height="50px" width="40%" />
          <div className="w-2/3 grid grid-cols-2 gap-x-8 gap-y-4">
            <Loader.Item height="50px" />
            <Loader.Item height="50px" />
          </div>
          <Loader.Item height="50px" width="20%" />
        </Loader>
      )}
    </PageWrapper>
  );
});

export default InstanceAIPage;

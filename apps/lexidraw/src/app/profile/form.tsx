"use client";

import { useForm, type SubmitHandler } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { ProfileSchema } from "./schema";
import FormProvider, {
  RHFTextField,
  RHFSlider,
  RHFSelect,
  RHFCheckbox,
  RHFModelSelect,
  RHFSwitch,
} from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "~/components/ui/tabs";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import type { RouterOutputs } from "~/trpc/shared";
import { useSession } from "next-auth/react";
import { ReloadIcon } from "@radix-ui/react-icons";
import { SelectItem } from "~/components/ui/select";
import { useMemo } from "react";
// Removed useAutoSave to make auto-save part of form submission

type Props = { user: RouterOutputs["auth"]["getProfile"] };

type PolicyType = {
  mode: "chat" | "agent" | "autocomplete";
  provider: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  allowedModels: Array<{ provider: string; modelId: string }>;
  enforcedCaps: {
    maxOutputTokensByProvider: { openai: number; google: number };
  };
  extraConfig: Record<string, unknown> | null | undefined;
};

function LLMSection({
  mode,
  policy,
  prefix,
}: {
  mode: "chat" | "agent" | "autocomplete";
  policy: PolicyType | undefined;
  prefix: string;
}) {
  if (!policy) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <RHFSelect name={`${prefix}.provider`} label="Provider">
          <SelectItem value="openai">OpenAI</SelectItem>
          <SelectItem value="google">Google</SelectItem>
        </RHFSelect>
        <RHFModelSelect
          name={`${prefix}.modelId`}
          label="Model"
          providerName={`${prefix}.provider`}
          allowedModels={policy.allowedModels}
          helperText={
            policy.modelId
              ? `Policy default: ${policy.provider}:${policy.modelId}`
              : undefined
          }
        />
        <RHFSlider
          name={`${prefix}.temperature`}
          label="Temperature (0-1)"
          min={0}
          max={1}
          step={0.01}
          helperText={
            policy.temperature !== undefined
              ? `Policy default: ${policy.temperature}`
              : undefined
          }
        />
        <RHFTextField
          label="Max output tokens"
          type="number"
          name={`${prefix}.maxOutputTokens`}
          helperText={
            policy.maxOutputTokens
              ? `Policy default: ${policy.maxOutputTokens}`
              : undefined
          }
        />
        {mode === "autocomplete" && (
          <>
            <RHFSelect
              name={`${prefix}.reasoningEffort`}
              label="Reasoning Effort"
            >
              <SelectItem value="minimal">Minimal</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="heavy">Heavy</SelectItem>
            </RHFSelect>
            <RHFSelect name={`${prefix}.verbosity`} label="Verbosity">
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </RHFSelect>
          </>
        )}
      </div>
    </div>
  );
}

export default function ProfileForm({ user }: Props) {
  const { data: session, update } = useSession();
  const utils = api.useUtils();

  // Fetch policy defaults
  const { data: policies } = api.adminLlm.policies.getDefaults.useQuery();

  const { mutate: saveProfile, isPending } =
    api.auth.updateProfile.useMutation();

  // Create policy map for easy lookup
  const policyMap = useMemo(() => {
    if (!policies) return new Map();
    return new Map(policies.map((p) => [p.mode, p] as const));
  }, [policies]);

  const chatPolicy = policyMap.get("chat");
  const agentPolicy = policyMap.get("agent");
  const autocompletePolicy = policyMap.get("autocomplete");

  const methods = useForm({
    resolver: standardSchemaResolver(ProfileSchema),
    defaultValues: {
      email: user?.email ?? "",
      name: user?.name ?? "",
      chat: user?.config?.llm?.chat ?? undefined,
      autoSave: user?.config?.autoSave?.enabled ?? false,
      agent:
        (user?.config?.llm as { agent?: unknown } | undefined)?.agent ??
        undefined,
      autocomplete: {
        ...user?.config?.llm?.autocomplete,
        reasoningEffort: user?.config?.autocomplete?.reasoningEffort,
        verbosity: user?.config?.autocomplete?.verbosity,
      },
      tts: {
        provider: user?.config?.tts?.provider,
        voiceId: user?.config?.tts?.voiceId,
        speed: user?.config?.tts?.speed,
        format: user?.config?.tts?.format,
        languageCode: user?.config?.tts?.languageCode,
        sampleRate: user?.config?.tts?.sampleRate,
      },
      articles: {
        languageCode: user?.config?.articles?.languageCode,
        maxChars: user?.config?.articles?.maxChars,
        keepQuotes: user?.config?.articles?.keepQuotes,
        autoGenerateAudioOnImport:
          user?.config?.articles?.autoGenerateAudioOnImport,
      },
    },
    mode: "onBlur",
  });

  const {
    reset,
    handleSubmit,
    formState: { isDirty },
  } = methods;

  const onSubmit: SubmitHandler<ProfileSchema> = async (data) => {
    saveProfile(data, {
      onSuccess: async () => {
        toast.success("Profile saved");
        reset(data);
        await update({
          ...session,
          user: {
            ...session?.user,
            email: data.email,
            name: data.name,
            config: {
              ...session?.user.config,
              autoSave: data.autoSave
                ? { enabled: data.autoSave }
                : session?.user.config?.autoSave,
              llm: {
                ...session?.user.config?.llm,
                chat: data.chat,
                agent: data.agent,
                autocomplete: data.autocomplete,
              },
              tts: data.tts
                ? { ...session?.user.config?.tts, ...data.tts }
                : session?.user.config?.tts,
              articles: data.articles
                ? { ...session?.user.config?.articles, ...data.articles }
                : session?.user.config?.articles,
            },
          },
        });
        // Keep hooks in sync
        utils.config.getAutoSaveConfig.invalidate();
      },
      onError: (error) => {
        toast.error("Error saving profile", {
          description: error.message,
        });
      },
    });
  };

  return (
    <div>
      <FormProvider methods={methods} onSubmit={handleSubmit(onSubmit)}>
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="w-full flex flex-wrap h-auto">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="agent">Agent</TabsTrigger>
            <TabsTrigger value="autocomplete">Autocomplete</TabsTrigger>
            <TabsTrigger value="audio">Audio</TabsTrigger>
            <TabsTrigger value="articles">Articles</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 py-4">
            <RHFTextField label="Email" name="email" type="email" />
            <RHFTextField label="Name" name="name" type="name" />
            <RHFSwitch label="Auto save" name="autoSave" />
          </TabsContent>

          <TabsContent value="chat" className="space-y-4 py-4">
            <LLMSection mode="chat" policy={chatPolicy} prefix="chat" />
          </TabsContent>

          <TabsContent value="agent" className="space-y-4 py-4">
            <LLMSection mode="agent" policy={agentPolicy} prefix="agent" />
          </TabsContent>

          <TabsContent value="autocomplete" className="space-y-4 py-4">
            <LLMSection
              mode="autocomplete"
              policy={autocompletePolicy}
              prefix="autocomplete"
            />
          </TabsContent>

          <TabsContent value="audio" className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RHFSelect name="tts.provider" label="Provider">
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="kokoro">Kokoro (local)</SelectItem>
              </RHFSelect>
              <RHFTextField label="Voice ID" name="tts.voiceId" />
              <RHFSlider
                name="tts.speed"
                label="Speed"
                min={0.25}
                max={4}
                step={0.05}
              />
              <RHFSelect name="tts.format" label="Format">
                <SelectItem value="mp3">MP3</SelectItem>
                <SelectItem value="ogg">OGG</SelectItem>
                <SelectItem value="wav">WAV</SelectItem>
              </RHFSelect>
              <RHFTextField label="Language code" name="tts.languageCode" />
              <RHFTextField
                label="Sample rate"
                name="tts.sampleRate"
                type="number"
              />
            </div>
          </TabsContent>

          <TabsContent value="articles" className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RHFTextField
                label="Language code"
                name="articles.languageCode"
              />
              <RHFTextField
                label="Max chars"
                name="articles.maxChars"
                type="number"
              />
              <RHFCheckbox label="Keep quotes" name="articles.keepQuotes" />
              <RHFCheckbox
                label="Auto-generate audio on import"
                name="articles.autoGenerateAudioOnImport"
              />
            </div>
          </TabsContent>
        </Tabs>

        <div className="pt-4 border-t border-border mt-4">
          <Button
            className="w-full"
            type="submit"
            disabled={!isDirty || isPending}
          >
            <ReloadIcon
              className={`animate-spin w-4 mr-2 ${!isPending && "opacity-0"}`}
            />
            Save
            <div className="w-4 ml-2 opacity-0" />
          </Button>
        </div>
      </FormProvider>
    </div>
  );
}

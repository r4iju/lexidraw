"use client";

import { useForm, type SubmitHandler } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { ProfileSchema } from "./schema";
import FormProvider, {
  RHFTextField,
  RHFSlider,
  RHFSelect,
  RHFCheckbox,
} from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { api } from "~/trpc/react";
import { toast } from "sonner";
import type { RouterOutputs } from "~/trpc/shared";
import { useSession } from "next-auth/react";
import { ReloadIcon } from "@radix-ui/react-icons";

type Props = { user: RouterOutputs["auth"]["getProfile"] };

export default function ProfileForm({ user }: Props) {
  const { data: session, update } = useSession();

  const { mutate: saveProfile, isPending } =
    api.auth.updateProfile.useMutation();
  const methods = useForm({
    resolver: standardSchemaResolver(ProfileSchema),
    defaultValues: {
      email: user?.email ?? "",
      name: user?.name ?? "",
      googleApiKey: user?.config?.llm?.googleApiKey ?? "",
      openaiApiKey: user?.config?.llm?.openaiApiKey ?? "",
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
    console.log("data", data);
    saveProfile(data, {
      onSuccess: async () => {
        toast.success("Profile saved");
        reset(data);
        const updated = await update({
          ...session,
          user: {
            ...session?.user,
            email: data.email,
            name: data.name,
            config: {
              ...session?.user.config,
              llm: {
                googleApiKey: data.googleApiKey ?? "",
                openaiApiKey: data.openaiApiKey ?? "",
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
        console.log("updated", updated);
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
        <div className="space-y-4 py-4">
          <RHFTextField label="Email" name="email" type="email" />
          <RHFTextField label="Name" name="name" type="name" />
          <RHFTextField
            label="Google API Key"
            name="googleApiKey"
            type="googleApiKey"
          />
          <RHFTextField
            label="OpenAI API Key"
            name="openaiApiKey"
            type="openaiApiKey"
          />
          <div className="pt-2 border-t">
            <div className="text-sm font-medium">Audio generation (TTS)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <RHFSelect name="tts.provider" label="Provider">
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
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
                <option value="mp3">MP3</option>
                <option value="ogg">OGG</option>
                <option value="wav">WAV</option>
              </RHFSelect>
              <RHFTextField label="Language code" name="tts.languageCode" />
              <RHFTextField
                label="Sample rate"
                name="tts.sampleRate"
                type="number"
              />
            </div>
          </div>
          <div className="pt-2 border-t">
            <div className="text-sm font-medium">Articles</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
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
          </div>
        </div>
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
      </FormProvider>
    </div>
  );
}

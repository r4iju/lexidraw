"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { type ReactNode, useId, useState } from "react";
import { Controller, useForm, useFormContext } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import FormProvider, { RHFTextField } from "~/components/hook-form";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { modelLabel } from "~/lib/model-label";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { type SettingsInput, TTS_DEFAULTS, TTS_PROVIDERS } from "./schema";

type Mode = "chat" | "agent" | "autocomplete";
type Policy = Pick<
  RouterOutputs["adminLlm"]["policies"]["getDefaults"][number],
  "provider" | "modelId" | "temperature" | "maxOutputTokens" | "allowedModels"
> & { mode: string };
type StoredOverride = {
  provider?: string;
  modelId?: string;
  temperature?: number;
  maxOutputTokens?: number;
  enabled?: boolean;
  reasoningEffort?: string;
  verbosity?: string;
};

/** The select value that means "whatever the default is". */
const DEFAULT = "default";

const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: "chat", label: "Chat", hint: "Answers questions in the side panel." },
  {
    mode: "agent",
    label: "Agent",
    hint: "Edits your document when you ask it to.",
  },
  {
    mode: "autocomplete",
    label: "Autocomplete",
    hint: "Suggests the rest of your sentence as you type.",
  },
];

const TTS_PROVIDER_LABEL: Record<(typeof TTS_PROVIDERS)[number], string> = {
  openai: "OpenAI",
  google: "Google",
  kokoro: "Kokoro (runs locally)",
};

const THEMES = [
  { value: "system", label: "Match your device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const ModelValues = z.object({
  model: z.string(),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z
    .number({ error: "Enter a number." })
    .int("Enter a whole number.")
    .positive("Enter a number above 0."),
});

const FormValues = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter your email address."),
  autoSave: z.boolean(),
  chat: ModelValues,
  agent: ModelValues,
  autocomplete: ModelValues.extend({
    enabled: z.boolean(),
    reasoningEffort: z.string(),
    verbosity: z.string(),
  }),
  tts: z.object({
    provider: z.string(),
    voiceId: z.string(),
    speed: z.number().min(0.25).max(4),
    languageCode: z.string(),
  }),
});
type FormValues = z.infer<typeof FormValues>;

type Props = {
  user: Pick<
    RouterOutputs["auth"]["getProfile"],
    "id" | "name" | "email" | "config"
  >;
  autoSave: boolean;
  policies: Policy[];
  onSave: (settings: SettingsInput) => Promise<void>;
};

function modelValue(provider: string, modelId: string) {
  return `${provider}:${modelId}`;
}

function storedOverrides(config: Props["user"]["config"], mode: Mode) {
  const source =
    mode === "autocomplete"
      ? (config as { autocomplete?: unknown } | null)?.autocomplete
      : (config?.llm as Record<string, unknown> | undefined)?.[mode];
  return (source ?? {}) as StoredOverride;
}

function initialValues({ user, autoSave, policies }: Props): FormValues {
  const policyFor = (mode: Mode) => policies.find((p) => p.mode === mode);
  const model = (mode: Mode) => {
    const stored = storedOverrides(user.config, mode);
    const policy = policyFor(mode);
    return {
      model:
        stored.provider && stored.modelId
          ? modelValue(stored.provider, stored.modelId)
          : DEFAULT,
      temperature: stored.temperature ?? policy?.temperature ?? 0.5,
      maxOutputTokens:
        stored.maxOutputTokens ?? policy?.maxOutputTokens ?? 1000,
    };
  };
  const autocomplete = storedOverrides(user.config, "autocomplete");
  const tts = (user.config?.tts ?? {}) as Partial<Record<string, unknown>>;
  return {
    name: user.name ?? "",
    email: user.email ?? "",
    autoSave,
    chat: model("chat"),
    agent: model("agent"),
    autocomplete: {
      ...model("autocomplete"),
      enabled: autocomplete.enabled !== false,
      reasoningEffort: autocomplete.reasoningEffort ?? DEFAULT,
      verbosity: autocomplete.verbosity ?? DEFAULT,
    },
    tts: {
      provider:
        typeof tts.provider === "string" &&
        (TTS_PROVIDERS as readonly string[]).includes(tts.provider)
          ? tts.provider
          : DEFAULT,
      voiceId: typeof tts.voiceId === "string" ? tts.voiceId : "",
      speed: typeof tts.speed === "number" ? tts.speed : TTS_DEFAULTS.speed,
      languageCode:
        typeof tts.languageCode === "string" ? tts.languageCode : "",
    },
  };
}

/** What the form means for the server: anything left at its default is cleared. */
function toSettings(values: FormValues, policies: Policy[]): SettingsInput {
  const model = (mode: Mode) => {
    const policy = policies.find((p) => p.mode === mode);
    const { model, temperature, maxOutputTokens } = values[mode];
    const split = model.indexOf(":");
    const pinned = model !== DEFAULT && split > 0;
    return {
      provider: pinned ? model.slice(0, split) : null,
      modelId: pinned ? model.slice(split + 1) : null,
      temperature: temperature === policy?.temperature ? null : temperature,
      maxOutputTokens:
        maxOutputTokens === policy?.maxOutputTokens ? null : maxOutputTokens,
    };
  };
  const { autocomplete, tts } = values;
  return {
    name: values.name,
    email: values.email,
    autoSave: values.autoSave,
    chat: model("chat"),
    agent: model("agent"),
    autocomplete: {
      ...model("autocomplete"),
      enabled: autocomplete.enabled,
      reasoningEffort:
        autocomplete.reasoningEffort === DEFAULT
          ? null
          : (autocomplete.reasoningEffort as "minimal" | "standard" | "heavy"),
      verbosity:
        autocomplete.verbosity === DEFAULT
          ? null
          : (autocomplete.verbosity as "low" | "medium" | "high"),
    },
    tts: {
      provider:
        tts.provider === DEFAULT
          ? null
          : (tts.provider as (typeof TTS_PROVIDERS)[number]),
      voiceId: tts.voiceId.trim() || null,
      speed: tts.speed === TTS_DEFAULTS.speed ? null : tts.speed,
      languageCode: tts.languageCode.trim() || null,
    },
  };
}

function Section({
  id,
  title,
  purpose,
  children,
}: {
  id: string;
  title: string;
  purpose: string;
  children: ReactNode;
}) {
  // With the page's 1rem scroll padding, a section jumped to lines up with
  // the nav held 2rem under the app bar.
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="flex scroll-mt-[calc(var(--app-bar-height)+1rem)] flex-col gap-1"
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{purpose}</p>
      <div className="mt-5 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function SelectField({
  name,
  label,
  hint,
  children,
}: {
  name: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  const { control } = useFormContext();
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger
              id={id}
              aria-label={label}
              aria-describedby={hint ? `${id}-hint` : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>{children}</SelectContent>
          </Select>
        )}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

function SliderField({
  name,
  label,
  min,
  max,
  step,
  defaultValue,
  format = String,
}: {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format?: (value: number) => string;
}) {
  const { control } = useFormContext();
  const id = useId();
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-4">
            <Label htmlFor={id}>{label}</Label>
            <span className="text-sm text-muted-foreground tabular-nums">
              {format(field.value)}
              {field.value === defaultValue && " (default)"}
            </span>
          </div>
          <input
            id={id}
            type="range"
            name={field.name}
            ref={field.ref}
            min={min}
            max={max}
            step={step}
            value={field.value}
            onBlur={field.onBlur}
            onChange={(event) => field.onChange(Number(event.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
          />
        </div>
      )}
    />
  );
}

function SwitchField({
  name,
  label,
  hint,
}: {
  name: string;
  label: string;
  hint?: string;
}) {
  const { control } = useFormContext();
  const id = useId();
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor={id}>{label}</Label>
            {hint && (
              <p id={`${id}-hint`} className="text-sm text-muted-foreground">
                {hint}
              </p>
            )}
          </div>
          <Switch
            id={id}
            checked={field.value}
            onCheckedChange={field.onChange}
            aria-describedby={hint ? `${id}-hint` : undefined}
          />
        </div>
      )}
    />
  );
}

function ModelSettings({
  mode,
  label,
  hint,
  policy,
}: {
  mode: Mode;
  label: string;
  hint: string;
  policy: Policy | undefined;
}) {
  const allowed = policy?.allowedModels ?? [];
  return (
    <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <p className="-mt-2 text-sm text-muted-foreground">{hint}</p>
      {mode === "autocomplete" && (
        <SwitchField name="autocomplete.enabled" label="Suggest as you type" />
      )}
      <SelectField name={`${mode}.model`} label={`${label} model`}>
        <SelectItem value={DEFAULT}>
          {policy ? `Default (${modelLabel(policy.modelId)})` : "Default"}
        </SelectItem>
        {allowed.map((option) => (
          <SelectItem
            key={modelValue(option.provider, option.modelId)}
            value={modelValue(option.provider, option.modelId)}
          >
            {modelLabel(option.modelId)}
          </SelectItem>
        ))}
      </SelectField>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          Advanced
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <SliderField
            name={`${mode}.temperature`}
            label="Creativity (temperature)"
            min={0}
            max={1}
            step={0.05}
            defaultValue={policy?.temperature ?? 0.5}
          />
          <RHFTextField
            name={`${mode}.maxOutputTokens`}
            label="Longest answer, in tokens"
            type="number"
            helperText={
              policy
                ? `Default ${policy.maxOutputTokens.toLocaleString("en-US")}.`
                : undefined
            }
          />
          {mode === "autocomplete" && (
            <>
              <SelectField
                name="autocomplete.reasoningEffort"
                label="Reasoning effort"
              >
                <SelectItem value={DEFAULT}>Default</SelectItem>
                <SelectItem value="minimal">Minimal</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="heavy">Heavy</SelectItem>
              </SelectField>
              <SelectField
                name="autocomplete.verbosity"
                label="Suggestion length"
              >
                <SelectItem value={DEFAULT}>Default</SelectItem>
                <SelectItem value="low">Short</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">Long</SelectItem>
              </SelectField>
            </>
          )}
        </div>
      </details>
    </fieldset>
  );
}

function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Theme</Label>
      <Select value={theme ?? "system"} onValueChange={setTheme}>
        <SelectTrigger id={id} aria-describedby={`${id}-hint`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEMES.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        Changes right away, on this device.
      </p>
    </div>
  );
}

export function SettingsForm(props: Props) {
  const { policies, onSave } = props;
  const [saving, setSaving] = useState(false);
  const methods = useForm<FormValues>({
    resolver: standardSchemaResolver(FormValues),
    defaultValues: initialValues(props),
    mode: "onBlur",
  });
  const {
    handleSubmit,
    reset,
    formState: { isDirty },
  } = methods;

  const submit = handleSubmit(async (values) => {
    setSaving(true);
    try {
      await onSave(toSettings(values, policies));
      reset(values);
    } catch {
      // The caller has said what went wrong; the changes stay to try again.
    } finally {
      setSaving(false);
    }
  });

  return (
    <FormProvider methods={methods} onSubmit={submit}>
      <div className="flex flex-col gap-12">
        <Section
          id="settings-account"
          title="Account"
          purpose="Your name is shown to people you share files with."
        >
          <RHFTextField name="name" label="Name" autoComplete="name" />
          <RHFTextField
            name="email"
            label="Email"
            type="email"
            autoComplete="email"
          />
          <Button asChild variant="outline" className="self-start">
            <Link href="/signout">Sign out</Link>
          </Button>
        </Section>

        <Section
          id="settings-editor"
          title="Editor"
          purpose="How documents and drawings behave while you work."
        >
          <SwitchField
            name="autoSave"
            label="Auto-save"
            hint="Saves your changes a moment after you stop typing."
          />
          <ThemeSelect />
        </Section>

        <Section
          id="settings-ai"
          title="AI"
          purpose="Which models help you write. Leave them on Default to get improvements as they ship."
        >
          {MODES.map(({ mode, label, hint }) => (
            <ModelSettings
              key={mode}
              mode={mode}
              label={label}
              hint={hint}
              policy={policies.find((p) => p.mode === mode)}
            />
          ))}
        </Section>

        <Section
          id="settings-read-aloud"
          title="Read aloud"
          purpose="The voice that reads documents and saved links to you."
        >
          <SelectField name="tts.provider" label="Voice service">
            <SelectItem value={DEFAULT}>
              Default ({TTS_PROVIDER_LABEL[TTS_DEFAULTS.provider]})
            </SelectItem>
            {TTS_PROVIDERS.map((provider) => (
              <SelectItem key={provider} value={provider}>
                {TTS_PROVIDER_LABEL[provider]}
              </SelectItem>
            ))}
          </SelectField>
          <RHFTextField
            name="tts.voiceId"
            label="Voice"
            placeholder={`Default (${TTS_DEFAULTS.voiceId})`}
          />
          <SliderField
            name="tts.speed"
            label="Speed"
            min={0.5}
            max={2}
            step={0.05}
            defaultValue={TTS_DEFAULTS.speed}
            format={(value) => `${value}×`}
          />
          <RHFTextField
            name="tts.languageCode"
            label="Language"
            placeholder={`Default (${TTS_DEFAULTS.languageCode})`}
            helperText="A language code, such as en-US or sv-SE."
          />
        </Section>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex justify-end border-t border-border bg-background/95 px-4 py-3 backdrop-blur-xs">
        <Button type="submit" disabled={!isDirty || saving} pending={saving}>
          {isDirty || saving ? "Save changes" : "No changes"}
        </Button>
      </div>
    </FormProvider>
  );
}

/** Settings, wired to the server and to the signed-in session. */
export function SettingsFormSection(props: Omit<Props, "onSave">) {
  const { update } = useSession();
  const utils = api.useUtils();
  const save = api.auth.updateProfile.useMutation();
  return (
    <SettingsForm
      {...props}
      onSave={async (settings) => {
        try {
          await save.mutateAsync(settings);
        } catch (error) {
          toast.error("Couldn’t save your settings. Try again.", {
            description: error instanceof Error ? error.message : undefined,
          });
          throw error;
        }
        // The session carries the settings the AI routes read. Given data,
        // however little, `update` has the server read them again; without,
        // it only fetches the session as it was.
        await update({});
        await utils.config.invalidate();
        toast.success("Settings saved.");
      }}
    />
  );
}

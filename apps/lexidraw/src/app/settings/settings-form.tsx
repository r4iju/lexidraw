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
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/shared";
import { type SettingsInput, TTS_DEFAULTS } from "./schema";

type Policy = RouterOutputs["adminLlm"]["policies"]["getDefaults"][number];
const THEMES = [
  { value: "system", label: "Match your device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const FormValues = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter your email address."),
  autoSave: z.boolean(),
  autocomplete: z.object({ enabled: z.boolean() }),
  tts: z.object({ speed: z.number().min(0.25).max(4) }),
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

function initialValues({ user, autoSave }: Props): FormValues {
  return {
    name: user.name ?? "",
    email: user.email ?? "",
    autoSave,
    autocomplete: { enabled: user.config?.autocomplete?.enabled === true },
    tts: {
      speed: user.config?.audio?.preferredPlaybackRate ?? TTS_DEFAULTS.speed,
    },
  };
}
function toSettings(values: FormValues): SettingsInput {
  return {
    name: values.name,
    email: values.email,
    autoSave: values.autoSave,
    autocomplete: { enabled: values.autocomplete.enabled },
    tts: {
      speed: values.tts.speed === TTS_DEFAULTS.speed ? null : values.tts.speed,
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
  const { onSave } = props;
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
      await onSave(toSettings(values));
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
          purpose="One tuned experience powered by your account AI Power choice."
        >
          <SwitchField
            name="autocomplete.enabled"
            label="Writing suggestions"
            hint="Opt in to short suggestions using your account AI power source. Pro usage is metered in aggregate. Accept explicitly; writing stays yours."
          />
          <Link href="#settings-ai-power">Manage AI Power</Link>
          <p>
            Cloud AI is changing to private Pro access or a key held on each
            device. Built-in local capabilities remain free where supported.
            Your documents, drawings and saved recordings are preserved. Pro is
            Coming soon for public accounts.
          </p>
        </Section>

        <Section
          id="settings-read-aloud"
          title="Read aloud"
          purpose="The voice that reads documents and saved links to you."
        >
          <p>
            Choose narration in AI Power. Saved recordings remain free to play,
            including after credits run out. Built-in Apple voices are available
            on iOS.
          </p>
          <SliderField
            name="tts.speed"
            label="Saved playback speed"
            min={0.5}
            max={2}
            step={0.05}
            defaultValue={TTS_DEFAULTS.speed}
            format={(value) => `${value}×`}
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
  const save = api.auth.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.auth.getProfile.invalidate();
      await utils.config.invalidate();
    },
  });
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

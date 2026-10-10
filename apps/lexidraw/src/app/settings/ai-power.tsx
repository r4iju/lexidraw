"use client";
import { ProTrialSection, type ProStatus } from "./pro-trial";
import { ProviderKeyInput } from "./provider-key-input";
import { useState, useSyncExternalStore } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { browserByok } from "~/lib/byok/browser-session";
import type { PowerPreference } from "~/lib/byok/preference";
import { api } from "~/trpc/react";

type Activity =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "error" }
  | { status: "done"; text: string };
const noCredential = () => undefined;
export function AiPowerSection({
  preference,
  accountId,
  proStatus,
}: {
  preference: PowerPreference;
  accountId: string;
  proStatus: ProStatus;
}) {
  const query = api.auth.getPowerPreference.useQuery(undefined, {
    initialData: preference,
  });
  const utils = api.useUtils();
  const save = api.auth.setPowerPreference.useMutation({
    onSuccess: () => utils.auth.getPowerPreference.invalidate(),
  });
  const [activity, setActivity] = useState<Activity>({ status: "idle" });
  const session =
    typeof window === "undefined" ? undefined : browserByok(accountId);
  const credential = useSyncExternalStore(
    session?.subscribe ?? (() => () => {}),
    session?.reference ?? noCredential,
    noCredential,
  );
  const ownKey = query.data.mode === "byok";
  const pending = activity.status === "pending";
  async function connect(form: HTMLFormElement) {
    const input = form.querySelector("#provider-key");
    if (!(input instanceof HTMLInputElement) || !session) return;
    const value = input.value;
    input.value = "";
    setActivity({ status: "pending" });
    let reference: ReturnType<typeof session.replace> | undefined;
    try {
      reference = session.replace("openrouter", value);
      await session.text(reference, "Reply with the word connected.");
      if (session.reference() === reference)
        setActivity({ status: "done", text: "Key validated on this device." });
    } catch {
      if (reference && session.reference() !== reference) return;
      if (reference) session.remove();
      setActivity({ status: "error" });
    }
  }
  async function complete(form: HTMLFormElement) {
    const input = form.elements.namedItem("text");
    if (!(input instanceof HTMLInputElement) || !session || !credential) return;
    setActivity({ status: "pending" });
    try {
      const text = await session.autocomplete(credential, input.value);
      if (session.reference() === credential)
        setActivity({
          status: "done",
          text: text || "No confident continuation.",
        });
    } catch {
      if (session.reference() !== credential) return;
      setActivity({ status: "error" });
    }
  }
  return (
    <section
      id="settings-ai-power"
      className="flex flex-col gap-4"
      aria-labelledby="ai-power-title"
    >
      <h2 id="ai-power-title" className="text-title font-semibold">
        AI power
      </h2>
      <p className="text-sm text-muted-foreground">
        One account preference, one provider. Keys stay in memory on this device
        until sign out or page closure. Another device needs its own key.
      </p>
      <Label htmlFor="power-source">Preferred power source</Label>
      <select
        id="power-source"
        className="rounded-md border bg-background p-2"
        value={query.data.mode}
        disabled={save.isPending}
        onChange={(event) => {
          const next: PowerPreference =
            event.target.value === "byok"
              ? { mode: "byok", provider: "openrouter" }
              : event.target.value === "pro"
                ? { mode: "pro" }
                : { mode: "local" };
          if (next.mode !== "byok") session?.remove();
          setActivity({ status: "idle" });
          save.mutate(next);
        }}
      >
        <option value="local">Local device</option>
        <option value="byok">My provider key (OpenRouter)</option>
        <option value="pro" disabled={!proStatus.eligible}>
          {proStatus.eligible ? "Pro (private trial)" : "Pro, coming soon"}
        </option>
      </select>
      {save.isError && <p role="alert">Could not save the power preference.</p>}
      <p className="text-sm">
        Local text generation is unavailable in this browser. Pro is coming
        soon. This direct text connection check is independent of Pro. Other AI
        capabilities are not enabled by this check.
      </p>
      <ProTrialSection initialStatus={proStatus} />
      {ownKey && (
        <>
          <p className="text-sm">
            OpenRouter text only. Images, narration, and paid search are
            unavailable here. Validation sends a small paid text request
            directly to OpenRouter. Your provider bills usage; no Pro credits
            are used. Provider permissions or browser access can prevent
            connection.
          </p>
          <p role="status" className="text-sm">
            {credential
              ? "Key present on this device."
              : "No key on this device."}
          </p>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void connect(event.currentTarget);
            }}
          >
            <Label htmlFor="provider-key">OpenRouter key</Label>
            <ProviderKeyInput disabled={pending} />
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {credential ? "Replace and validate key" : "Validate key"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!credential}
                onClick={() => {
                  session?.remove();
                  setActivity({ status: "idle" });
                }}
              >
                Remove key
              </Button>
            </div>
          </form>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void complete(event.currentTarget);
            }}
          >
            <Label htmlFor="byok-text">Text to continue</Label>
            <Input
              id="byok-text"
              name="text"
              placeholder="The next thing I want to write is "
              maxLength={3000}
              required
            />
            <Button type="submit" disabled={!credential || pending}>
              Generate continuation on this device
            </Button>
          </form>
        </>
      )}
      {pending && <p role="status">Connecting directly to OpenRouter…</p>}
      {activity.status === "error" && (
        <p role="alert">
          Direct provider access unavailable. Check your key, permissions, or
          browser connection. No fallback was used.
        </p>
      )}
      {activity.status === "done" && (
        <p role="status" className="whitespace-pre-wrap">
          {activity.text}
        </p>
      )}
    </section>
  );
}

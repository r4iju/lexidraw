"use client";

import * as React from "react";
import { api } from "~/trpc/react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";

type Policy = {
  id: number;
  mode: "chat" | "agent" | "autocomplete";
  provider: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  allowedModels: { provider: string; modelId: string }[];
  enforcedCaps: {
    maxOutputTokensByProvider: { openai: number; google: number };
  };
};

function ModeCard({
  title,
  policy,
  onChange,
  onSave,
  saving,
  error,
}: {
  title: string;
  policy: Policy;
  onChange: (p: Policy) => void;
  onSave: () => void;
  saving: boolean;
  error?: string | null;
}) {
  const [allowedText, setAllowedText] = React.useState(
    JSON.stringify(policy.allowedModels, null, 2),
  );

  React.useEffect(() => {
    setAllowedText(JSON.stringify(policy.allowedModels, null, 2));
  }, [policy.allowedModels]);

  return (
    <section className="rounded-md border border-border p-4">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor={`${policy.mode}-provider`}>Provider</Label>
          <Input
            id={`${policy.mode}-provider`}
            value={policy.provider}
            onChange={(e) => onChange({ ...policy, provider: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${policy.mode}-modelId`}>Model ID</Label>
          <Input
            id={`${policy.mode}-modelId`}
            value={policy.modelId}
            onChange={(e) => onChange({ ...policy, modelId: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${policy.mode}-temperature`}>
            Temperature (0-1)
          </Label>
          <Input
            id={`${policy.mode}-temperature`}
            type="number"
            step="0.01"
            min={0}
            max={1}
            value={policy.temperature}
            onChange={(e) =>
              onChange({ ...policy, temperature: Number(e.target.value) })
            }
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${policy.mode}-maxTokens`}>Max output tokens</Label>
          <Input
            id={`${policy.mode}-maxTokens`}
            type="number"
            min={1}
            value={policy.maxOutputTokens}
            onChange={(e) =>
              onChange({ ...policy, maxOutputTokens: Number(e.target.value) })
            }
          />
        </div>
      </div>

      <div className="grid gap-1.5 mt-4">
        <Label htmlFor={`${policy.mode}-allowed`}>Allowed models (JSON)</Label>
        <textarea
          id={`${policy.mode}-allowed`}
          value={allowedText}
          onChange={(e) => setAllowedText(e.target.value)}
          className="border-input bg-background text-foreground rounded-md border p-2 font-mono text-xs"
          rows={6}
        />
      </div>

      <div className="flex items-center gap-2 mt-4">
        <Button
          onClick={() => {
            try {
              const parsed = JSON.parse(allowedText) as {
                provider: string;
                modelId: string;
              }[];
              onChange({ ...policy, allowedModels: parsed });
              onSave();
            } catch (_err) {
              // ignore, simple UX; user will correct JSON
            }
          }}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </Button>
        {error ? <div className="text-destructive text-sm">{error}</div> : null}
      </div>
    </section>
  );
}

export function PoliciesEditor({
  initialPolicies,
}: {
  initialPolicies: Policy[];
}) {
  const [policies, setPolicies] = React.useState<Policy[]>(() => {
    const byMode: Record<Policy["mode"], Policy | undefined> = {
      chat: undefined,
      agent: undefined,
      autocomplete: undefined,
    };
    for (const p of initialPolicies) byMode[p.mode] = p;
    const ensure = (mode: Policy["mode"]): Policy =>
      byMode[mode] ?? {
        id: 0,
        mode,
        provider: "openai",
        modelId: "gpt-5.1-mini",
        temperature: 0.5,
        maxOutputTokens: 1024,
        allowedModels: [{ provider: "openai", modelId: "gpt-5.1-mini" }],
        enforcedCaps: {
          maxOutputTokensByProvider: { openai: 32768, google: 65535 },
        },
      };
    return [ensure("chat"), ensure("agent"), ensure("autocomplete")];
  });

  const utils = api.useUtils();
  const upsert = api.adminLlm.policies.upsert.useMutation({
    onSuccess: async () => {
      await utils.adminLlm.policies.getAll.invalidate();
    },
  });

  const savePolicy = async (p: Policy) => {
    await upsert.mutateAsync({
      mode: p.mode,
      provider: p.provider,
      modelId: p.modelId,
      temperature: p.temperature,
      maxOutputTokens: p.maxOutputTokens,
      allowedModels: p.allowedModels,
      enforcedCaps: p.enforcedCaps,
    });
  };

  const setOne = (mode: Policy["mode"], next: Policy) => {
    setPolicies((prev) => prev.map((p) => (p.mode === mode ? next : p)));
  };

  return (
    <div className="grid gap-6">
      {policies.map((p) => (
        <ModeCard
          key={p.mode}
          title={p.mode.toUpperCase()}
          policy={p}
          onChange={(np) => setOne(p.mode, np)}
          onSave={() => savePolicy(p)}
          saving={upsert.isPending}
          error={upsert.isError ? upsert.error.message : null}
        />
      ))}
    </div>
  );
}

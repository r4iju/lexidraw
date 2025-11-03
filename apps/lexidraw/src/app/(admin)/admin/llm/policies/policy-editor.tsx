"use client";

import * as React from "react";
import { api } from "~/trpc/react";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";

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
  extraConfig?: Record<string, unknown>;
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
  const [jsonError, setJsonError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setAllowedText(JSON.stringify(policy.allowedModels, null, 2));
    setJsonError(null);
  }, [policy.allowedModels]);

  const validateAndFormatJson = React.useCallback(() => {
    try {
      const parsed = JSON.parse(allowedText);
      if (!Array.isArray(parsed)) {
        setJsonError("Must be an array of objects");
        return null;
      }
      for (const item of parsed) {
        if (
          typeof item !== "object" ||
          !item ||
          typeof item.provider !== "string" ||
          typeof item.modelId !== "string"
        ) {
          setJsonError(
            "Each item must have 'provider' and 'modelId' as strings",
          );
          return null;
        }
      }
      setJsonError(null);
      // Format the JSON nicely
      const formatted = JSON.stringify(parsed, null, 2);
      setAllowedText(formatted);
      return parsed;
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
      return null;
    }
  }, [allowedText]);

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
        <div className="flex items-center justify-between">
          <Label htmlFor={`${policy.mode}-allowed`}>Allowed models</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={validateAndFormatJson}
            className="h-7 text-xs"
          >
            Format JSON
          </Button>
        </div>
        <div className="text-xs text-muted-foreground mb-1">
          Array of allowed provider/model combinations. Example:
        </div>
        <pre className="text-xs text-muted-foreground bg-muted p-2 rounded-md border border-border mb-2 overflow-x-auto">
          {`[
  {"provider": "openai", "modelId": "gpt-4"},
  {"provider": "google", "modelId": "gemini-2.5-flash"}
]`}
        </pre>
        <Textarea
          id={`${policy.mode}-allowed`}
          value={allowedText}
          onChange={(e) => {
            setAllowedText(e.target.value);
            setJsonError(null);
          }}
          onBlur={validateAndFormatJson}
          className={cn(
            "font-mono text-xs",
            jsonError && "border-destructive focus-visible:ring-destructive",
          )}
          rows={8}
          placeholder='[{"provider": "openai", "modelId": "gpt-4"}]'
        />
        {jsonError ? (
          <div className="text-destructive text-xs">{jsonError}</div>
        ) : null}
      </div>

      {policy.mode === "autocomplete" && (
        <div className="grid gap-3 md:grid-cols-2 mt-4">
          <div className="grid gap-1.5">
            <Label htmlFor={`${policy.mode}-reasoningEffort`}>
              Reasoning Effort
            </Label>
            <Select
              value={
                (policy.extraConfig?.reasoningEffort as string) ?? "minimal"
              }
              onValueChange={(value) => {
                onChange({
                  ...policy,
                  extraConfig: {
                    ...policy.extraConfig,
                    reasoningEffort: value,
                  },
                });
              }}
            >
              <SelectTrigger id={`${policy.mode}-reasoningEffort`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minimal">Minimal</SelectItem>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="heavy">Heavy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${policy.mode}-verbosity`}>Verbosity</Label>
            <Select
              value={(policy.extraConfig?.verbosity as string) ?? "low"}
              onValueChange={(value) => {
                onChange({
                  ...policy,
                  extraConfig: {
                    ...policy.extraConfig,
                    verbosity: value,
                  },
                });
              }}
            >
              <SelectTrigger id={`${policy.mode}-verbosity`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-4">
        <Button
          onClick={() => {
            const parsed = validateAndFormatJson();
            if (parsed) {
              onChange({ ...policy, allowedModels: parsed });
              onSave();
            }
          }}
          disabled={saving || !!jsonError}
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
  // Use query hook to get live data that auto-refreshes
  // Force refetch on mount to ensure we get fresh data from server
  const { data: serverPoliciesRaw = initialPolicies } =
    api.adminLlm.policies.getAll.useQuery(undefined, {
      initialData: initialPolicies,
      refetchOnMount: true,
      refetchOnWindowFocus: false,
    });

  // Normalize null to undefined for extraConfig to match Policy type
  const serverPolicies = serverPoliciesRaw.map((p) => ({
    ...p,
    extraConfig: p.extraConfig ?? undefined,
  }));

  const buildPolicies = React.useCallback(
    (policiesFromServer: Policy[]): Policy[] => {
      const byMode: Record<Policy["mode"], Policy | undefined> = {
        chat: undefined,
        agent: undefined,
        autocomplete: undefined,
      };
      for (const p of policiesFromServer) byMode[p.mode] = p;
      const ensure = (mode: Policy["mode"]): Policy =>
        byMode[mode] ?? {
          id: 0,
          mode,
          provider: "openai",
          modelId: "gpt-5-mini",
          temperature: 0.5,
          maxOutputTokens: 1024,
          allowedModels: [{ provider: "openai", modelId: "gpt-5-mini" }],
          enforcedCaps: {
            maxOutputTokensByProvider: { openai: 32768, google: 65535 },
          },
          extraConfig:
            mode === "autocomplete"
              ? { reasoningEffort: "minimal", verbosity: "low" }
              : undefined,
        };
      return [ensure("chat"), ensure("agent"), ensure("autocomplete")];
    },
    [],
  );

  const [policies, setPolicies] = React.useState<Policy[]>(() =>
    buildPolicies(serverPolicies),
  );

  // Sync state when server data changes (but preserve local edits until save)
  const prevServerPoliciesRef = React.useRef(serverPolicies);
  React.useEffect(() => {
    // Only sync if server data actually changed (different IDs or content)
    const prevStr = JSON.stringify(prevServerPoliciesRef.current);
    const currStr = JSON.stringify(serverPolicies);
    if (prevStr !== currStr) {
      prevServerPoliciesRef.current = serverPolicies;
      setPolicies(buildPolicies(serverPolicies));
    }
  }, [serverPolicies, buildPolicies]);

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
      extraConfig: p.extraConfig ?? null,
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
          title={
            p.id === 0
              ? `${p.mode.toUpperCase()} (Not Saved - Click Save to create)`
              : p.mode.toUpperCase()
          }
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

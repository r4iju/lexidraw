"use client";

import { useState, useEffect, useMemo } from "react";
import { api } from "~/trpc/react";
import { Label } from "~/components/ui/label";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "~/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { Check } from "lucide-react";
import { cn } from "~/lib/utils";

export function AutocompleteConfig({ className }: { className?: string }) {
  const { data: cfg, refetch } = api.config.getAutocompleteConfig.useQuery();
  const update = api.config.updateAutocompleteConfig.useMutation({
    onSuccess: () => refetch(),
  });

  const [enabled, setEnabled] = useState<boolean>(true);
  const [delayMs, setDelayMs] = useState<number>(200);
  const [modelId, setModelId] = useState<string>("gpt-5-nano");
  const [temperature, setTemperature] = useState<number>(0.3);
  const [maxOutputTokens, setMaxOutputTokens] = useState<number>(400);
  const [reasoningEffort, setReasoningEffort] = useState<"minimal" | "standard" | "heavy">("minimal");
  const [verbosity, setVerbosity] = useState<"low" | "medium" | "high">("low");

  useEffect(() => {
    if (!cfg) return;
    setEnabled(!!cfg.enabled);
    setDelayMs(Number(cfg.delayMs ?? 200));
    setModelId(String(cfg.modelId ?? "gpt-5-nano"));
    setTemperature(Number(cfg.temperature ?? 0.3));
    setMaxOutputTokens(Number(cfg.maxOutputTokens ?? 400));
    setReasoningEffort((cfg.reasoningEffort as typeof reasoningEffort) ?? "minimal");
    setVerbosity((cfg.verbosity as typeof verbosity) ?? "low");
  }, [cfg]);

  const onSave = (patch: Partial<{ enabled: boolean; delayMs: number; modelId: string; temperature: number; maxOutputTokens: number; reasoningEffort: "minimal"|"standard"|"heavy"; verbosity: "low"|"medium"|"high" }>) => {
    update.mutate(patch);
  };

  const models = useMemo(() => [
    { id: "gpt-5-nano", label: "GPT-5 Nano" },
    { id: "gpt-5-mini", label: "GPT-5 Mini" },
  ], []);

  return (
    <div className={cn("flex flex-col gap-3 min-w-64", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="ac-enabled" className="font-normal cursor-pointer">Enable Autocomplete</Label>
        <Switch id="ac-enabled" checked={enabled} onCheckedChange={(checked) => {
          const v = checked === true;
          setEnabled(v);
          onSave({ enabled: v });
        }} />
      </div>

      <div>
        <Label htmlFor="ac-delay">Delay (ms)</Label>
        <Input id="ac-delay" type="number" min={0} max={5000} value={delayMs}
          onChange={(e) => setDelayMs(Number(e.target.value))}
          onBlur={() => onSave({ delayMs })} />
      </div>

      <div>
        <Label>Model</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="w-full justify-between">
              {models.find((m) => m.id === modelId)?.label || modelId}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[240px] p-0">
            <Command>
              <CommandInput placeholder="Search model..." />
              <CommandList>
                <CommandEmpty>No model found.</CommandEmpty>
                <CommandGroup>
                  {models.map((m) => (
                    <CommandItem key={m.id} value={m.id} onSelect={() => {
                      setModelId(m.id);
                      onSave({ modelId: m.id });
                    }}>
                      <Check className={cn("mr-2 h-4 w-4", m.id === modelId ? "opacity-100" : "opacity-0")} />
                      {m.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div>
        <Label htmlFor="ac-temp">Temperature</Label>
        <Input id="ac-temp" type="number" min={0} max={1} step={0.01} value={temperature}
          onChange={(e) => setTemperature(Number(e.target.value))}
          onBlur={() => onSave({ temperature })} />
      </div>

      <div>
        <Label htmlFor="ac-max">Max tokens</Label>
        <Input id="ac-max" type="number" min={1} max={2000} value={maxOutputTokens}
          onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
          onBlur={() => onSave({ maxOutputTokens })} />
      </div>

      <div>
        <Label htmlFor="ac-effort">Reasoning effort</Label>
        <select id="ac-effort" className="h-10 w-full rounded-md border bg-background px-3"
          value={reasoningEffort}
          onChange={(e) => {
            const v = e.target.value as typeof reasoningEffort;
            setReasoningEffort(v);
            onSave({ reasoningEffort: v });
          }}>
          <option value="minimal">minimal</option>
          <option value="standard">standard</option>
          <option value="heavy">heavy</option>
        </select>
      </div>

      <div>
        <Label htmlFor="ac-verb">Verbosity</Label>
        <select id="ac-verb" className="h-10 w-full rounded-md border bg-background px-3"
          value={verbosity}
          onChange={(e) => {
            const v = e.target.value as typeof verbosity;
            setVerbosity(v);
            onSave({ verbosity: v });
          }}>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </div>
    </div>
  );
}



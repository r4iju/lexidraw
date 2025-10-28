"use client";

import { useCallback } from "react";
import { api } from "~/trpc/react";
import { runAutocomplete } from "~/server/actions/autocomplete";

export type AutocompleteRequest = {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  modelId?: string;
  signal?: AbortSignal;
};

export function useAutocompleteEngine() {
  const { data: cfg } = api.config.getAutocompleteConfig.useQuery();

  const complete = useCallback(
    async ({
      system,
      prompt,
      temperature,
      maxOutputTokens,
      modelId,
      signal,
    }: AutocompleteRequest): Promise<string> => {
      // Server Action cannot be aborted; emulate by ignoring late results
      const p = runAutocomplete({
        system,
        prompt,
        temperature: temperature ?? cfg?.temperature ?? 0.3,
        maxOutputTokens: maxOutputTokens ?? cfg?.maxOutputTokens ?? 400,
        modelId: modelId ?? cfg?.modelId ?? "gpt-5-nano",
      });
      if (signal?.aborted) return "";
      const res = await p;
      if (signal?.aborted) return "";
      return typeof res === "string" ? res : "";
    },
    [cfg?.maxOutputTokens, cfg?.modelId, cfg?.temperature],
  );

  return { complete, config: cfg } as const;
}

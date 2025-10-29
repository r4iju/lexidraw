"use client";

import { throttle } from "@packages/lib";
import { useAutocompleteEngine } from "~/hooks/use-autocomplete-engine";
import { useCallback, useMemo } from "react";

export type AutocompleteEditorContext = {
  heading: string;
  blockType: string;
  surroundingText: string;
  nextBlockText: string;
};

type SuggestionCache = {
  add: (suggestion: string) => void;
  has: (suggestion: string) => boolean;
  clear: () => void;
};

const CACHE_SIZE_LIMIT = 10;

// memoize the autocomplete function
export function useAutocompleteLLM() {
  const { complete, config: acfg } = useAutocompleteEngine();

  const createSuggestionCache = useCallback((): SuggestionCache => {
    const suggestions = new Set<string>();

    return {
      add: (suggestion: string) => {
        if (suggestions.size >= CACHE_SIZE_LIMIT) {
          const oldest = suggestions.values().next().value;
          if (oldest && typeof oldest === "string") {
            suggestions.delete(oldest);
          }
        }
        suggestions.add(suggestion);
      },
      has: (suggestion: string) => suggestions.has(suggestion),
      clear: () => suggestions.clear(),
    };
  }, []);

  const suggestionCache = useMemo(
    () => createSuggestionCache(),
    [createSuggestionCache],
  );

  const validateAndProcessResult = useCallback(
    (result: unknown): string => {
      if (!result || typeof result !== "string") {
        return "";
      }

      if (suggestionCache.has(result)) {
        return "";
      }

      suggestionCache.add(result);
      return result;
    },
    [suggestionCache],
  );

  const streamFirstToken = useCallback(
    async (
      system: string,
      prompt: string,
      signal?: AbortSignal,
    ): Promise<string> => {
      try {
        const resp = await fetch("/api/autocomplete/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system, prompt }),
          signal,
        });
        if (!resp.ok || !resp.body) return "";
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const raw of lines) {
            const line = raw.trim();
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const obj = JSON.parse(data) as Record<string, unknown>;
              const tryFields = [
                (obj as { delta?: string }).delta,
                (obj as { text?: string }).text,
                (obj as { output_text?: string }).output_text,
                (obj as { content?: Array<{ text?: string }> }).content?.[0]
                  ?.text,
              ];
              for (const f of tryFields) {
                if (typeof f === "string" && f.trim()) {
                  // Stop reading further; return first non-empty token
                  try {
                    await reader.cancel();
                  } catch {}
                  return f;
                }
              }
              const t = (obj as { type?: string }).type;
              if (typeof t === "string" && t.includes("output_text")) {
                const d =
                  (obj as { delta?: string }).delta ||
                  (obj as { text?: string }).text;
                if (typeof d === "string" && d.trim()) {
                  try {
                    await reader.cancel();
                  } catch {}
                  return d;
                }
              }
            } catch {
              // ignore malformed lines
            }
          }
        }
        return "";
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return "";
        return "";
      }
    },
    [],
  );

  const autocomplete = useMemo(
    () =>
      throttle(
        async (
          partialSnippet: string,
          editorContext?: AutocompleteEditorContext,
          signal?: AbortSignal,
        ): Promise<string> => {
          const prompt = [
            `Complete the snippet without repeating those words.`,
            `Do not wrap in quotes.`,
            `Do not add any list markers or other formatting.`,
            `The user is currently typing at the position marked [CURSOR].`,
            `User typed partial snippet: "${partialSnippet}"`,
            `The following context may be relevant:`,
            ...(editorContext?.heading
              ? [`Nearest heading: ${editorContext.heading}`]
              : []),
            ...(editorContext?.blockType
              ? [`Block type: ${editorContext.blockType}`]
              : []),
            ...(editorContext?.surroundingText
              ? [
                  `Surrounding text (with cursor position): ${editorContext.surroundingText}`,
                ]
              : []),
            ...(editorContext?.nextBlockText
              ? [`Following block text: ${editorContext.nextBlockText}`]
              : []),
          ].join("\n");

          const system = [
            `You are a helpful autocomplete assistant.`,
            `Do not repeat the words the user already typed.`,
            `Avoid meta-information like "Sure" or "Here you go."`,
            `Critically, do not suggest any text found in the 'Following block text' context.`,
            `If you cannot provide a suitable completion, return an empty string "".`,
          ].join("\n");

          // Prefer streaming for first-token latency; fallback to server action
          if (acfg && (acfg as { enabled?: boolean }).enabled === false) {
            return "";
          }
          const first = await streamFirstToken(system, prompt, signal);
          const result = first || (await complete({ system, prompt, signal }));

          return validateAndProcessResult(result);
        },
        acfg?.delayMs ?? 200,
      ),
    [complete, validateAndProcessResult, acfg, streamFirstToken],
  );

  return autocomplete;
}

"use client";

import { throttle } from "@packages/lib";
import { useLLM } from "../../context/llm-context";
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
  const { generateAutocomplete } = useLLM();

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

          const result = await generateAutocomplete({
            prompt,
            system,
            signal,
          });

          return validateAndProcessResult(result);
        },
        3000,
      ),
    [generateAutocomplete, validateAndProcessResult],
  );

  return autocomplete;
}

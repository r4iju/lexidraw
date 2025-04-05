"use client";

import { throttle } from "@packages/lib";
import { useLLM } from "../../context/llm-context";

export type AutocompleteEditorContext = {
  heading: string;
  blockType: string;
  previousSentence: string;
};

type SuggestionCache = {
  add: (suggestion: string) => void;
  has: (suggestion: string) => boolean;
  clear: () => void;
};

const CACHE_SIZE_LIMIT = 10;

function useSuggestionCache(maxSize: number = CACHE_SIZE_LIMIT) {
  const createSuggestionCache = (
    maxSize: number = CACHE_SIZE_LIMIT,
  ): SuggestionCache => {
    const suggestions = new Set<string>();

    return {
      add: (suggestion: string) => {
        if (suggestions.size >= maxSize) {
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
  };

  return createSuggestionCache(maxSize);
}

function useAutocompleteLLM() {
  const { generate } = useLLM();
  const suggestionCache = useSuggestionCache();

  const validateAndProcessResult = (result: unknown): string => {
    if (!result || typeof result !== "string") {
      return "";
    }

    if (suggestionCache.has(result)) {
      return "";
    }

    suggestionCache.add(result);
    return result;
  };

  const autocomplete = async (
    partialSnippet: string,
    editorContext?: AutocompleteEditorContext,
    signal?: AbortSignal,
  ): Promise<string> => {
    console.log("autocomplete request: ", { partialSnippet, editorContext });
    const prompt = [
      `Complete the snippet without repeating those words.`,
      `Do not wrap in quotes.`,
      `Do not add any list markers or other formatting.`,
      `User typed partial snippet: "${partialSnippet}"`,
      `The following context may be relevant:`,
      ...(editorContext?.heading
        ? [`Nearest heading: ${editorContext.heading}`]
        : []),
      ...(editorContext?.blockType
        ? [`Block type: ${editorContext.blockType}`]
        : []),
      ...(editorContext?.previousSentence
        ? [`Previous sentence: ${editorContext.previousSentence}`]
        : []),
    ].join("\n");

    const system = [
      `You are a helpful autocomplete assistant.`,
      `Do not repeat the words the user already typed.`,
      `Avoid meta-information like "Sure" or "Here you go."`,
      `If you cannot provide a suitable completion, return an empty string "".`,
    ].join("\n");

    const result = await generate({
      prompt,
      system,
      signal,
    });

    return validateAndProcessResult(result);
  };

  return autocomplete;
}

export function useThrottledAutocomplete() {
  const autocomplete = useAutocompleteLLM();

  return throttle(
    async (
      snippet: string,
      editorContext?: AutocompleteEditorContext,
      signal?: AbortSignal,
    ) => {
      return autocomplete(snippet, editorContext, signal);
    },
    3000,
  );
}

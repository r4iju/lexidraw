"use client";

import { useCallback, useMemo } from "react";
import { debounce } from "@packages/lib";
import { useLLM } from "../../context/llm-context";

export type AutocompleteEditorContext = {
  heading: string;
  blockType: string;
  previousSentence: string;
};

function useAutocompleteLLM() {
  const { generate } = useLLM();

  const autocomplete = useCallback(
    async (
      partialSnippet: string,
      editorContext?: AutocompleteEditorContext,
    ): Promise<string> => {
      console.log({ partialSnippet, editorContext });
      const prompt = [
        `Complete the snippet without repeating those words.`,
        `Do not wrap in quotes.`,
        `User typed partial snippet: "${partialSnippet}"`,
        `The following context may be relevant to understand the context of the snippet.`,
        ...(editorContext?.heading
          ? [`The nearest heading is: ${editorContext.heading}`]
          : []),
        ...(editorContext?.blockType
          ? [`The current snippet is a ${editorContext.blockType} block.`]
          : []),
        ...(editorContext?.previousSentence
          ? [`The previous sentence is: ${editorContext.previousSentence}`]
          : []),
      ]
        .join("\n")
        .trim();

      const system = [
        `You are a helpful autocomplete assistant.`,
        `Don't repeat the exact words the user already typed.`,
        `Don't add meta-information like "Sure" or "Here you go."`,
        `If you cannot provide a suitable completion, return an empty string "".`,
      ].join("\n");

      return generate({
        prompt,
        system,
      });
    },
    [generate],
  );

  return autocomplete;
}

export function useDebouncedAutocomplete() {
  const autocomplete = useAutocompleteLLM();

  return useMemo(
    () =>
      debounce(
        async (snippet: string, editorContext?: AutocompleteEditorContext) =>
          autocomplete(snippet, editorContext),
        3000,
      ),
    [autocomplete],
  );
}

"use client";

import type { BaseSelection, NodeKey } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isAtNodeEnd } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { type JSX, useCallback, useEffect, useRef } from "react";
import {
  $createAutocompleteNode,
  AutocompleteNode,
} from "../../nodes/AutocompleteNode";
import { addSwipeRightListener } from "../../utils/swipe";
import { useSettings } from "../../context/settings-context";
import { useLLM, useLLMQuery } from "../../context/llm-context";

type CompletionRequest = {
  dismiss: () => void;
  promise: Promise<null | string>;
};

function generateId(): string {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, "")
    .substring(2, 15);
}

export const UUID = generateId();

function search(selection: null | BaseSelection): [boolean, string] {
  if (!$isRangeSelection(selection) || !selection.isCollapsed())
    return [false, ""];
  const node = selection.getNodes()[0];
  const anchor = selection.anchor;
  if (!$isTextNode(node) || !node.isSimpleText() || !$isAtNodeEnd(anchor))
    return [false, ""];

  const text = node.getTextContent();
  let i = text.length - 1;
  const sentence: string[] = [];
  while (i >= 0 && !["\n", ".", "!", "?"].includes(text[i] as string)) {
    sentence.push(text[i--] as string);
  }
  if (!sentence.length) return [false, ""];
  return [true, sentence.reverse().join("")];
}

export default function AutocompletePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const { settings } = useSettings();
  const queryLLM = useLLMQuery();
  const { on } = useLLM();

  const autocompleteNodeKey = useRef<NodeKey | null>(null);
  const lastWord = useRef<string | null>(null);
  const lastSuggestion = useRef<string | null>(null);
  const completionRequest = useRef<CompletionRequest | null>(null);

  /**
   * Clears the current autocomplete suggestion.
   */
  const clearSuggestion = useCallback(() => {
    if (autocompleteNodeKey.current !== null) {
      const existingNode = $getNodeByKey(autocompleteNodeKey.current);
      if (existingNode?.isAttached()) {
        existingNode.remove();
      }
      autocompleteNodeKey.current = null;
    }
    if (completionRequest.current) {
      completionRequest.current.dismiss();
      completionRequest.current = null;
    }
    lastWord.current = null;
    lastSuggestion.current = null;
  }, [completionRequest, lastWord, lastSuggestion]);

  /**
   * Handles a new suggestion received from the LLM.
   */
  const handleNewSuggestion = useCallback(
    (data: { completion: string; requestId: string }) => {
      const { completion } = data;
      if (!completion) return;

      // Insert the autocomplete suggestion into the editor
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const [hasMatch, match] = search(selection);
        if (!hasMatch || match !== lastWord.current) return;

        // Insert an AutocompleteNode with the suggested text
        const selectionClone = selection.clone();
        const node = $createAutocompleteNode(completion, UUID);
        autocompleteNodeKey.current = node.getKey();
        selection.insertNodes([node]);
        $setSelection(selectionClone);
        lastSuggestion.current = completion;
      });
    },
    [editor],
  );

  /**
   * Handles errors received from the LLM.
   */
  const handleError = useCallback(
    (data: { error: string; requestId?: string }) => {
      console.error("Autocomplete error:", data.error);
      // Optionally, display an error message to the user
    },
    [],
  );

  /**
   * Monitors editor updates to trigger autocomplete suggestions.
   */
  const handleUpdate = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      const [hasMatch, match] = search(selection);
      if (!hasMatch) {
        clearSuggestion();
        console.log("Autocomplete no match, clearing suggestion");
        return;
      }
      if (match === lastWord.current) {
        // Same partial text, do nothing
        return;
      }
      // Clear old suggestion
      clearSuggestion();
      console.log("Autocomplete clearing old suggestion");
      // Send query to LLM
      queryLLM(match);
      lastWord.current = match;
    });
  }, [clearSuggestion, editor, queryLLM]);

  /**
   * Accepts the current autocomplete suggestion.
   */
  const handleAcceptSuggestion = useCallback((): boolean => {
    if (!lastSuggestion.current || !autocompleteNodeKey.current) {
      return false;
    }
    const node = $getNodeByKey(autocompleteNodeKey.current);
    if (!node) {
      return false;
    }
    // Replace the node with plain text
    editor.update(() => {
      if (!lastSuggestion.current) {
        return false;
      }
      const textNode = $createTextNode(lastSuggestion.current);
      node.replace(textNode);
      textNode.selectNext();
      clearSuggestion();
    });
    return true;
  }, [clearSuggestion, editor, lastSuggestion, autocompleteNodeKey]);

  /**
   * Handles keypress commands to accept suggestions.
   */
  const handleKeypressCommand = useCallback(
    (e: Event) => {
      if (handleAcceptSuggestion()) {
        e.preventDefault();
        return true;
      }
      return false;
    },
    [handleAcceptSuggestion],
  );

  /**
   * Handles swipe right gestures to accept suggestions.
   */
  const handleSwipeRight = useCallback(
    (_force: number, e: TouchEvent) => {
      editor.update(() => {
        if (handleAcceptSuggestion()) {
          e.preventDefault();
        }
      });
    },
    [editor, handleAcceptSuggestion],
  );

  /**
   * Cleans up suggestions when necessary.
   */
  const cleanup = useCallback(() => {
    editor.update(() => {
      clearSuggestion();
    });
  }, [editor, clearSuggestion]);

  /**
   * Transforms AutocompleteNode instances to ensure only one suggestion is active.
   */
  const handleAutocompleteNodeTransform = useCallback(
    (node: AutocompleteNode) => {
      const key = node.getKey();
      if (node.__uuid === UUID && key !== autocompleteNodeKey.current) {
        // Max one Autocomplete node per session
        clearSuggestion();
      }
    },
    [autocompleteNodeKey, clearSuggestion],
  );

  /**
   * Sets up event listeners and command handlers.
   */
  useEffect(() => {
    if (!settings.isLlmEnabled) return;

    const unsubscribeSuggestion = on("completion", handleNewSuggestion);
    const unsubscribeError = on("error", handleError);

    const rootElem = editor.getRootElement();

    return mergeRegister(
      editor.registerNodeTransform(
        AutocompleteNode,
        handleAutocompleteNodeTransform,
      ),
      editor.registerUpdateListener(handleUpdate),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        handleKeypressCommand,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        handleKeypressCommand,
        COMMAND_PRIORITY_LOW,
      ),
      ...(rootElem ? [addSwipeRightListener(rootElem, handleSwipeRight)] : []),
      unsubscribeSuggestion,
      unsubscribeError,
      cleanup,
    );
  }, [
    editor,
    settings.isLlmEnabled,
    on,
    cleanup,
    handleAutocompleteNodeTransform,
    handleKeypressCommand,
    handleSwipeRight,
    handleUpdate,
    handleNewSuggestion,
    handleError,
  ]);

  return null;
}

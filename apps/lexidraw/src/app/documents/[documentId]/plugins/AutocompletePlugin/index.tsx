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
import { useLLM } from "../../context/llm-context";

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
  const { sendQuery } = useLLM();

  const autocompleteNodeKey = useRef<NodeKey | null>(null);
  const lastWord = useRef<string | null>(null);
  const lastSuggestion = useRef<string | null>(null);
  const completionRequest = useRef<CompletionRequest | null>(null);

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

  const handleNewSuggestion = useCallback(
    (refReq: CompletionRequest, newText: null | string) => {
      // If outdated or no suggestion, do nothing
      if (completionRequest.current !== refReq || !newText) return;
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const [hasMatch, match] = search(selection);
        if (!hasMatch || match !== lastWord.current) return;

        // Insert an AutocompleteNode with the text
        const selectionClone = selection.clone();
        const node = $createAutocompleteNode(newText, UUID);
        autocompleteNodeKey.current = node.getKey();
        selection.insertNodes([node]);
        $setSelection(selectionClone);
        lastSuggestion.current = newText;
      });
    },
    [autocompleteNodeKey, editor, lastSuggestion],
  );

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
        console.log(
          "Autocomplete matches last word:",
          match,
          "returning early",
        );
        return;
      }
      // clear old suggestion
      clearSuggestion();
      console.log("Autocomplete clearing old suggestion");
      // query LLM for new suggestion
      completionRequest.current = sendQuery(match) ?? null;
      if (!completionRequest.current) {
        console.error("Autocomplete error: no response from LLM");
        return;
      }
      completionRequest.current.promise
        .then((suggestion) => {
          console.log("Autocomplete suggestion:", suggestion);
          if (completionRequest.current) {
            handleNewSuggestion(completionRequest.current, suggestion);
          }
        })
        .catch((err) => {
          console.error("Autocomplete error:", err);
        });
      lastWord.current = match;
    });
  }, [
    clearSuggestion,
    completionRequest,
    editor,
    handleNewSuggestion,
    lastWord,
    sendQuery,
  ]);

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

  const cleanup = useCallback(() => {
    editor.update(() => {
      clearSuggestion();
    });
  }, [editor, clearSuggestion]);

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

  useEffect(() => {
    if (!settings.isLlmEnabled) return;

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
      cleanup,
    );
  }, [
    editor,
    settings.isLlmEnabled,
    cleanup,
    handleAutocompleteNodeTransform,
    handleKeypressCommand,
    handleSwipeRight,
    handleUpdate,
  ]);

  return null;
}

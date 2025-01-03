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
import { type JSX, useEffect } from "react";
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

  useEffect(() => {
    if (!settings.isLlmEnabled) return;

    let autocompleteNodeKey: NodeKey | null = null;
    let lastWord: string | null = null;
    let lastSuggestion: string | null = null;
    let completionRequest: CompletionRequest | null = null;

    function clearSuggestion() {
      if (autocompleteNodeKey !== null) {
        const existingNode = $getNodeByKey(autocompleteNodeKey);
        if (existingNode?.isAttached()) {
          existingNode.remove();
        }
        autocompleteNodeKey = null;
      }
      if (completionRequest) {
        completionRequest.dismiss();
        completionRequest = null;
      }
      lastWord = null;
      lastSuggestion = null;
    }

    function handleNewSuggestion(
      refReq: CompletionRequest,
      newText: null | string,
    ) {
      // If outdated or no suggestion, do nothing
      if (completionRequest !== refReq || !newText) return;
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const [hasMatch, match] = search(selection);
        if (!hasMatch || match !== lastWord) return;

        // Insert an AutocompleteNode with the text
        const selectionClone = selection.clone();
        const node = $createAutocompleteNode(newText, UUID);
        autocompleteNodeKey = node.getKey();
        selection.insertNodes([node]);
        $setSelection(selectionClone);
        lastSuggestion = newText;
      });
    }

    function handleUpdate() {
      editor.update(() => {
        const selection = $getSelection();
        const [hasMatch, match] = search(selection);
        if (!hasMatch) {
          clearSuggestion();
          console.log("Autocomplete no match, clearing suggestion");
          return;
        }
        if (match === lastWord) {
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
        completionRequest = sendQuery(match);
        if (!completionRequest) {
          console.error("Autocomplete error: no response from LLM");
          return;
        }
        completionRequest.promise
          .then((suggestion) => {
            console.log("Autocomplete suggestion:", suggestion);
            if (completionRequest) {
              handleNewSuggestion(completionRequest, suggestion);
            }
          })
          .catch((err) => {
            console.error("Autocomplete error:", err);
          });
        lastWord = match;
      });
    }

    function handleAcceptSuggestion(): boolean {
      if (!lastSuggestion || !autocompleteNodeKey) {
        return false;
      }
      const node = $getNodeByKey(autocompleteNodeKey);
      if (!node) {
        return false;
      }
      // Replace the node with plain text
      editor.update(() => {
        if (!lastSuggestion) {
          return false;
        }
        const textNode = $createTextNode(lastSuggestion);
        node.replace(textNode);
        textNode.selectNext();
        clearSuggestion();
      });
      return true;
    }

    function handleKeypressCommand(e: Event) {
      if (handleAcceptSuggestion()) {
        e.preventDefault();
        return true;
      }
      return false;
    }

    function handleSwipeRight(_force: number, e: TouchEvent) {
      editor.update(() => {
        if (handleAcceptSuggestion()) {
          e.preventDefault();
        }
      });
    }

    function cleanup() {
      editor.update(() => {
        clearSuggestion();
      });
    }

    function handleAutocompleteNodeTransform(node: AutocompleteNode) {
      const key = node.getKey();
      if (node.__uuid === UUID && key !== autocompleteNodeKey) {
        // Max one Autocomplete node per session
        clearSuggestion();
      }
    }

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
  }, [editor, sendQuery, settings.isLlmEnabled]);

  return null;
}

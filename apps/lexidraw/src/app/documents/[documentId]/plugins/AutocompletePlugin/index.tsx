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
import { useSharedAutocompleteContext } from "../../context/shared-autocomplete-context";
import {
  $createAutocompleteNode,
  AutocompleteNode,
} from "../../nodes/AutocompleteNode";
import { addSwipeRightListener } from "../../utils/swipe";

type SearchPromise = {
  dismiss: () => void;
  promise: Promise<null | string>;
};

export const uuid = Math.random()
  .toString(36)
  .replace(/[^a-z]+/g, "")
  .substr(0, 5);

function $search(selection: null | BaseSelection): [boolean, string] {
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

/**
 * 1) Setup a single Worker for the entire plugin. We only load the model once in the Worker.
 * 2) `useQuery` sends messages to the worker and returns a {promise, dismiss} object.
 */
function useQuery(): (searchText: string) => SearchPromise {
  const workerRef = useRef<Worker | null>(null);

  // Create the worker exactly once
  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../../../../../workers/web-llm.worker.ts", import.meta.url),
    );
    console.log("workerRef.current", workerRef.current);
    // listen for worker "initReady" messages, etc.

    return () => {
      // Cleanup
      console.log("terminating worker");
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const queryLLM = useCallback((prompt: string) => {
    let isDismissed = false;
    let removeListener: () => void = () => {};

    const dismiss = () => {
      isDismissed = true;
      removeListener();
    };

    // The main promise we return to the plugin
    const promise = new Promise<null | string>((resolve, reject) => {
      if (!workerRef.current) {
        // Worker not ready
        console.log("workerRef.current not ready");
        return resolve(null);
      }

      // Handler for incoming messages from the worker
      const onMessage = (e: MessageEvent) => {
        const data = e.data || {};
        console.log("workerRef.current.onmessage", data);
        if (isDismissed) {
          return reject("Dismissed");
        }
        switch (data.type) {
          case "completion":
            console.log('we have a suggestion')
            removeListener();
            resolve(data.text || null);
            break;
          case "error":
            removeListener();
            reject(data.error);
            break;
          default:
            console.log("[Client] Worker event:", data);
            break;
        }
      };

      removeListener = () => {
        workerRef.current?.removeEventListener("message", onMessage);
      };

      // Attach listener
      workerRef.current.addEventListener("message", onMessage);

      // Send message to Worker
      console.log("sending message to worker", prompt);
      workerRef.current.postMessage({ prompt });
    });

    return { dismiss, promise };
  }, []);

  return queryLLM;
}

// The rest is nearly identical
export default function AutocompletePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [, setSuggestion] = useSharedAutocompleteContext();
  const query = useQuery();

  useEffect(() => {
    let autocompleteNodeKey: null | NodeKey = null;
    let lastMatch: null | string = null;
    let lastSuggestion: null | string = null;
    let searchPromise: null | SearchPromise = null;

    function $clearSuggestion() {
      if (autocompleteNodeKey !== null) {
        const autocompleteNode = $getNodeByKey(autocompleteNodeKey);
        if (autocompleteNode?.isAttached()) {
          autocompleteNode.remove();
        }
        autocompleteNodeKey = null;
      }
      if (searchPromise) {
        searchPromise.dismiss();
        searchPromise = null;
      }
      lastMatch = null;
      lastSuggestion = null;
      setSuggestion(null);
    }

    function updateAsyncSuggestion(
      refSearchPromise: SearchPromise,
      newSuggestion: null | string,
    ) {
      if (searchPromise !== refSearchPromise || newSuggestion === null) {
        // Outdated or no suggestion
        return;
      }
      editor.update(
        () => {
          const selection = $getSelection();
          const [hasMatch, match] = $search(selection);
          if (
            !hasMatch ||
            match !== lastMatch ||
            !$isRangeSelection(selection)
          ) {
            // Outdated
            return;
          }
          const selectionCopy = selection.clone();
          const node = $createAutocompleteNode(uuid);
          autocompleteNodeKey = node.getKey();
          selection.insertNodes([node]);
          $setSelection(selectionCopy);
          lastSuggestion = newSuggestion;
          setSuggestion(newSuggestion);
        },
        { tag: "history-merge" },
      );
    }

    function $handleAutocompleteNodeTransform(node: AutocompleteNode) {
      const key = node.getKey();
      if (node.__uuid === uuid && key !== autocompleteNodeKey) {
        // Max one Autocomplete node at a time
        $clearSuggestion();
      }
    }

    function handleUpdate() {
      editor.update(() => {
        const selection = $getSelection();
        const [hasMatch, match] = $search(selection);
        if (!hasMatch) {
          $clearSuggestion();
          return;
        }
        if (match === lastMatch) {
          // Same word, do nothing
          return;
        }
        $clearSuggestion();

        // Kick off new LLM query
        searchPromise = query(match);
        searchPromise.promise
          .then((newSuggestion) => {
            if (searchPromise) {
              updateAsyncSuggestion(searchPromise, newSuggestion);
            }
          })
          .catch((err) => {
            console.error("Autocomplete error", err);
          });
        lastMatch = match;
      });
    }

    function $handleAutocompleteIntent(): boolean {
      if (!lastSuggestion || !autocompleteNodeKey) {
        return false;
      }
      const autocompleteNode = $getNodeByKey(autocompleteNodeKey);
      if (!autocompleteNode) {
        return false;
      }
      const textNode = $createTextNode(lastSuggestion);
      autocompleteNode.replace(textNode);
      textNode.selectNext();
      $clearSuggestion();
      return true;
    }

    function $handleKeypressCommand(e: Event) {
      if ($handleAutocompleteIntent()) {
        e.preventDefault();
        return true;
      }
      return false;
    }

    function handleSwipeRight(_force: number, e: TouchEvent) {
      editor.update(() => {
        if ($handleAutocompleteIntent()) {
          e.preventDefault();
        }
      });
    }

    function unmountSuggestion() {
      editor.update(() => {
        $clearSuggestion();
      });
    }

    const rootElem = editor.getRootElement();

    return mergeRegister(
      editor.registerNodeTransform(
        AutocompleteNode,
        $handleAutocompleteNodeTransform,
      ),
      editor.registerUpdateListener(handleUpdate),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        $handleKeypressCommand,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        $handleKeypressCommand,
        COMMAND_PRIORITY_LOW,
      ),
      ...(rootElem ? [addSwipeRightListener(rootElem, handleSwipeRight)] : []),
      unmountSuggestion,
    );
  }, [editor, query, setSuggestion]);

  return null;
}

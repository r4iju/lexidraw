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
import { useToast } from "~/components/ui/use-toast";

type CompletionRequest = {
  dismiss: () => void;
  promise: Promise<null | string>;
};

export const UUID = Math.random()
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

/* Using a Worker that queries your local LLM  */
function useQuery(): (textSnippet: string) => CompletionRequest {
  const workerRef = useRef<Worker | null>(null);
  const { settings } = useSettings();
  const { toast } = useToast();

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

  const sendQuery = useCallback(
    (prompt: string) => {
      let isDismissed = false;
      let removeListener = () => {};
      let currentToastId: string | undefined;

      const dismiss = () => {
        isDismissed = true;
        removeListener();
        if (currentToastId) {
          toast.dismiss(currentToastId);
          currentToastId = undefined;
        }
      };

      const promise = new Promise<null | string>((resolve, reject) => {
        if (!workerRef.current) {
          return resolve(null);
        }

        const onMessage = (e: MessageEvent) => {
          if (isDismissed) {
            return reject("Dismissed");
          }

          const data = e.data;
          switch (data.type) {
            case "completion":
              removeListener();
              if (currentToastId) toast.dismiss(currentToastId);
              resolve(data.text || null);
              break;
            case "error":
              removeListener();
              if (currentToastId) toast.dismiss(currentToastId);
              reject(data.error);
              break;
            case "loading":
              currentToastId = toast({
                title: "Loading model...",
                description: "Please wait while the model initializes",
              }).id;
              break;
            case "ready":
              if (currentToastId) {
                toast.dismiss(currentToastId);
                currentToastId = undefined;
              }
              break;
            case "progress":
              if (currentToastId) {
                toast({
                  id: currentToastId,
                  title: "Loading...",
                  description: data.progress.text as string,
                });
              }
              break;
          }
        };

        removeListener = () => workerRef.current?.removeEventListener("message", onMessage);
        workerRef.current.addEventListener("message", onMessage);
        workerRef.current.postMessage({
          type: "completion",
          textSnippet: prompt,
        });
      });

      return { dismiss, promise };
    },
    [toast]
  );

  // handle settings changes
  useEffect(() => {
    workerRef.current?.postMessage({
      type: "settings",
      model: settings.llmModel,
      temperature: settings.llmTemperature,
      maxTokens: settings.llmMaxTokens,
    });
  }, [
    settings.isLlm,
    settings.llmModel,
    settings.llmTemperature,
    settings.llmMaxTokens,
  ]);

  return sendQuery;
}

export default function AutocompletePlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const queryLLM = useQuery();

  useEffect(() => {
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
        const [hasMatch, match] = $search(selection);
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
        const [hasMatch, match] = $search(selection);
        if (!hasMatch) {
          clearSuggestion();
          return;
        }
        if (match === lastWord) {
          // same partial word, do nothing
          return;
        }
        // clear old suggestion
        clearSuggestion();

        // query LLM for new suggestion
        completionRequest = queryLLM(match);
        completionRequest.promise
          .then((suggestion) => {
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
  }, [editor, queryLLM]);

  return null;
}

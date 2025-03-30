"use client";

import type { BaseSelection, LexicalNode, NodeKey } from "lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $createTextNode,
  $getNodeByKey,
  $setSelection,
} from "lexical";
import {
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { useEffect, useCallback, useRef } from "react";
import { useSettings } from "../../context/settings-context";
import {
  type AutocompleteEditorContext,
  useDebouncedAutocomplete,
} from "./use-auto-complete";
import { AutocompleteNode } from "../../nodes/AutocompleteNode";
import { mergeRegister } from "@lexical/utils";
import { $isAtNodeEnd } from "@lexical/selection";
import { useSessionUUID } from "./session-uuid-provider";

type CompletionRequest = {
  dismiss: () => void;
  promise: Promise<string | null>;
};

type Force = [number, number];
type Listener = (force: Force, e: TouchEvent) => void;
type ElementValues = {
  start: null | Force;
  listeners: Set<Listener>;
  handleTouchstart: (e: TouchEvent) => void;
  handleTouchend: (e: TouchEvent) => void;
};

export default function AutocompletePlugin() {
  const [editor] = useLexicalComposerContext();
  const { settings } = useSettings();
  const UUID = useSessionUUID();
  const queryLLM = useDebouncedAutocomplete();

  const autocompleteNodeKey = useRef<NodeKey | null>(null);
  const lastWord = useRef<string | null>(null);
  const lastSuggestion = useRef<string | null>(null);
  const completionRequest = useRef<CompletionRequest | null>(null);

  /**
   * Climb from the given node up to the root, collecting all headings.
   * The result is an array of heading texts from outermost to innermost.
   */
  const gatherHeadingChain = useCallback((node: LexicalNode): string[] => {
    const headings: string[] = [];

    let current: LexicalNode | null = node;
    while (current !== null) {
      // If you’re using @lexical/rich-text, you can do:
      // if ($isHeadingNode(current)) { ... }
      if (current.getType() === "heading") {
        headings.push(current.getTextContent());
      }
      current = current.getParent();
    }

    // Because we accumulate from inside → out, let's reverse
    // so the outermost heading is first, then next heading, etc.
    headings.reverse();
    return headings;
  }, []);

  const gatherEditorContext = useCallback((): AutocompleteEditorContext => {
    let headingHierarchy = "";
    let blockType = "";
    let previousSentence = "";

    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return { heading: headingHierarchy, blockType, previousSentence };
    }

    const anchorNode = selection.anchor.getNode();

    headingHierarchy = gatherHeadingChain(anchorNode).join(" > ");

    const anchorElement = anchorNode.getTopLevelElementOrThrow();
    blockType = anchorElement.getType();

    const offset = selection.anchor.offset;
    if ($isTextNode(anchorNode)) {
      const textBeforeCursor = anchorNode.getTextContent().slice(0, offset);

      // A quick approach: capture all complete sentences that end in punctuation.
      // We'll use a global regex that finds segments like “Some text.”, “Another?” etc.
      const fullSentences = textBeforeCursor.match(/[^.?!]+[.?!]+/g);

      // The "previous sentence" is the last fully ended sentence,
      // ignoring whatever fragment the user is still typing.
      if (fullSentences && fullSentences.length > 0) {
        previousSentence =
          fullSentences[fullSentences.length - 1]?.trim() ?? "";
      } else {
        previousSentence = "";
      }
    }

    return { heading: headingHierarchy, blockType, previousSentence };
  }, []);

  /**
   * This function checks if we are at the end of the current node
   * and extracts the partial text snippet.
   */
  const search = useCallback(
    (selection: null | BaseSelection): [boolean, string] => {
      if (!$isRangeSelection(selection) || !selection.isCollapsed())
        return [false, ""];
      const node = selection.getNodes()[0];
      const anchor = selection.anchor;
      if (!$isTextNode(node) || !node.isSimpleText() || !$isAtNodeEnd(anchor))
        return [false, ""];

      const text = node.getTextContent();
      let i = text.length - 1;
      const sentence: string[] = [];
      while (i >= 0 && !["\n", ".", "!", "?"].includes(text[i] ?? "")) {
        sentence.push(text[i--] ?? "");
      }
      if (!sentence.length) return [false, ""];
      return [true, sentence.reverse().join("")];
    },
    [],
  );

  const clearSuggestion = useCallback(() => {
    if (autocompleteNodeKey.current !== null) {
      const existingNode = $getNodeByKey(autocompleteNodeKey.current);
      if (existingNode?.isAttached()) {
        existingNode.remove();
      }
      autocompleteNodeKey.current = null;
    }
    completionRequest.current?.dismiss();
    completionRequest.current = null;
    lastWord.current = null;
    lastSuggestion.current = null;
  }, []);

  const insertSuggestion = useCallback(
    (suggestion: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const [hasMatch, match] = search(selection);
        if (!hasMatch || match !== lastWord.current) return;

        const selectionClone = selection.clone();
        const node = new AutocompleteNode(suggestion, UUID);
        autocompleteNodeKey.current = node.getKey();
        selection.insertNodes([node]);
        $setSelection(selectionClone);
        lastSuggestion.current = suggestion;
      });
    },
    [editor, UUID],
  );

  const handleUpdate = useCallback(() => {
    editor.update(() => {
      const selection = $getSelection();
      const [hasMatch, match] = search(selection);
      if (!hasMatch) {
        clearSuggestion();
        return;
      }
      if (match === lastWord.current) {
        // same partial text, do nothing
        return;
      }

      clearSuggestion();
      lastWord.current = match;

      const partialSnippet = match;
      const { heading, blockType, previousSentence } = gatherEditorContext();

      const promise = queryLLM(partialSnippet, {
        heading,
        blockType,
        previousSentence,
      })?.then((completion) => {
        if (!completion) return null;
        insertSuggestion(completion);
        return completion;
      });

      if (promise) {
        completionRequest.current = {
          dismiss: () => {
            completionRequest.current = null;
          },
          promise,
        };
      }
    });
  }, [editor, queryLLM, clearSuggestion, insertSuggestion]);

  /** Accepts the current autocomplete suggestion. */
  const handleAcceptSuggestion = useCallback((): boolean => {
    if (!lastSuggestion.current || !autocompleteNodeKey.current) {
      return false;
    }
    const node = $getNodeByKey(autocompleteNodeKey.current);
    if (!node) return false;

    // Replace the node with plain text
    editor.update(() => {
      if (!lastSuggestion.current) return;
      const textNode = $createTextNode(lastSuggestion.current);
      node.replace(textNode);
      textNode.selectNext();
      clearSuggestion();
    });
    return true;
  }, [editor, clearSuggestion]);

  /** Keypress commands to accept the suggestion. */
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

  /** Swipe right gestures to accept suggestions. */
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

  /** Cleanup suggestions on unmount or re-register. */
  const cleanup = useCallback(() => {
    editor.update(() => {
      clearSuggestion();
    });
  }, [editor, clearSuggestion]);

  const elements = new WeakMap<HTMLElement, ElementValues>();

  /** Ensure only one suggestion is active at a time. */
  const handleAutocompleteNodeTransform = useCallback(
    (node: AutocompleteNode) => {
      const key = node.getKey();
      if (node.__uuid === UUID && key !== autocompleteNodeKey.current) {
        clearSuggestion();
      }
    },
    [clearSuggestion],
  );

  function readTouch(e: TouchEvent): [number, number] | null {
    const touch = e.changedTouches[0];
    if (touch === undefined) {
      return null;
    }
    return [touch.clientX, touch.clientY];
  }

  const addListener = useCallback(
    (element: HTMLElement, cb: Listener): (() => void) => {
      let elementValues = elements.get(element);
      if (elementValues === undefined) {
        const listeners = new Set<Listener>();
        const handleTouchstart = (e: TouchEvent) => {
          if (elementValues !== undefined) {
            elementValues.start = readTouch(e);
          }
        };
        const handleTouchend = (e: TouchEvent) => {
          if (elementValues === undefined) {
            return;
          }
          const start = elementValues.start;
          if (start === null) {
            return;
          }
          const end = readTouch(e);
          for (const listener of listeners) {
            if (end !== null) {
              listener([end[0] - start[0], end[1] - start[1]], e);
            }
          }
        };
        element.addEventListener("touchstart", handleTouchstart);
        element.addEventListener("touchend", handleTouchend);

        elementValues = {
          handleTouchend,
          handleTouchstart,
          listeners,
          start: null,
        };
        elements.set(element, elementValues);
      }
      elementValues.listeners.add(cb);
      return () => deleteListener(element, cb);
    },
    [],
  );

  const deleteListener = useCallback(
    (element: HTMLElement, cb: Listener): void => {
      const elementValues = elements.get(element);
      if (elementValues === undefined) {
        return;
      }
      const listeners = elementValues.listeners;
      listeners.delete(cb);
      if (listeners.size === 0) {
        elements.delete(element);
        element.removeEventListener(
          "touchstart",
          elementValues.handleTouchstart,
        );
        element.removeEventListener("touchend", elementValues.handleTouchend);
      }
    },
    [],
  );

  const addSwipeLeftListener = useCallback(
    (element: HTMLElement, cb: (_force: number, e: TouchEvent) => void) => {
      return addListener(element, (force, e) => {
        const [x, y] = force;
        if (x < 0 && -x > Math.abs(y)) {
          cb(x, e);
        }
      });
    },
    [],
  );

  const addSwipeRightListener = useCallback(
    (element: HTMLElement, cb: (_force: number, e: TouchEvent) => void) => {
      return addListener(element, (force, e) => {
        const [x, y] = force;
        if (x > 0 && x > Math.abs(y)) {
          cb(x, e);
        }
      });
    },
    [],
  );

  const addSwipeUpListener = useCallback(
    (element: HTMLElement, cb: (_force: number, e: TouchEvent) => void) => {
      return addListener(element, (force, e) => {
        const [x, y] = force;
        if (y < 0 && -y > Math.abs(x)) {
          cb(x, e);
        }
      });
    },
    [],
  );

  const addSwipeDownListener = useCallback(
    (element: HTMLElement, cb: (_force: number, e: TouchEvent) => void) => {
      return addListener(element, (force, e) => {
        const [x, y] = force;
        if (y > 0 && y > Math.abs(x)) {
          cb(x, e);
        }
      });
    },
    [],
  );

  /** Set up event handlers and command registrations. */
  useEffect(() => {
    if (!settings.isLlmEnabled) return;

    const rootElem = editor.getRootElement();
    return mergeRegister(
      editor.registerNodeTransform(
        AutocompleteNode,
        handleAutocompleteNodeTransform,
      ),
      editor.registerUpdateListener(() => handleUpdate()),
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
    handleUpdate,
    handleKeypressCommand,
    handleSwipeRight,
  ]);

  return null;
}

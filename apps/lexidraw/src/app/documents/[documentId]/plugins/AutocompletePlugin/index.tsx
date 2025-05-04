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
  KEY_ESCAPE_COMMAND,
} from "lexical";
import { useEffect, useCallback, useRef } from "react";
import { useSessionUUID } from "./session-uuid-provider";
import {
  type AutocompleteEditorContext,
  useAutocompleteLLM,
} from "./use-auto-complete";
import { AutocompleteNode } from "../../nodes/AutocompleteNode";
import { mergeRegister } from "@lexical/utils";
import { $isAtNodeEnd } from "@lexical/selection";

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
  const UUID = useSessionUUID();
  const queryLLM = useAutocompleteLLM();

  const autocompleteNodeKey = useRef<NodeKey | null>(null);
  const lastWord = useRef<string | null>(null);
  const lastSuggestion = useRef<string | null>(null);
  const completionRequest = useRef<CompletionRequest | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  /**
   * Climb from the given node up to the root, collecting all headings.
   * The result is an array of heading texts from outermost to innermost.
   */
  const gatherHeadingChain = useCallback((node: LexicalNode): string[] => {
    const headings: string[] = [];

    let current: LexicalNode | null = node;
    while (current !== null) {
      // If you're using @lexical/rich-text, you can do:
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
    let surroundingText = "";
    let nextBlockText = "";

    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return {
        heading: headingHierarchy,
        blockType,
        surroundingText,
        nextBlockText,
      };
    }

    const anchorNode = selection.anchor.getNode();
    headingHierarchy = gatherHeadingChain(anchorNode).join(" > ");

    const anchorElement = anchorNode.getTopLevelElementOrThrow();
    blockType = anchorElement.getType();

    // Get text from the previous sibling element, if it exists
    const previousSibling = anchorElement.getPreviousSibling();
    const previousText = previousSibling
      ? `${previousSibling.getTextContent().trim()}\n`
      : "";

    // Get text from the current element and mark cursor position
    let currentTextWithCursor = "";
    if ($isTextNode(anchorNode)) {
      const textContent = anchorNode.getTextContent();
      const offset = selection.anchor.offset;
      const textBeforeCursor = textContent.slice(0, offset).trimStart(); // Trim leading space from start of element's text
      const textAfterCursor = textContent.slice(offset).trimEnd(); // Trim trailing space
      currentTextWithCursor = `${textBeforeCursor}[CURSOR]${textAfterCursor}`;
    } else {
      // Fallback if not a text node (though selection usually is)
      currentTextWithCursor = `${anchorElement.getTextContent().trim()}[CURSOR]`;
    }

    // Combine the texts
    surroundingText = `${previousText}${currentTextWithCursor}`;

    // Get text from the next sibling element, if it exists
    const nextSibling = anchorElement.getNextSibling();
    nextBlockText = nextSibling ? nextSibling.getTextContent().trim() : "";

    return {
      heading: headingHierarchy,
      blockType,
      surroundingText,
      nextBlockText,
    };
  }, [gatherHeadingChain]);

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
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }

    completionRequest.current?.dismiss();
    completionRequest.current = null;

    lastWord.current = null;
    lastSuggestion.current = null;

    if (autocompleteNodeKey.current !== null) {
      const existingNode = $getNodeByKey(autocompleteNodeKey.current);
      if (existingNode?.isAttached()) {
        existingNode.remove();
      }
      autocompleteNodeKey.current = null;
    }
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
    [editor, search, UUID],
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
        return;
      }

      clearSuggestion();
      lastWord.current = match;

      const controller = new AbortController();
      controllerRef.current = controller;

      const editorContext = gatherEditorContext();

      const promise = queryLLM(match, editorContext, controller.signal)
        ?.then((completion) => {
          if (!completion) return null;
          insertSuggestion(completion);
          return completion;
        })
        .catch((err) => {
          if (err instanceof Error && err.name === "AbortError") {
            return null;
          }
          console.error(err);
          return null;
        });

      completionRequest.current = {
        dismiss: () => {
          completionRequest.current = null;
        },
        promise: promise ?? Promise.resolve(null),
      };
    });
  }, [
    editor,
    search,
    clearSuggestion,
    gatherEditorContext,
    queryLLM,
    insertSuggestion,
  ]);

  /**
   * If user hits ESC, we cancel the suggestion + request
   */
  const handleEscapeCommand = useCallback(
    (e: KeyboardEvent) => {
      if (autocompleteNodeKey.current !== null) {
        clearSuggestion();
        e.preventDefault();
        return true;
      }
      return false;
    },
    [clearSuggestion],
  );

  /** Accepts the current autocomplete suggestion. */
  const handleAcceptSuggestion = useCallback((): boolean => {
    if (!lastSuggestion.current || !autocompleteNodeKey.current) {
      return false;
    }
    const node = $getNodeByKey(autocompleteNodeKey.current);
    if (!node) return false;

    editor.update(() => {
      // Insert the suggested text
      if (!lastSuggestion.current) return false;
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
    console.log("[AutocompletePlugin] cleanup");
    editor.update(() => {
      clearSuggestion();
    });
  }, [editor, clearSuggestion]);

  const elements = useRef<WeakMap<HTMLElement, ElementValues>>(new WeakMap());

  /** Ensure only one suggestion is active at a time. */
  const handleAutocompleteNodeTransform = useCallback(
    (node: AutocompleteNode) => {
      const key = node.getKey();
      if (node.__uuid === UUID && key !== autocompleteNodeKey.current) {
        clearSuggestion();
      }
    },
    [UUID, clearSuggestion],
  );

  function readTouch(e: TouchEvent): [number, number] | null {
    const touch = e.changedTouches[0];
    if (touch === undefined) {
      return null;
    }
    return [touch.clientX, touch.clientY];
  }

  const deleteListener = useCallback(
    (element: HTMLElement, cb: Listener): void => {
      const elementValues = elements.current.get(element);
      if (elementValues === undefined) {
        return;
      }
      const listeners = elementValues.listeners;
      listeners.delete(cb);
      if (listeners.size === 0) {
        elements.current.delete(element);
        element.removeEventListener(
          "touchstart",
          elementValues.handleTouchstart,
        );
        element.removeEventListener("touchend", elementValues.handleTouchend);
      }
    },
    [elements],
  );

  const addListener = useCallback(
    (element: HTMLElement, cb: Listener): (() => void) => {
      let elementValues = elements.current.get(element);
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
        elements.current.set(element, elementValues);
      }
      elementValues.listeners.add(cb);
      return () => deleteListener(element, cb);
    },
    [deleteListener, elements],
  );

  const addSwipeListener = useCallback(
    (
      direction: "up" | "down" | "left" | "right",
      element: HTMLElement,
      cb: (_force: number, e: TouchEvent) => void,
    ) => {
      return addListener(element, (force, e) => {
        const [x, y] = force;
        if (direction === "up" && y < 0 && -y > Math.abs(x)) {
          cb(x, e);
        }
        if (direction === "down" && y > 0 && y > Math.abs(x)) {
          cb(x, e);
        }
        if (direction === "left" && x < 0 && -x > Math.abs(y)) {
          cb(x, e);
        }
        if (direction === "right" && x > 0 && x > Math.abs(y)) {
          cb(x, e);
        }
      });
    },
    [addListener],
  );

  /** Set up event handlers and command registrations. */
  useEffect(() => {
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
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        handleEscapeCommand,
        COMMAND_PRIORITY_LOW,
      ),
      ...(rootElem
        ? [addSwipeListener("right", rootElem, handleSwipeRight)]
        : []),
      cleanup,
    );
  }, [
    editor,
    cleanup,
    handleAutocompleteNodeTransform,
    handleUpdate,
    handleKeypressCommand,
    handleEscapeCommand,
    handleSwipeRight,
    addSwipeListener,
  ]);

  return null;
}

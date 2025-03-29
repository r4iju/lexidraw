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
import { $isHeadingNode } from "@lexical/rich-text";
import {
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { useEffect, useCallback, useRef } from "react";
import { addSwipeRightListener } from "../../utils/swipe";
import { useSettings } from "../../context/settings-context";
import {
  type AutocompleteEditorContext,
  useDebouncedAutocomplete,
} from "./use-auto-complete";
import {
  $createAutocompleteNode,
  AutocompleteNode,
} from "../../nodes/AutocompleteNode";
import { mergeRegister } from "@lexical/utils";
import { $isAtNodeEnd } from "@lexical/selection";

type CompletionRequest = {
  dismiss: () => void;
  promise: Promise<string | null>;
};

function generateId(): string {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, "")
    .substring(2, 15);
}

export const UUID = generateId();

/**
 * This function checks if we are at the end of the current node
 * and extracts the partial text snippet.
 */
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
  while (i >= 0 && !["\n", ".", "!", "?"].includes(text[i] ?? "")) {
    sentence.push(text[i--] ?? "");
  }
  if (!sentence.length) return [false, ""];
  return [true, sentence.reverse().join("")];
}

/**
 * Climb from the given node up to the root, collecting all headings.
 * The result is an array of heading texts from outermost to innermost.
 */
function gatherHeadingChain(node: LexicalNode): string[] {
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
}

function gatherEditorContext(): AutocompleteEditorContext {
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
      previousSentence = fullSentences[fullSentences.length - 1]?.trim() ?? "";
    } else {
      previousSentence = "";
    }
  }

  return { heading: headingHierarchy, blockType, previousSentence };
}

export { gatherEditorContext };

export default function AutocompletePlugin() {
  const [editor] = useLexicalComposerContext();
  const { settings } = useSettings();

  const queryLLM = useDebouncedAutocomplete();

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
        const node = $createAutocompleteNode(suggestion, UUID);
        autocompleteNodeKey.current = node.getKey();
        selection.insertNodes([node]);
        $setSelection(selectionClone);
        lastSuggestion.current = suggestion;
      });
    },
    [editor],
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

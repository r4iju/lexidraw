"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isListItemNode } from "@lexical/list";
import { $isHeadingNode } from "@lexical/rich-text";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { useEffect } from "react";
import { useEntityId } from "~/hooks/use-entity-id";
import { api } from "~/trpc/react";
import { firstWord, normalizeCompletion, typedThrough } from "./completion";
import { streamSuggestion } from "./stream-suggestion";

/** How long typing must pause before a suggestion is asked for. */
const DEFAULT_DELAY_MS = 300;
/** Fewer characters in the block give the model too little to go on. */
const MIN_BLOCK_CHARS = 3;
const MAX_BEFORE_CHARS = 3000;
const MAX_AFTER_CHARS = 600;
const CACHE_SIZE = 50;
const SWIPE_PX = 40;

/** A caret a suggestion can follow: collapsed at the end of a text block. */
type Target = {
  textKey: NodeKey;
  /** The block's text, which the suggestion continues. */
  prefix: string;
  /** The document up to the caret, and after its block, as the model reads it. */
  before: string;
  after: string;
};

type Shown = { textKey: NodeKey; prefix: string; suggestion: string };

function $label(node: LexicalNode): string {
  const text = node.getTextContent();
  if ($isHeadingNode(node)) {
    return `${"#".repeat(Number(node.getTag().slice(1)))} ${text}`;
  }
  if ($isListItemNode(node)) return `- ${text}`;
  return text;
}

/** The blocks next to `block` and its ancestors, nearest first. */
function $around(
  block: ElementNode,
  side: "before" | "after",
  max: number,
): string[] {
  const next = (node: LexicalNode) =>
    side === "before" ? node.getPreviousSibling() : node.getNextSibling();
  const parts: string[] = [];
  let size = 0;
  for (
    let node: LexicalNode | null = block;
    node && !$isRootNode(node) && size < max;
    node = node.getParent()
  ) {
    for (
      let sibling = next(node);
      sibling && size < max;
      sibling = next(sibling)
    ) {
      const text = $label(sibling);
      parts.push(text);
      size += text.length + 1;
    }
  }
  return parts;
}

function $target(): Target | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node) || !node.isSimpleText()) return null;
  if (selection.anchor.offset !== node.getTextContentSize()) return null;
  const block = $findMatchingParent(
    node,
    (n) => $isElementNode(n) && !n.isInline(),
  );
  if (!$isElementNode(block) || block.getLastDescendant() !== node) return null;

  const prefix = block.getTextContent();
  if (prefix.trim().length < MIN_BLOCK_CHARS) return null;
  const before = [
    ...$around(block, "before", MAX_BEFORE_CHARS).reverse(),
    $label(block),
  ].join("\n");
  const after = $around(block, "after", MAX_AFTER_CHARS).join("\n");
  return { textKey: node.getKey(), prefix, before, after };
}

type Options = { delayMs: number; title: string; entityId?: string };

/**
 * Shows a suggestion after the caret once typing pauses at the end of a
 * block. It is drawn as a `data-suggestion` attribute on the caret's text, so
 * it never enters the document, its history, or a collaborator's view.
 */
function registerAutocomplete(
  editor: LexicalEditor,
  { delayMs, title, entityId }: Options,
): () => void {
  let shown: Shown | null = null;
  let painted: HTMLElement | null = null;
  /** The caret last asked about, so an update that keeps it asks no again. */
  let asked: Target | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;
  /** The prefix the user dismissed; nothing is suggested until it changes. */
  let dismissed: string | null = null;
  const cache = new Map<string, string>();

  const paint = () => {
    const element = shown ? editor.getElementByKey(shown.textKey) : null;
    if (painted && painted !== element) {
      painted.removeAttribute("data-suggestion");
    }
    if (element && shown)
      element.setAttribute("data-suggestion", shown.suggestion);
    painted = element;
  };

  const show = (target: Target, suggestion: string) => {
    shown = suggestion
      ? { textKey: target.textKey, prefix: target.prefix, suggestion }
      : null;
    paint();
  };

  const hide = () => {
    shown = null;
    paint();
  };

  const cancel = () => {
    clearTimeout(timer);
    request?.abort();
    request = null;
    asked = null;
  };

  const remember = (key: string, suggestion: string) => {
    cache.delete(key);
    cache.set(key, suggestion);
    const oldest = cache.keys().next().value;
    if (cache.size > CACHE_SIZE && oldest !== undefined) cache.delete(oldest);
  };

  const ask = (target: Target) => {
    const controller = new AbortController();
    request = controller;
    let suggestion = "";
    let complete = false;
    streamSuggestion(
      { title, before: target.before, after: target.after, entityId },
      controller.signal,
      (raw) => {
        suggestion = normalizeCompletion(target.before, raw);
        // The user may type into the suggestion while it streams.
        const now = editor.getEditorState().read($target);
        const rest =
          now?.textKey !== target.textKey
            ? null
            : now.prefix === target.prefix
              ? suggestion
              : typedThrough({ prefix: target.prefix, suggestion }, now.prefix);
        if (now === null || rest === null) {
          controller.abort();
          return;
        }
        show(now, rest);
        // Only the first line is shown, so the rest is not worth waiting for.
        if (/\S[^\n]*\n/.test(raw)) {
          complete = true;
          controller.abort();
        }
      },
    )
      .then(() => {
        complete = true;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn("[autocomplete]", error);
      })
      .finally(() => {
        if (complete) remember(target.before, suggestion);
        if (request === controller) request = null;
      });
  };

  const onUpdate = () => {
    if (editor.isComposing()) {
      cancel();
      hide();
      return;
    }
    const target = editor.getEditorState().read($target);
    if (!target) {
      cancel();
      hide();
      return;
    }
    if (shown?.textKey === target.textKey) {
      // Lexical may have redrawn the text without the attribute.
      if (shown.prefix === target.prefix) return paint();
      const rest = typedThrough(shown, target.prefix);
      if (rest !== null) return show(target, rest);
    }
    if (asked?.textKey === target.textKey && asked.prefix === target.prefix) {
      return;
    }

    cancel();
    hide();
    if (dismissed === target.prefix) return;
    dismissed = null;
    asked = target;
    const cached = cache.get(target.before);
    if (cached !== undefined) return show(target, cached);
    timer = setTimeout(() => ask(target), delayMs);
  };

  /** Types `part` of the suggestion; the update that follows shows the rest. */
  const accept = (part: (suggestion: string) => string): boolean => {
    if (!shown) return false;
    const { textKey, prefix, suggestion } = shown;
    editor.update(() => {
      const target = $target();
      if (target?.textKey !== textKey || target.prefix !== prefix) return;
      const selection = $getSelection();
      if ($isRangeSelection(selection)) selection.insertText(part(suggestion));
    });
    return true;
  };

  const onAcceptKey =
    (part: (suggestion: string) => string) =>
    (event: KeyboardEvent | null): boolean => {
      if (!shown) return false;
      if (
        event?.shiftKey ||
        event?.altKey ||
        event?.metaKey ||
        event?.ctrlKey
      ) {
        return false;
      }
      event?.preventDefault();
      return accept(part);
    };

  let touch: { x: number; y: number } | null = null;
  const onTouchStart = (event: TouchEvent) => {
    const point = event.changedTouches[0];
    touch = point ? { x: point.clientX, y: point.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const point = event.changedTouches[0];
    if (!touch || !point) return;
    const dx = point.clientX - touch.x;
    const dy = point.clientY - touch.y;
    touch = null;
    if (dx > SWIPE_PX && dx > Math.abs(dy) && accept((s) => s)) {
      event.preventDefault();
    }
  };

  return mergeRegister(
    editor.registerUpdateListener(onUpdate),
    editor.registerCommand(
      KEY_TAB_COMMAND,
      onAcceptKey((s) => s),
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      onAcceptKey(firstWord),
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      (event) => {
        if (!shown) return false;
        dismissed = shown.prefix;
        cancel();
        hide();
        event?.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerCommand(
      BLUR_COMMAND,
      () => {
        cancel();
        hide();
        return false;
      },
      COMMAND_PRIORITY_LOW,
    ),
    editor.registerRootListener((root, previous) => {
      previous?.removeEventListener("touchstart", onTouchStart);
      previous?.removeEventListener("touchend", onTouchEnd);
      root?.addEventListener("touchstart", onTouchStart, { passive: true });
      root?.addEventListener("touchend", onTouchEnd);
    }),
    () => {
      cancel();
      hide();
    },
  );
}

export default function AutocompletePlugin({ title = "" }: { title?: string }) {
  const [editor] = useLexicalComposerContext();
  const entityId = useEntityId();
  const { data: config } = api.config.getAutocompleteConfig.useQuery();
  const enabled = config?.enabled !== false;
  const delayMs = config?.delayMs ?? DEFAULT_DELAY_MS;

  useEffect(() => {
    if (!enabled) return;
    return registerAutocomplete(editor, { delayMs, title, entityId });
  }, [editor, enabled, delayMs, title, entityId]);

  return null;
}

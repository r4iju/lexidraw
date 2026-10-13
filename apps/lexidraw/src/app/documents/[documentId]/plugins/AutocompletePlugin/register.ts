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
import { firstWord, normalizeCompletion, typedThrough } from "./completion";
import type { SuggestionRequest } from "./stream-suggestion";

/** How long typing must pause before a suggestion is asked for. */
/** Fewer characters in the block give the model too little to go on. */
const MIN_BLOCK_CHARS = 3;
const MAX_BEFORE_CHARS = 3000;
const MAX_AFTER_CHARS = 600;
const SWIPE_PX = 40;
const outstanding = new WeakMap<LexicalEditor, Promise<void>>();
let deviceRequest: Promise<void> | undefined;
let deviceNextAllowedAt = 0;
const lastStarted = new WeakMap<LexicalEditor, number>();

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

export type Options = {
  delayMs: number;
  title: string;
  entityId?: string;
  minIntervalMs?: number;
  suggest: (input: SuggestionRequest, signal: AbortSignal) => Promise<string>;
};

/**
 * Shows a suggestion after the caret once typing pauses at the end of a
 * block. It is drawn as a `data-suggestion` attribute on the caret's text, so
 * it never enters the document, its history, or a collaborator's view.
 */
export function registerAutocomplete(
  editor: LexicalEditor,
  { delayMs, title, entityId, minIntervalMs = 6000, suggest }: Options,
): () => void {
  let shown: Shown | null = null;
  let painted: HTMLElement | null = null;
  /** The caret last asked about, so an update that keeps it asks no again. */
  let asked: Target | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;
  /** The prefix the user dismissed; nothing is suggested until it changes. */
  let dismissed: string | null = null;
  let pending: Target | null = null;
  let disposed = false;
  let intent = 0;

  const focused = () => {
    const root = editor.getRootElement();
    return root?.contains(root.ownerDocument.activeElement) ?? false;
  };

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
    intent++;
    clearTimeout(timer);
    request?.abort();
    pending = null;
    asked = null;
  };

  const ask = (target: Target, generation: number) => {
    if (disposed || intent !== generation || !focused()) return;
    if (request) {
      pending = target;
      return;
    }
    const previous = deviceRequest ?? outstanding.get(editor);
    if (previous) {
      void previous.finally(() => {
        if (!disposed && intent === generation)
          timer = setTimeout(() => ask(target, generation), delayMs);
      });
      return;
    }
    const current = editor.getEditorState().read($target);
    if (
      current?.textKey !== target.textKey ||
      current.prefix !== target.prefix ||
      editor.isComposing()
    )
      return;
    const wait =
      minIntervalMs === 0
        ? 0
        : Math.max(
            deviceNextAllowedAt - Date.now(),
            minIntervalMs -
              (Date.now() - (lastStarted.get(editor) ?? -Infinity)),
          );
    if (wait > 0) {
      timer = setTimeout(() => ask(target, generation), wait);
      return;
    }
    const controller = new AbortController();
    request = controller;
    lastStarted.set(editor, Date.now());
    deviceNextAllowedAt = Date.now() + minIntervalMs;
    const work = suggest(
      { title, before: target.before, after: target.after, entityId },
      controller.signal,
    )
      .then((raw) => {
        if (
          disposed ||
          intent !== generation ||
          controller.signal.aborted ||
          editor.isComposing() ||
          !focused()
        )
          return;
        const now = editor.getEditorState().read($target);
        if (now?.textKey !== target.textKey || now.prefix !== target.prefix)
          return;
        const clipped = normalizeCompletion(target.before, raw).slice(0, 512);
        show(now, clipped.replace(/[\uD800-\uDBFF]$/, ""));
      })
      .catch(() => {
        if (request === controller) hide();
      })
      .finally(() => {
        if (request === controller) request = null;
        if (outstanding.get(editor) === work) outstanding.delete(editor);
        if (deviceRequest === work) deviceRequest = undefined;
        const next = pending;
        pending = null;
        if (next && !disposed) {
          const nextGeneration = intent;
          timer = setTimeout(() => ask(next, nextGeneration), delayMs);
        }
      });
    outstanding.set(editor, work);
    deviceRequest = work;
  };

  const onUpdate = () => {
    if (editor.isComposing() || !focused()) {
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
      if (rest !== null) {
        cancel();
        return show(target, rest);
      }
    }
    if (asked?.textKey === target.textKey && asked.prefix === target.prefix) {
      return;
    }

    cancel();
    hide();
    if (dismissed === target.prefix) return;
    dismissed = null;
    asked = target;
    const generation = intent;
    timer = setTimeout(() => ask(target, generation), delayMs);
  };

  /** Types `part` of the suggestion; the update that follows shows the rest. */
  const accept = (part: (suggestion: string) => string): boolean => {
    if (!shown || editor.isComposing()) return false;
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
      disposed = true;
      cancel();
      hide();
    },
  );
}

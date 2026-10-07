import type { JSX, KeyboardEvent, PointerEvent, ReactPortal } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  HISTORY_MERGE_TAG,
  HISTORY_PUSH_TAG,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutContainerNode } from "@packages/lexical-nodes";
import { moveSplit, shares, splitValue, template } from "./column-tracks";

/** The narrowest a column gets from a drag, in CSS pixels. */
const MINIMUM_WIDTH = 64;
/** How far an arrow key moves a split, as a fraction of its two columns. */
const STEP = 0.05;

/** The split between column `index` and the next of the row `key`. */
type Split = {
  key: NodeKey;
  index: number;
  count: number;
  left: number;
  top: number;
  height: number;
  value: number;
};

/** The columns of a row as laid out. */
function columnsOf(row: HTMLElement) {
  return [...row.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement &&
      child.hasAttribute("data-lexical-layout-item"),
  );
}

function templateOf(editor: LexicalEditor, key: NodeKey) {
  return editor.getEditorState().read(() => {
    const node = $getNodeByKey(key);
    return LayoutContainerNode.$isLayoutContainerNode(node)
      ? node.getTemplateColumns()
      : "";
  });
}

/** Every split on screen, over the gaps of rows laid out side by side. */
function measure(editor: LexicalEditor, rows: ReadonlySet<NodeKey>): Split[] {
  const splits: Split[] = [];
  for (const key of rows) {
    const row = editor.getElementByKey(key);
    if (!row?.isConnected) continue;
    const boxes = columnsOf(row).map((column) =>
      column.getBoundingClientRect(),
    );
    // Stacked columns, as on a phone, have no split to move.
    const sideBySide = boxes.every(
      (box, at) => at === 0 || box.left >= (boxes[at - 1]?.right ?? 0) - 1,
    );
    if (boxes.length < 2 || !sideBySide) continue;
    const current = shares(
      templateOf(editor, key),
      boxes.map((box) => box.width),
    );
    for (let index = 0; index < boxes.length - 1; index++) {
      const before = boxes[index];
      const after = boxes[index + 1];
      if (!before || !after) continue;
      const top = Math.min(before.top, after.top);
      splits.push({
        key,
        index,
        count: boxes.length,
        left: window.scrollX + (before.right + after.left) / 2,
        top: window.scrollY + top,
        height: Math.max(before.bottom, after.bottom) - top,
        value: splitValue(current, index),
      });
    }
  }
  return splits;
}

/** Writes `next` shares as the row's template, as one undo step a drag. */
function setShares(
  editor: LexicalEditor,
  key: NodeKey,
  next: readonly number[],
  tag: string,
) {
  editor.update(
    () => {
      const node = $getNodeByKey(key);
      if (LayoutContainerNode.$isLayoutContainerNode(node))
        node.setTemplateColumns(template(next));
    },
    { tag },
  );
}

function ColumnSplit({
  editor,
  split,
}: {
  editor: LexicalEditor;
  split: Split;
}): JSX.Element {
  const { key, index, count } = split;
  const drag = useRef<{
    x: number;
    widths: number[];
    start: number[];
    moved: boolean;
  } | null>(null);

  const widths = () => {
    const row = editor.getElementByKey(key);
    return row
      ? columnsOf(row).map((column) => column.getBoundingClientRect().width)
      : [];
  };
  const pair = (sizes: readonly number[]) =>
    (sizes[index] ?? 0) + (sizes[index + 1] ?? 0);
  const minimum = (sizes: readonly number[]) =>
    Math.min(0.45, MINIMUM_WIDTH / Math.max(pair(sizes), 1));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sizes = widths();
    drag.current = {
      x: event.clientX,
      widths: sizes,
      start: shares(templateOf(editor, key), sizes),
      moved: false,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const fraction =
      ((current.widths[index] ?? 0) + event.clientX - current.x) /
      Math.max(pair(current.widths), 1);
    setShares(
      editor,
      key,
      moveSplit(current.start, index, fraction, minimum(current.widths)),
      current.moved ? HISTORY_MERGE_TAG : HISTORY_PUSH_TAG,
    );
    current.moved = true;
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const sizes = widths();
    const current = shares(templateOf(editor, key), sizes);
    const fraction =
      (current[index] ?? 0) / Math.max(pair(current), Number.EPSILON);
    setShares(
      editor,
      key,
      moveSplit(current, index, fraction + direction * STEP, minimum(sizes)),
      HISTORY_PUSH_TAG,
    );
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter that moves, which <hr> is not
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`Resize columns ${index + 1} and ${index + 2}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={split.value}
      className="column-split"
      style={{ left: split.left, top: split.top, height: split.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() =>
        setShares(
          editor,
          key,
          Array.from({ length: count }, () => 1),
          HISTORY_PUSH_TAG,
        )
      }
      onKeyDown={onKeyDown}
    />
  );
}

function ColumnResizer({ editor }: { editor: LexicalEditor }): JSX.Element {
  const [splits, setSplits] = useState<Split[]>([]);

  // The browser's layout of Lexical's rows of columns, measured again on each
  // editor update, row resize, window resize and scroll.
  useEffect(() => {
    const rows = new Set<NodeKey>();
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSplits(measure(editor, rows)));
    };
    const resized = new ResizeObserver(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const unregister = mergeRegister(
      editor.registerMutationListener(
        LayoutContainerNode,
        (mutations) => {
          for (const [key, mutation] of mutations) {
            if (mutation === "destroyed") rows.delete(key);
            else rows.add(key);
            const row = editor.getElementByKey(key);
            if (row) resized.observe(row);
          }
          update();
        },
        { skipInitialization: false },
      ),
      editor.registerUpdateListener(update),
    );
    return () => {
      unregister();
      resized.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [editor]);

  return (
    <div className="column-splits">
      {splits.map((split) => (
        <ColumnSplit
          key={`${split.key}:${split.index}`}
          editor={editor}
          split={split}
        />
      ))}
    </div>
  );
}

/**
 * A split over each gap between columns, which drags to share the two
 * columns' width anew, double-clicks back to equal columns, and moves with
 * the arrow keys. Only an editor has them.
 */
export default function ColumnResizerPlugin(): ReactPortal | null {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  return isEditable
    ? createPortal(<ColumnResizer editor={editor} />, document.body)
    : null;
}

"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  $getFigure,
  $setFigure,
  type Figure,
  type FigureWidth,
} from "@packages/lexical-nodes";
import { $getNodeByKey, type NodeKey } from "lexical";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

const WIDTHS: { label: string; width: FigureWidth | undefined }[] = [
  { label: "50%", width: "50%" },
  { label: "75%", width: "75%" },
  { label: "Column", width: undefined },
  { label: "Wide", width: "wide" },
  { label: "Full", width: "full" },
];

function useUpdateFigure(nodeKey: NodeKey) {
  const [editor] = useLexicalComposerContext();
  return (change: (figure: Figure) => Figure) =>
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node) $setFigure(node, change($getFigure(node)));
    });
}

/**
 * The width choices and caption switch of a selected figure, above it so
 * they cover the text before it rather than the figure being placed.
 */
export function FigureToolbar({
  nodeKey,
  width,
  captionShown,
  onToggleCaption,
}: {
  nodeKey: NodeKey;
  width: FigureWidth | undefined;
  captionShown: boolean;
  /** Left out for a figure that takes no caption. */
  onToggleCaption?: () => void;
}) {
  const updateFigure = useUpdateFigure(nodeKey);
  const button =
    "h-7 rounded px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground";
  return (
    <div
      role="toolbar"
      aria-label="Figure"
      className="document-figure-toolbar absolute bottom-full left-0 z-20 mb-1 flex items-center gap-0.5 rounded-md border border-border bg-popover p-0.5 shadow-sm print:hidden"
      onMouseDown={(event) => event.preventDefault()}
    >
      {WIDTHS.map((choice) => (
        <button
          key={choice.label}
          type="button"
          className={button}
          aria-pressed={width === choice.width}
          onClick={() =>
            updateFigure((figure) => ({ ...figure, width: choice.width }))
          }
        >
          {choice.label}
        </button>
      ))}
      {onToggleCaption && (
        <>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          <button
            type="button"
            className={button}
            aria-pressed={captionShown}
            onClick={onToggleCaption}
          >
            Caption
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A caption for a figure that has no caption editor of its own. While it is
 * written it is plain text; emptied, it goes away.
 */
function FigureCaption({
  nodeKey,
  caption,
}: {
  nodeKey: NodeKey;
  caption: string | undefined;
}) {
  const editable = useLexicalEditable();
  const updateFigure = useUpdateFigure(nodeKey);
  if (caption === undefined || (!editable && caption.trim() === ""))
    return null;
  if (!editable) return <div className="document-caption">{caption}</div>;
  const commit = (text: string) =>
    updateFigure((figure) => ({
      ...figure,
      caption: text.trim() === "" ? undefined : text.trim(),
    }));
  return (
    <div className="document-caption">
      <textarea
        key={caption}
        rows={1}
        defaultValue={caption}
        placeholder="Write a caption"
        aria-label="Caption"
        // biome-ignore lint/a11y/noAutofocus: a caption opened from the toolbar is for writing straight away
        autoFocus={caption === ""}
        className="block w-full resize-none bg-transparent p-0 text-center [field-sizing:content] outline-none placeholder:text-muted-foreground"
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.currentTarget.value = caption;
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

/**
 * A figure without a caption editor of its own: the block, its caption
 * below, and while it is selected, its controls.
 */
export function FigureFrame({
  nodeKey,
  figure,
  children,
  className,
}: {
  nodeKey: NodeKey;
  figure: Figure;
  children: ReactNode;
  className?: string;
}) {
  const editable = useLexicalEditable();
  const [selected] = useLexicalNodeSelection(nodeKey);
  const updateFigure = useUpdateFigure(nodeKey);
  return (
    <div className={cn("document-figure-frame relative", className)}>
      {editable && selected && (
        <FigureToolbar
          nodeKey={nodeKey}
          width={figure.width}
          captionShown={figure.caption !== undefined}
          onToggleCaption={() =>
            updateFigure((current) => ({
              ...current,
              caption: current.caption === undefined ? "" : undefined,
            }))
          }
        />
      )}
      {children}
      <FigureCaption nodeKey={nodeKey} caption={figure.caption} />
    </div>
  );
}

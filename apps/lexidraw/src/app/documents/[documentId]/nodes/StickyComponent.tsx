import type { LexicalEditor, NodeKey } from "lexical";
import type { JSX } from "react";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { $getNodeByKey } from "lexical";

import { StickyNode, type StickyNoteColor } from "./StickyNode";
import LexicalContentEditable from "~/components/ui/content-editable";
import { Button } from "~/components/ui/button";
import { PaintbrushIcon, TrashIcon } from "lucide-react";

const colorClasses = {
  pink: "bg-sticky-pink",
  yellow: "bg-sticky-yellow",
  green: "bg-sticky-green",
  blue: "bg-sticky-blue",
  red: "bg-sticky-red",
  orange: "bg-sticky-orange",
  purple: "bg-sticky-purple",
  gray: "bg-sticky-gray",
} as const satisfies Record<StickyNoteColor, string>;

export default function StickyComponent({
  nodeKey,
  color,
  caption,
}: {
  caption: LexicalEditor;
  color: StickyNoteColor;
  nodeKey: NodeKey;
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();

  const handleDelete = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (StickyNode.$isStickyNode(node)) {
        node.remove();
      }
    });
  };

  const handleColorChange = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (StickyNode.$isStickyNode(node)) {
        node.toggleColor();
      }
    });
  };

  return (
    <div className="sticky-note-container">
      <div className={`sticky-note ${colorClasses[color]}`}>
        {isEditable && (
          <div className="absolute top-1 right-1 z-10 flex gap-0.5 print:hidden">
            <Button
              onClick={handleColorChange}
              variant="ghost"
              size="icon"
              className="size-7 text-paper-ink hover:bg-paper-ink/10 hover:text-paper-ink"
              aria-label="Change sticky note color"
              title="Color"
            >
              <PaintbrushIcon className="size-4" />
            </Button>
            <Button
              onClick={handleDelete}
              size="icon"
              variant="ghost"
              className="size-7 text-paper-ink hover:bg-paper-ink/10 hover:text-paper-ink"
              aria-label="Delete sticky note"
              title="Delete"
            >
              <TrashIcon className="size-4" />
            </Button>
          </div>
        )}
        <LexicalNestedComposer initialEditor={caption}>
          <PlainTextPlugin
            contentEditable={
              <LexicalContentEditable
                placeholder="Write a note…"
                placeholderClassName="top-0 left-0 translate-y-0 text-paper-ink/60 select-none whitespace-nowrap"
                className="block w-full p-0 font-normal whitespace-pre-wrap break-words caret-paper-ink select-text"
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </LexicalNestedComposer>
      </div>
    </div>
  );
}

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { cn } from "~/lib/utils";
import { PaletteIcon, TrashIcon } from "lucide-react";

/** The palette in menu order, each colour with its name and fill. */
const COLORS = {
  pink: { label: "Pink", fill: "bg-sticky-pink" },
  yellow: { label: "Yellow", fill: "bg-sticky-yellow" },
  green: { label: "Green", fill: "bg-sticky-green" },
  blue: { label: "Blue", fill: "bg-sticky-blue" },
  red: { label: "Red", fill: "bg-sticky-red" },
  orange: { label: "Orange", fill: "bg-sticky-orange" },
  purple: { label: "Purple", fill: "bg-sticky-purple" },
  gray: { label: "Gray", fill: "bg-sticky-gray" },
} as const satisfies Record<StickyNoteColor, { label: string; fill: string }>;

const isColor = (value: string): value is StickyNoteColor => value in COLORS;

/**
 * A note's controls stay out of the text's way until the note is pointed at
 * or holds focus; an open menu keeps its trigger shown.
 */
const control =
  "size-7 text-paper-ink opacity-0 transition-opacity duration-fast hover:bg-paper-ink/10 hover:text-paper-ink focus-visible:opacity-100 group-hover/sticky:opacity-100 group-focus-within/sticky:opacity-100 data-[state=open]:opacity-100";

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

  const withNote = (change: (node: StickyNode) => void) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (StickyNode.$isStickyNode(node)) change(node);
    });
  };

  return (
    <div className="sticky-note-container">
      <div className={cn("sticky-note group/sticky", COLORS[color].fill)}>
        {isEditable && (
          <div className="absolute top-1.5 right-1.5 z-10 flex gap-0.5 print:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={control}
                  aria-label="Sticky note colour"
                  title="Colour"
                >
                  <PaletteIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={color}
                  onValueChange={(value) => {
                    if (isColor(value))
                      withNote((node) => node.setColor(value));
                  }}
                >
                  {Object.entries(COLORS).map(([value, { label, fill }]) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 rounded-full border border-paper-ink/15",
                          fill,
                        )}
                      />
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              onClick={() => withNote((node) => node.remove())}
              size="icon"
              variant="ghost"
              className={control}
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
                className={cn(
                  "block w-full p-0 font-normal whitespace-pre-wrap break-words caret-paper-ink select-text",
                  // Room for the controls, so they never sit on the text.
                  isEditable && "pe-12",
                )}
              />
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </LexicalNestedComposer>
      </div>
    </div>
  );
}

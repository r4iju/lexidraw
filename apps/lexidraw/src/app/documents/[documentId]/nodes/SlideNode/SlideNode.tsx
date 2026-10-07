import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import {
  SlideNode as HeadlessSlideNode,
  slideDeckText,
} from "@packages/lexical-nodes";
import type { NodeKey } from "lexical";
import { PresentationIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "~/lib/utils";

/** React half of the package's SlideNode; see ImageNode. */
export class SlideNode extends HeadlessSlideNode {
  $config() {
    return this.config("slide-deck", { extends: HeadlessSlideNode });
  }

  decorate(): JSX.Element {
    return (
      <LegacySlideDeck
        nodeKey={this.getKey()}
        lines={slideDeckText(this.__data)}
      />
    );
  }
}

/**
 * A deck saved before slides were removed, kept as stored: what it said, and
 * no way to change it. Selecting it lets the editor delete it as any block.
 */
function LegacySlideDeck({
  nodeKey,
  lines,
}: {
  nodeKey: NodeKey;
  lines: string[];
}) {
  const isEditable = useLexicalEditable();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: selection is the editor's, by pointer or arrow keys
    // biome-ignore lint/a11y/useKeyWithClickEvents: the editor moves selection onto a block from the keyboard
    <div
      data-node-type="slide-deck"
      onClick={
        isEditable
          ? (event) => {
              if (!event.shiftKey) clearSelection();
              setSelected(true);
            }
          : undefined
      }
      className={cn(
        "rounded-md border border-dashed border-border px-4 py-3 text-muted-foreground",
        isEditable && "cursor-default",
        isSelected && "ring-1 ring-primary",
      )}
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <PresentationIcon aria-hidden className="size-4 shrink-0" />
        Slide deck (no longer supported)
      </p>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {lines.map((line, index) => (
            // The lines never reorder, and two can read the same.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={index} className="whitespace-pre-wrap">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

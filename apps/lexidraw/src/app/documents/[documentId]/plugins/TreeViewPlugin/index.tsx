import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TreeView } from "@lexical/react/LexicalTreeView";
import type * as React from "react";

export default function TreeViewPlugin(): React.JSX.Element {
  const [editor] = useLexicalComposerContext();
  return (
    <TreeView
      editor={editor}
      /* Tailwind classes for every sub-block */
      viewClassName="
      text-xs leading-[1.15rem] font-mono
      whitespace-pre
      break-words
      rounded-md
      bg-transparent
      text-foreground"
      treeTypeButtonClassName="
      ml-4 px-1 py-0.5 rounded-sm border border-muted-foreground
      text-muted-foreground hover:text-foreground transition"
      timeTravelPanelClassName="flex items-center gap-2 pt-2"
      timeTravelButtonClassName="
      px-1 py-0.5 rounded-sm border border-muted-foreground
      text-muted-foreground hover:text-foreground transition"
      timeTravelPanelSliderClassName="flex-1"
      timeTravelPanelButtonClassName="
      px-1 py-0.5 text-muted-foreground hover:text-foreground text-xs"
    />
  );
}

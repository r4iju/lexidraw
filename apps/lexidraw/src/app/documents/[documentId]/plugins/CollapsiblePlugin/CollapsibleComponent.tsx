import type { LexicalEditor, NodeKey } from "lexical";
import React, { useEffect, useRef } from "react";
import { $getNodeByKey } from "lexical";
import { ChevronRight } from "lucide-react";
import { CollapsibleContainerNode } from "./CollapsibleContainerNode";

export interface CollapsibleComponentProps {
  editor: LexicalEditor;
  nodeKey: NodeKey;
  title: string;
  initialContent: string;
  initialIsOpen: boolean;
}

export function CollapsibleComponent({
  editor,
  nodeKey,
  title,
  initialContent,
  initialIsOpen,
}: CollapsibleComponentProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (detailsRef.current) {
      detailsRef.current.open = initialIsOpen;
    }
  }, [initialIsOpen]);

  const handleToggle = () => {
    const next = detailsRef.current?.open ?? false;
    editor.update(() => {
      const node = $getNodeByKey<CollapsibleContainerNode>(nodeKey);
      if (node) node.setOpen(next);
    });
  };

  return (
    <details
      ref={detailsRef}
      onToggle={handleToggle}
      className="bg-card border border-border rounded-lg mb-2 select-none"
    >
      <summary className="flex items-center cursor-pointer pt-1 pr-1 pl-4 font-bold list-none">
        <ChevronRight
          className="
            mr-2 w-4 h-4
            transition-transform duration-200 ease-in-out
            details-open-summary:rotate-90
          "
        />
        {title}
      </summary>

      {/* content */}
      <div
        className="
          overflow-hidden origin-top
          scale-y-0 transition-transform duration-300 ease-in-out
          details-open-content:scale-y-100
        "
      >
        <div className="py-2 pr-1 pb-1 pl-2">{initialContent}</div>
      </div>
    </details>
  );
}

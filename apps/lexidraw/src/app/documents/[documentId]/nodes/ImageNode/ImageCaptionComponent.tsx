import React, { useEffect, useRef } from "react";
import type { LexicalEditor, LexicalNode } from "lexical";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import LinkPlugin from "../../plugins/LinkPlugin";
import ContentEditable from "~/components/ui/content-editable";
import Placeholder from "~/components/ui/placeholder";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useSharedHistoryContext } from "../../context/shared-history-context";
import { cn } from "~/lib/utils";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import MentionsPlugin from "../../plugins/MentionsPlugin";
import EmojisPlugin from "../../plugins/EmojisPlugin";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import KeywordsPlugin from "../../plugins/KeywordsPlugin";
import TreeViewPlugin from "../../plugins/TreeViewPlugin";
import { useSettings } from "../../context/settings-context";

type ImageCaptionComponentProps = {
  caption: LexicalEditor;
  captionsEnabled: boolean;
  initialNodes: readonly (typeof LexicalNode)[];
  placeholderClassName?: string;
  className?: string;
  placeholderText?: string;
  useMentionsPlugin?: boolean;
  useEmojisPlugin?: boolean;
  useHashtagPlugin?: boolean;
  useKeywordsPlugin?: boolean;
  useTreeViewPlugin?: boolean;
};

export function ImageCaptionComponent({
  caption,
  captionsEnabled,
  initialNodes,
  placeholderClassName = "text-muted-foreground text-sm",
  className,
  placeholderText = "Enter a caption...",
  useMentionsPlugin = true,
  useEmojisPlugin = true,
  useHashtagPlugin = true,
  useKeywordsPlugin = true,
}: ImageCaptionComponentProps): React.JSX.Element | null {
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);
  const { historyState } = useSharedHistoryContext();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();

  // Handle link clicks within the caption
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest("a");

      if (link && nestedEditorContainerRef.current?.contains(link)) {
        event.preventDefault();
        event.stopPropagation();

        const url = link.getAttribute("href");
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }
    };

    const container = nestedEditorContainerRef.current;
    if (container) {
      container.addEventListener("click", handleClick, true);
    }

    return () => {
      if (container) {
        container.removeEventListener("click", handleClick, true);
      }
    };
  }, []);

  if (!captionsEnabled) {
    return null;
  }

  return (
    <div
      ref={nestedEditorContainerRef}
      className={cn(
        "absolute bottom-0 left-0 w-full z-10 [&_a]:cursor-pointer",
        className,
      )}
    >
      <LexicalNestedComposer
        initialEditor={caption}
        initialNodes={initialNodes}
      >
        <AutoFocusPlugin />
        {useMentionsPlugin && <MentionsPlugin />}
        <LinkPlugin />
        {useEmojisPlugin && <EmojisPlugin />}
        {useHashtagPlugin && <HashtagPlugin />}
        {useKeywordsPlugin && <KeywordsPlugin />}
        <HistoryPlugin externalHistoryState={historyState} />
        <RichTextPlugin
          contentEditable={
            <ContentEditable className="border-none border border-muted-foreground bg-muted/50 backdrop-blur-md text-sm w-full" />
          }
          placeholder={
            <Placeholder className={placeholderClassName}>
              {placeholderText}
            </Placeholder>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        {showNestedEditorTreeView && <TreeViewPlugin />}
      </LexicalNestedComposer>
    </div>
  );
}

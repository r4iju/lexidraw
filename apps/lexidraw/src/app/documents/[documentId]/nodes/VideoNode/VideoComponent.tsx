import { $getNodeByKey, type LexicalEditor, type NodeKey } from "lexical";
import * as React from "react";
import { Suspense, useRef, useState } from "react";
import MentionsPlugin from "../../plugins/MentionsPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import ImageCaption from "../common/ImageCaption";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import EmojisPlugin from "../../plugins/EmojisPlugin";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import KeywordsPlugin from "../../plugins/KeywordsPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import TreeViewPlugin from "../../plugins/TreeViewPlugin";
import { VideoNode } from "./VideoNode";
import { useSharedHistoryContext } from "../../context/shared-history-context";
import { useSettings } from "../../context/settings-context";

const VIDEO_MAX_WIDTH = 560; // Standard video width

export default function VideoComponent({
  src,
  nodeKey,
  width,
  height,
  _resizable,
  caption,
  showCaption,
  captionsEnabled,
}: {
  height: "inherit" | number;
  nodeKey: NodeKey;
  src: string;
  width: "inherit" | number;
  _resizable: boolean;
  caption: LexicalEditor;
  showCaption: boolean;
  captionsEnabled: boolean;
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isLoadError, setIsLoadError] = useState<boolean>(false);
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);
  const { historyState } = useSharedHistoryContext();
  const [editor] = useLexicalComposerContext();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();

  const onError = () => {
    setIsLoadError(true);
  };

  const handleHideCaption = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (VideoNode.$isVideoNode(node)) {
        node.setShowCaption(false);
      }
    });
  };

  const videoStyle: React.CSSProperties = {
    height: height === "inherit" ? undefined : height,
    width: width === "inherit" ? undefined : width,
    maxWidth: VIDEO_MAX_WIDTH,
    display: "block",
  };

  return (
    <Suspense fallback={null}>
      <div style={{ position: "relative", textAlign: "center" }}>
        {isLoadError ? (
          <p className="text-destructive">Error loading video.</p>
        ) : (
          <video
            controls
            src={src}
            ref={videoRef}
            style={videoStyle}
            onError={onError}
            data-lexical-video-node-key={nodeKey}
          />
        )}
        {showCaption && captionsEnabled && (
          <ImageCaption
            containerRef={nestedEditorContainerRef}
            caption={caption}
            placeholder="Enter a caption..."
            onHideCaption={handleHideCaption}
          >
            <AutoFocusPlugin />
            <MentionsPlugin />
            <LinkPlugin />
            <EmojisPlugin />
            <HashtagPlugin />
            <KeywordsPlugin />
            <HistoryPlugin externalHistoryState={historyState} />
            {showNestedEditorTreeView && <TreeViewPlugin />}
          </ImageCaption>
        )}
      </div>
    </Suspense>
  );
}

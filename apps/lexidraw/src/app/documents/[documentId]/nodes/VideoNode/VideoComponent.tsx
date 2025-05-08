import type { LexicalEditor, NodeKey } from "lexical";
import * as React from "react";
import { Suspense, useRef, useState, useCallback, useEffect } from "react";
import MentionsPlugin from "../../plugins/MentionsPlugin";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import EmojisPlugin from "../../plugins/EmojisPlugin";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import KeywordsPlugin from "../../plugins/KeywordsPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import TreeViewPlugin from "../../plugins/TreeViewPlugin";
import { VideoNode } from "./VideoNode";
import { useSharedHistoryContext } from "../../context/shared-history-context";
import { useSettings } from "../../context/settings-context";
import VideoEditModal from "./VideoEditModal";
import { Button } from "~/components/ui/button";

import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  DRAGSTART_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from "lexical";

import ImageCaption from "../common/ImageCaption";
import VideoResizer from "~/components/ui/video-resizer";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";

const VIDEO_MAX_WIDTH = 560;

interface VideoComponentProps {
  src: string;
  nodeKey: NodeKey;
  width: "inherit" | number;
  height: "inherit" | number;
  resizable: boolean;
  caption: LexicalEditor;
  showCaption: boolean;
  captionsEnabled?: boolean;
}

export default function VideoComponent({
  src,
  nodeKey,
  width,
  height,
  resizable,
  caption,
  showCaption: initialShowCaption,
  captionsEnabled,
}: VideoComponentProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captionContainerRef = useRef<HTMLDivElement | null>(null);
  const [isLoadError, setIsLoadError] = useState<boolean>(false);
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);
  const { historyState } = useSharedHistoryContext();
  const [editor] = useLexicalComposerContext();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const currentShowCaption = initialShowCaption;

  console.log(
    `[VideoComponent ${nodeKey}] isSelected: ${isSelected}, isResizing: ${isResizing}`,
  );

  const $onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        const event: KeyboardEvent = payload;
        event.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if (node && VideoNode.$isVideoNode(node)) {
          node.remove();
          return true;
        }
      }
      return false;
    },
    [isSelected, nodeKey],
  );

  const $onEnter = useCallback(
    (event: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        if (currentShowCaption && caption) {
          $setSelection(null);
          event.preventDefault();
          caption.focus();
          return true;
        }
      }
      return false;
    },
    [caption, isSelected, currentShowCaption],
  );

  const $onEscape = useCallback(
    (_event: KeyboardEvent) => {
      if (isSelected) {
        clearSelection();
        setSelected(false);
        return true;
      }
      return false;
    },
    [isSelected, clearSelection, setSelected],
  );

  useEffect(() => {
    let isMounted = true;
    const unregister = mergeRegister(
      editor.registerUpdateListener(({ editorState: _editorState }) => {
        if (isMounted) {
          // setSelection(editorState.read(() => $getSelection()));
        }
      }),
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (e) => {
          if (e.target === videoRef.current) {
            const selection = $getSelection();
            if (!$isNodeSelection(selection) || !selection.has(nodeKey)) {
              // Node is not selected or this node is not part of multi-selection
              clearSelection();
              setSelected(true);
              e.preventDefault(); // Stop play/pause on first click (selection click)
              return true; // Event handled
            }
            // Node is already selected, let event pass to video for play/pause
            return false;
          }
          return false; // Click was not on this video element
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DRAGSTART_COMMAND,
        (event) => {
          if (event.target === videoRef.current) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(KEY_ENTER_COMMAND, $onEnter, COMMAND_PRIORITY_LOW),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        $onEscape,
        COMMAND_PRIORITY_LOW,
      ),
    );
    return () => {
      isMounted = false;
      unregister();
    };
  }, [
    clearSelection,
    editor,
    nodeKey,
    $onDelete,
    $onEnter,
    $onEscape,
    setSelected,
  ]);

  const onResizeStart = useCallback(() => {
    setIsResizing(true);
  }, []);

  const onResizeEnd = useCallback(
    (nextWidth: "inherit" | number, nextHeight: "inherit" | number) => {
      setTimeout(() => {
        setIsResizing(false);
      }, 200);

      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node && VideoNode.$isVideoNode(node)) {
          node.setWidthAndHeight(nextWidth, nextHeight);
        }
      });
    },
    [editor, nodeKey],
  );

  const setShowVideoCaptionOnNode = (show: boolean) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && VideoNode.$isVideoNode(node)) {
        node.setShowCaption(show);
      }
    });
  };

  const handleHideCaption = () => {
    setShowVideoCaptionOnNode(false);
  };

  const onError = () => {
    setIsLoadError(true);
  };

  const videoStyle: React.CSSProperties = {
    height: height === "inherit" ? undefined : height,
    width: width === "inherit" ? undefined : width,
    maxWidth: VIDEO_MAX_WIDTH,
    display: "block",
  };

  const isFocused = isSelected || isResizing;

  const handleApplyEditChanges = (newProps: {
    width: "inherit" | number;
    height: "inherit" | number;
    showCaption: boolean;
  }) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && VideoNode.$isVideoNode(node)) {
        node.setWidthAndHeight(newProps.width, newProps.height);
        node.setShowCaption(newProps.showCaption);
      }
    });
  };

  return (
    <Suspense fallback={null}>
      <div
        style={{ position: "relative", display: "inline-block" }}
        className={`${isFocused ? "outline-ring ring-primary" : ""}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {isHovered && !isResizing && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10 bg-background/80 hover:bg-background/100 p-1 h-auto"
            onClick={() => setIsEditModalOpen(true)}
            onMouseDown={(e) => e.preventDefault()}
          >
            Edit
          </Button>
        )}
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

        {currentShowCaption && captionsEnabled && (
          <div
            ref={captionContainerRef}
            className="lexical-video-caption-container mt-1 text-sm text-muted-foreground"
          >
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
          </div>
        )}
        {(isHovered || isResizing) && resizable && !isLoadError && (
          <VideoResizer
            editor={editor}
            videoRef={videoRef}
            buttonRef={buttonRef as React.RefObject<HTMLButtonElement>}
            maxWidth={VIDEO_MAX_WIDTH}
            onResizeStart={onResizeStart}
            onResizeEnd={onResizeEnd}
            showCaption={currentShowCaption || false}
            setShowCaption={setShowVideoCaptionOnNode}
            captionsEnabled={!!caption}
            initialWidth={width}
            initialHeight={height}
          />
        )}
        <button
          ref={buttonRef}
          style={{ display: "none" }}
          aria-hidden="true"
        />
      </div>
      {isEditModalOpen && (
        <VideoEditModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          initialWidth={width}
          initialHeight={height}
          initialShowCaption={currentShowCaption}
          onApplyChanges={handleApplyEditChanges}
        />
      )}
    </Suspense>
  );
}

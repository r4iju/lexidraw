import type { LexicalEditor, NodeKey /*, BaseSelection*/ } from "lexical"; // BaseSelection removed if _selection is removed
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
  // SELECTION_CHANGE_COMMAND, // Removed as unused
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
  showCaption,
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
  const buttonRef = useRef<HTMLButtonElement>(null); // Used by ImageResizer

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
        if (showCaption && caption) {
          $setSelection(null);
          event.preventDefault();
          caption.focus();
          return true;
        }
      }
      return false;
    },
    [caption, isSelected, showCaption],
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
          // setSelection(editorState.read(() => $getSelection())); // _selection removed
        }
      }),
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (payload) => {
          const event = payload;
          if (isResizing) {
            return true;
          }
          if (event.target === videoRef.current) {
            if (event.shiftKey) {
              setSelected(!isSelected);
            } else {
              clearSelection();
              setSelected(true);
            }
            return true;
          }
          return false;
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
    isResizing,
    isSelected,
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

  const setShowVideoCaption = (show: boolean) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node && VideoNode.$isVideoNode(node)) {
        node.setShowCaption(show);
      }
    });
  };

  const handleHideCaption = () => {
    setShowVideoCaption(false);
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

  return (
    <Suspense fallback={null}>
      <div
        style={{ position: "relative", textAlign: "center" }}
        className={`${isFocused ? "outline-ring ring-primary" : ""}`}
      >
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
        {resizable && isFocused && !isLoadError && (
          <VideoResizer
            editor={editor}
            videoRef={videoRef}
            buttonRef={buttonRef as React.RefObject<HTMLButtonElement>}
            maxWidth={VIDEO_MAX_WIDTH}
            onResizeStart={onResizeStart}
            onResizeEnd={onResizeEnd}
            showCaption={showCaption || false}
            setShowCaption={setShowVideoCaption}
            captionsEnabled={!!caption}
          />
        )}
        <button
          ref={buttonRef}
          style={{ display: "none" }}
          aria-hidden="true"
        />
      </div>
    </Suspense>
  );
}

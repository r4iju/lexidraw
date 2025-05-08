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
import VideoEditModal from "./VideoEditModal";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils"; // Import cn for conditional class names

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
  const [isVideoActivated, setIsVideoActivated] = useState(false); // State for video interaction mode

  const currentShowCaption = initialShowCaption;

  console.log(
    `[VideoComponent ${nodeKey}] isSelected: ${isSelected}, isResizing: ${isResizing}, isVideoActivated: ${isVideoActivated}`,
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
        setIsVideoActivated(false); // Deactivate video on escape
        return true;
      }
      return false;
    },
    [isSelected, clearSelection, setSelected],
  );

  // Effect to deactivate video when it's no longer selected
  useEffect(() => {
    if (!isSelected && isVideoActivated) {
      setIsVideoActivated(false);
    }
  }, [isSelected, isVideoActivated]);

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
            return true; // Don't interfere if already resizing
          }

          const clickTargetIsVideo = event.target === videoRef.current;

          if (isVideoActivated) {
            // If video is activated, and the click is on the video element itself,
            // we return true. This signals to Lexical that we've handled the click,
            // preventing it from deselecting the node. The browser's default action
            // (play/pause) for the video element will still occur because we haven't called
            // event.preventDefault() here for this specific scenario.
            if (clickTargetIsVideo) {
              return true;
            }
            // If activated and click is elsewhere within the component (e.g., padding),
            // it might be desirable to deactivate. For now, we let it fall through (returns false),
            // which might lead to deselection and then deactivation via useEffect.
          } else {
            // If not activated, the overlay is responsible for selection clicks on the video area.
            // If a click somehow reaches the video element directly when not activated,
            // this logic path will be taken. Returning true prevents Lexical from deselecting.
            if (clickTargetIsVideo) {
              // This path implies the overlay was not clicked or didn't stop propagation.
              // For safety, if a click lands on the video when not activated, we treat it as handled to avoid deselection.
              // The overlay should be the one setting selection state.
              return true;
            }
          }

          // For any other clicks not on the video element when activated,
          // or not on the video when not activated (where overlay should handle),
          // let Lexical proceed as usual (e.g. deselect if click is outside).
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
    isVideoActivated, // Add isVideoActivated to dependency array
  ]);

  const onResizeStart = useCallback(() => {
    setIsResizing(true);
    setIsVideoActivated(false); // Deactivate video when resizing starts
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
        className={`${isFocused && !isVideoActivated ? "outline-ring ring-primary" : ""}`}
      >
        {isFocused &&
          !isResizing &&
          !isVideoActivated && ( // Hide Edit button if video is activated
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 z-40 bg-background/80 hover:bg-background/100 p-1 h-auto"
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

        {/* Click interceptor overlay - shown when not resizing and video not activated */}
        {!isResizing && (
          <div
            className={cn(
              "absolute top-0 left-0 w-full h-full z-10 cursor-default",
              isVideoActivated && "pointer-events-none", // Allow clicks to pass through when activated
            )}
            onClick={(event) => {
              if (isVideoActivated) return; // Do nothing if already activated, let potential underlying elements handle click
              event.preventDefault();
              event.stopPropagation();
              if (event.shiftKey) {
                setSelected(!isSelected);
              } else {
                clearSelection();
                setSelected(true);
              }
            }}
            onDoubleClick={() => {
              if (!isResizing) {
                // Only activate if not currently resizing
                setIsVideoActivated(true);
                // Optionally, if node is selected, focus the video element for keyboard controls
                if (isSelected && videoRef.current) {
                  videoRef.current.focus();
                }
              }
            }}
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
        {resizable &&
          !isLoadError &&
          !isVideoActivated && ( // Hide resizer if video is activated
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

import type {
  BaseSelection,
  LexicalCommand,
  LexicalEditor,
  NodeKey,
} from "lexical";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  createCommand,
  DRAGSTART_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import type * as React from "react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../../context/settings-context";
import { useSharedHistoryContext } from "../../context/shared-history-context";
import EmojisPlugin from "../../plugins/EmojisPlugin";
import KeywordsPlugin from "../../plugins/KeywordsPlugin";
import LinkPlugin from "../../plugins/LinkPlugin";
import MentionsPlugin from "../../plugins/MentionsPlugin";
import TreeViewPlugin from "../../plugins/TreeViewPlugin";
import type { FigureWidth } from "@packages/lexical-nodes";
import ImageResizer from "~/components/ui/image-resizer";
import { ImageNode } from "./ImageNode";
import { cn } from "~/lib/utils";
import ImageCaption, { useCaptionJustShown } from "../common/ImageCaption";
import { FigureToolbar } from "../common/Figure";
import { NodeEditButton } from "../common/NodeEditButton";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { UpdateImageDialog } from "./UpdateImageDialog";

export const RIGHT_CLICK_IMAGE_COMMAND: LexicalCommand<MouseEvent> =
  createCommand("RIGHT_CLICK_IMAGE_COMMAND");

function LazyImage({
  altText,
  imageRef,
  src,
  width,
  height,
  focused,
  fill,
  onDoubleClick,
}: {
  altText: string;
  imageRef: React.RefObject<HTMLImageElement | null>;
  src: string;
  width: "inherit" | number;
  height: "inherit" | number;
  focused: boolean;
  /** Placed at a figure width, the image fills it whatever size it was dragged to. */
  fill: boolean;
  onDoubleClick: (event: React.MouseEvent) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  return (
    <>
      {status !== "ready" && (
        <div
          role="img"
          aria-label={altText}
          aria-busy={status === "loading"}
          className="media-placeholder"
        >
          {status === "error" && (
            <img src="/images/image-broken.svg" alt="" width={32} height={32} />
          )}
          <span>
            {status === "error" ? "Image unavailable" : "Loading image"}
            {altText ? ` · ${altText}` : ""}
          </span>
        </div>
      )}
      {status !== "error" && (
        <img
          src={src}
          alt={altText}
          ref={imageRef}
          draggable={false}
          className={cn("document-image", focused && "ring-2 ring-ring")}
          data-selected={focused || undefined}
          style={{
            display: status === "loading" ? "none" : undefined,
            width: fill ? "100%" : undefined,
            maxWidth:
              typeof width === "number" && !fill
                ? `min(100%, ${width}px)`
                : "100%",
            maxHeight:
              typeof height === "number" && !fill
                ? `min(80vh, ${height}px)`
                : undefined,
          }}
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          onDoubleClick={onDoubleClick}
        />
      )}
    </>
  );
}

type ImageComponentProps = {
  altText: string;
  caption: LexicalEditor;
  height: "inherit" | number;
  maxWidth: number;
  nodeKey: NodeKey;
  resizable: boolean;
  showCaption: boolean;
  src: string;
  width: "inherit" | number;
  captionsEnabled: boolean;
  figureWidth: FigureWidth | undefined;
};

export default function ImageComponent({
  src,
  altText,
  nodeKey,
  width,
  height,
  maxWidth,
  resizable,
  showCaption,
  caption,
  captionsEnabled,
  figureWidth,
}: ImageComponentProps): React.JSX.Element {
  const captionJustShown = useCaptionJustShown(showCaption);
  const imageRef = useRef<HTMLImageElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState(false);
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [selection, setSelection] = useState<BaseSelection | null>(null);
  const activeEditorRef = useRef<LexicalEditor | null>(null);
  const [resizeDimensions, setCurrentDimensions] = useState<{
    width: number | "inherit";
    height: number | "inherit";
  } | null>(null);
  const currentDimensions =
    isResizing && resizeDimensions ? resizeDimensions : { width, height };
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const $onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        const event: KeyboardEvent = payload;
        event.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if (ImageNode.$isImageNode(node)) {
          node.remove();
          return true;
        }
      }
      return false;
    },
    [isSelected, nodeKey],
  );

  const $onEnter = useCallback(
    (event: KeyboardEvent | null) => {
      const latestSelection = $getSelection();
      const buttonElem = buttonRef.current;
      if (
        isSelected &&
        $isNodeSelection(latestSelection) &&
        latestSelection.getNodes().length === 1
      ) {
        if (showCaption) {
          // Move focus into nested editor
          $setSelection(null);
          event?.preventDefault();
          caption.focus();
          return true;
        } else if (
          buttonElem !== null &&
          buttonElem !== document.activeElement
        ) {
          event?.preventDefault();
          buttonElem.focus();
          return true;
        }
      }
      return false;
    },
    [caption, isSelected, showCaption],
  );

  const $onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (
        activeEditorRef.current === caption ||
        buttonRef.current === event.target
      ) {
        $setSelection(null);
        editor.update(() => {
          setSelected(true);
          const parentRootElement = editor.getRootElement();
          if (parentRootElement !== null) {
            parentRootElement.focus();
          }
        });
        return true;
      }
      return false;
    },
    [caption, editor, setSelected],
  );

  const onClick = useCallback(
    (payload: MouseEvent) => {
      const event = payload;

      if (isResizing) {
        return true;
      }
      if (event.target === imageRef.current) {
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
    [isResizing, isSelected, setSelected, clearSelection],
  );

  const onRightClick = useCallback(
    (event: MouseEvent): void => {
      editor.getEditorState().read(() => {
        const latestSelection = $getSelection();
        const domElement = event.target as HTMLElement;
        if (
          domElement.tagName === "IMG" &&
          $isRangeSelection(latestSelection) &&
          latestSelection.getNodes().length === 1
        ) {
          editor.dispatchCommand(
            RIGHT_CLICK_IMAGE_COMMAND,
            event as MouseEvent,
          );
        }
      });
    },
    [editor],
  );

  useEffect(() => {
    let isMounted = true;
    const rootElement = editor.getRootElement();
    const unregister = mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        if (isMounted) {
          setSelection(editorState.read(() => $getSelection()));
        }
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_, activeEditor) => {
          activeEditorRef.current = activeEditor;
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        onClick,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand<MouseEvent>(
        RIGHT_CLICK_IMAGE_COMMAND,
        onClick,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DRAGSTART_COMMAND,
        (event) => {
          if (event.target === imageRef.current) {
            // TODO This is just a temporary workaround for FF to behave like other browsers.
            // Ideally, this handles drag & drop too (and all browsers).
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

    rootElement?.addEventListener("contextmenu", onRightClick);

    return () => {
      isMounted = false;
      unregister();
      rootElement?.removeEventListener("contextmenu", onRightClick);
    };
  }, [editor, $onDelete, $onEnter, $onEscape, onClick, onRightClick]);

  const setShowCaption = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (ImageNode.$isImageNode(node)) {
        node.setShowCaption(true);
      }
    });
  };

  const onResizeEnd = (
    nextWidth: "inherit" | number,
    nextHeight: "inherit" | number,
  ) => {
    // Delay hiding the resize bars for click case
    setTimeout(() => {
      setIsResizing(false);
    }, 200);

    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (ImageNode.$isImageNode(node)) {
        node.setWidthAndHeight(nextWidth, nextHeight);
      }
    });
  };

  const onResizeStart = () => {
    setIsResizing(true);
  };

  const onDimensionsChange = (dimensions: {
    width: number | "inherit";
    height: number | "inherit";
  }) => {
    setCurrentDimensions(dimensions);
  };

  const { historyState } = useSharedHistoryContext();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();

  const draggable =
    isEditable && isSelected && $isNodeSelection(selection) && !isResizing;
  const isFocused = isEditable && (isSelected || isResizing);

  const handleHideCaption = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (ImageNode.$isImageNode(node)) {
        node.setShowCaption(false);
      }
    });
  };

  return (
    <Suspense fallback={null}>
      <div
        className={cn("group/node relative inline-block document-figure", {
          "cursor-move": draggable,
        })}
        draggable={draggable}
      >
        <LazyImage
          key={src}
          focused={isFocused}
          src={src}
          altText={altText}
          imageRef={imageRef}
          width={currentDimensions.width}
          height={currentDimensions.height}
          fill={figureWidth !== undefined}
          onDoubleClick={(e) => {
            // prevent double clicking from propagating to parent
            e.stopPropagation();
            setIsLightboxOpen(true);
          }}
        />

        {isEditable && isSelected && $isNodeSelection(selection) && (
          <FigureToolbar
            nodeKey={nodeKey}
            width={figureWidth}
            captionShown={showCaption}
            onToggleCaption={
              !captionsEnabled
                ? undefined
                : showCaption
                  ? handleHideCaption
                  : setShowCaption
            }
          />
        )}

        {isEditable && (
          <NodeEditButton
            ref={buttonRef}
            label="Edit image"
            visible={isFocused}
            onClick={() => setIsDialogOpen(true)}
          />
        )}

        {showCaption && (
          <ImageCaption
            containerRef={nestedEditorContainerRef}
            caption={caption}
            placeholder="Enter a caption..."
            autoFocus={captionJustShown}
            onHideCaption={handleHideCaption}
          >
            <MentionsPlugin />
            <LinkPlugin />
            <EmojisPlugin />
            <HashtagPlugin />
            <KeywordsPlugin />
            <HistoryPlugin externalHistoryState={historyState} />
            {showNestedEditorTreeView && <TreeViewPlugin />}
          </ImageCaption>
        )}

        {resizable && $isNodeSelection(selection) && isFocused && (
          <ImageResizer
            showCaption={showCaption}
            setShowCaption={setShowCaption}
            editor={editor}
            buttonRef={buttonRef as React.RefObject<HTMLButtonElement>}
            imageRef={imageRef as React.RefObject<HTMLImageElement>}
            maxWidth={maxWidth}
            onResizeStart={onResizeStart}
            onResizeEnd={onResizeEnd}
            // The figure toolbar offers the caption.
            captionsEnabled={false}
            onDimensionsChange={onDimensionsChange}
          />
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <UpdateImageDialog
          activeEditor={editor}
          nodeKey={nodeKey}
          onClose={() => setIsDialogOpen(false)}
        />
      </Dialog>
      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
        <DialogContent size="full" className="flex items-center justify-center">
          <DialogTitle className="sr-only">Image Lightbox</DialogTitle>
          <img
            src={src}
            alt={altText}
            className="max-h-full max-w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </Suspense>
  );
}

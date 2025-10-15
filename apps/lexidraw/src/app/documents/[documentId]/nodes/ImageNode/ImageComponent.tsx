import type {
  BaseSelection,
  LexicalCommand,
  LexicalEditor,
  NodeKey,
} from "lexical";

import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
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
import ImageResizer from "~/components/ui/image-resizer";
import { ImageNode } from "./ImageNode";
import NextImage from "next/image";
import { ErrorBoundary } from "react-error-boundary";
import { cn } from "~/lib/utils";
import ImageCaption from "../common/ImageCaption";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { UpdateImageDialog } from "./UpdateImageDialog";

export const RIGHT_CLICK_IMAGE_COMMAND: LexicalCommand<MouseEvent> =
  createCommand("RIGHT_CLICK_IMAGE_COMMAND");

function BrokenImage(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center w-full h-full opacity-50">
      <NextImage
        alt="Image is broken"
        height={200}
        width={200}
        src="/images/image-broken.svg"
        draggable="false"
      />
    </div>
  );
}

type LazyImageProps = {
  altText: string;
  className: string | null;
  height: "inherit" | number;
  imageRef: { current: null | HTMLImageElement };
  maxWidth: number;
  src: string;
  width: "inherit" | number;
  onError: () => void;
};

function LazyImage({
  altText,
  className,
  imageRef,
  src,
  width,
  height,
  onError,
}: LazyImageProps): React.JSX.Element {
  return (
    <ErrorBoundary
      FallbackComponent={() => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={altText}
          className={className ?? undefined}
          ref={imageRef as React.RefObject<HTMLImageElement>}
          draggable={false}
          style={{
            width: width === "inherit" ? "auto" : `${width}px`,
            height: height === "inherit" ? "auto" : `${height}px`,
            objectFit: "contain",
            maxWidth: "100%",
          }}
        />
      )}
      onError={onError}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={altText}
        style={{
          width: typeof width === "number" ? `${width}px` : "auto",
          height: typeof height === "number" ? `${height}px` : "auto",
          objectFit: "contain",
        }}
        draggable={false}
        className={cn("rounded-xs", className)}
        ref={imageRef as React.RefObject<HTMLImageElement>}
      />
    </ErrorBoundary>
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
}: ImageComponentProps): React.JSX.Element {
  const imageRef = useRef<HTMLImageElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState(false);
  const [editor] = useLexicalComposerContext();
  const [selection, setSelection] = useState<BaseSelection | null>(null);
  const activeEditorRef = useRef<LexicalEditor | null>(null);
  const [isLoadError, setIsLoadError] = useState(false);
  const [currentDimensions, setCurrentDimensions] = useState({
    width,
    height,
  });
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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
    (event: KeyboardEvent) => {
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
          event.preventDefault();
          caption.focus();
          return true;
        } else if (
          buttonElem !== null &&
          buttonElem !== document.activeElement
        ) {
          event.preventDefault();
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
    // keep state in sync with node updates unless the user is actively dragging
    if (!isResizing) {
      setCurrentDimensions({ width, height });
    }
  }, [width, height, isResizing]);

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
  }, [
    clearSelection,
    editor,
    isResizing,
    isSelected,
    nodeKey,
    $onDelete,
    $onEnter,
    $onEscape,
    onClick,
    onRightClick,
    setSelected,
  ]);

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

  const draggable = isSelected && $isNodeSelection(selection) && !isResizing;
  const isFocused = isSelected || isResizing;

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
        className={cn("relative inline-block", {
          "cursor-move": draggable,
        })}
        draggable={draggable}
      >
        {isLoadError ? (
          <BrokenImage />
        ) : (
          <LazyImage
            className={isFocused ? "ring-1 ring-muted-foreground" : null}
            src={src}
            altText={altText}
            imageRef={imageRef}
            width={currentDimensions.width}
            height={currentDimensions.height}
            maxWidth={maxWidth}
            onError={() => setIsLoadError(true)}
          />
        )}

        {buttonRef && (
          <Button
            ref={buttonRef}
            variant="ghost"
            className="absolute top-0 right-0 mt-1 mr-1 z-10 bg-muted/60 hover:bg-muted/80 backdrop-blur-xs"
            onClick={() => setIsDialogOpen(true)}
          >
            Edit
          </Button>
        )}

        {showCaption && (
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
            captionsEnabled={!isLoadError && captionsEnabled}
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
    </Suspense>
  );
}

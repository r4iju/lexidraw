import type { Position, UpdateInlineImagePayload } from "./InlineImageNode";
import type { BaseSelection, LexicalEditor, NodeKey } from "lexical";

import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
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
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import * as React from "react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import LinkPlugin from "../../plugins/LinkPlugin";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { InlineImageNode } from "./InlineImageNode";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import { ErrorBoundary } from "react-error-boundary";
import ImageResizer from "~/components/ui/image-resizer";
import { Switch } from "~/components/ui/switch";
import { SwitchThumb } from "@radix-ui/react-switch";
import ImageCaption from "../common/ImageCaption";
import KeywordsPlugin from "../../plugins/KeywordsPlugin";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import EmojisPlugin from "../../plugins/EmojisPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import MentionsPlugin from "../../plugins/MentionsPlugin";
import TreeViewPlugin from "../../plugins/TreeViewPlugin";
import { useSharedHistoryContext } from "../../context/shared-history-context";
import { useSettings } from "../../context/settings-context";

type ResizableImageProps = {
  src: string;
  altText: string;
  width: number | "inherit";
  height: number | "inherit";
  position: string | undefined;
  className?: string;
  nodeKey: NodeKey;
  containerRef: React.RefObject<HTMLDivElement>;
};

function ResizableImage({
  src,
  altText,
  width,
  height,
  position,
  className,
  nodeKey,
  containerRef,
}: ResizableImageProps): React.JSX.Element {
  return (
    <div
      ref={containerRef}
      style={{
        width: typeof width === "number" ? width : undefined,
        height: typeof height === "number" ? height : undefined,
      }}
      data-position={position}
      data-lexical-node-key={nodeKey}
      className={cn("inline-block relative")}
    >
      <ErrorBoundary
        FallbackComponent={() => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={altText}
            draggable={false}
            className="object-contain"
          />
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={altText}
          draggable={false}
          style={{
            width: typeof width === "number" ? `${width}px` : "auto",
            height: typeof height === "number" ? `${height}px` : "auto",
          }}
          className={cn(
            "block object-contain rounded-xs align-bottom",
            className,
          )}
        />
      </ErrorBoundary>
    </div>
  );
}

export function UpdateInlineImageDialog({
  activeEditor,
  nodeKey,
  onClose,
}: {
  activeEditor: LexicalEditor;
  nodeKey: NodeKey;
  onClose: () => void;
}): React.JSX.Element {
  const editorState = activeEditor.getEditorState();
  const node = editorState.read(
    () => $getNodeByKey(nodeKey) as InlineImageNode,
  );
  const [altText, setAltText] = useState(node.getAltText());
  const [showCaption, setShowCaption] = useState(node.getShowCaption());
  const [position, setPosition] = useState<Position>(node.getPosition());
  const [widthAndHeight, setWidthAndHeight] = useState<{
    width: string;
    height: string;
  }>({
    width: node.getWidth().toString(),
    height: node.getHeight().toString(),
  });

  const handleAltTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAltText(e.target.value);
  };

  const handleWidthOrHeightChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    key: "width" | "height",
  ) => {
    const value = e.target.value;
    setWidthAndHeight((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const toWidthOrHeight = (value: string): "inherit" | number => {
    return value === "inherit" ? "inherit" : parseInt(value) || "inherit";
  };

  const handleOnConfirm = () => {
    const width = toWidthOrHeight(widthAndHeight.width);
    const height = toWidthOrHeight(widthAndHeight.height);
    const payload = {
      altText,
      position,
      showCaption,
      width,
      height,
    } satisfies UpdateInlineImagePayload;
    if (node) {
      activeEditor.update(() => {
        node.update(payload);
      });
    }
    onClose();
  };

  return (
    <DialogContent className="min-w-72">
      <DialogHeader>
        <DialogTitle>Update Inline Image</DialogTitle>
      </DialogHeader>
      <div style={{ marginBottom: "1em" }}>
        <Label htmlFor="alt-text">Alt Text</Label>
        <Input
          placeholder="Descriptive alternative text"
          onChange={handleAltTextChange}
          value={altText}
        />
      </div>
      {/* Add Width and Height Inputs */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <Label htmlFor="width">Width</Label>
          <Input
            id="width"
            placeholder="auto"
            type="number"
            step="50"
            onChange={(e) => handleWidthOrHeightChange(e, "width")}
            value={widthAndHeight.width}
            min="0"
            data-testid="image-modal-width-input"
          />
        </div>
        <div>
          <Label htmlFor="height">Height</Label>
          <Input
            id="height"
            placeholder="auto"
            type="number"
            step="50"
            onChange={(e) => handleWidthOrHeightChange(e, "height")}
            value={widthAndHeight.height}
            min="0"
            data-testid="image-modal-height-input"
          />
        </div>
      </div>
      <Select
        value={position}
        name="position"
        onValueChange={(val) => setPosition(val as Position)}
      >
        <SelectTrigger className="w-[208px] mb-1">
          <SelectValue placeholder="Position" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={"left" satisfies Position}>Left</SelectItem>
            <SelectItem value={"right" satisfies Position}>Right</SelectItem>
            <SelectItem value={"full" satisfies Position}>
              Full Width
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Switch
          id="caption"
          checked={showCaption}
          onCheckedChange={setShowCaption}
        >
          <SwitchThumb />
        </Switch>
        <Label htmlFor="caption">Show Caption</Label>
      </div>
      <DialogFooter className="justify-end">
        <Button onClick={handleOnConfirm}>Confirm</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export default function InlineImageComponent({
  src,
  altText,
  nodeKey,
  width,
  height,
  showCaption,
  caption,
  position,
  captionsEnabled,
}: {
  altText: string;
  caption: LexicalEditor;
  height: "inherit" | number;
  nodeKey: NodeKey;
  showCaption: boolean;
  src: string;
  width: "inherit" | number;
  position: Position;
  captionsEnabled: boolean;
}): React.JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [currentDimensions, setCurrentDimensions] = useState({
    width,
    height,
  });
  const [editor] = useLexicalComposerContext();
  const [selection, setSelection] = useState<BaseSelection | null>(null);
  const { historyState } = useSharedHistoryContext();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();

  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);

  const activeEditorRef = useRef<LexicalEditor | null>(null);
  const containerRef = useRef<HTMLImageElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);

  // Keydown logic
  const $onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        payload.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if (InlineImageNode.$isInlineImageNode(node)) {
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
      if (isSelected && $isNodeSelection(latestSelection)) {
        if (showCaption) {
          $setSelection(null);
          event.preventDefault();
          caption.focus();
          return true;
        } else if (
          buttonRef.current !== null &&
          buttonRef.current !== document.activeElement
        ) {
          event.preventDefault();
          buttonRef.current.focus();
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
          editor.getRootElement()?.focus();
        });
        return true;
      }
      return false;
    },
    [caption, editor, setSelected],
  );

  useEffect(() => {
    // keep state in sync with node updates
    setCurrentDimensions({ width, height });
  }, [width, height]);

  // Register commands
  useEffect(() => {
    let isMounted = true;
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
        (event) => {
          const target = event.target as HTMLElement;
          const clickedNodeKey = target
            .closest("[data-position]")
            ?.getAttribute("data-lexical-node-key");

          // If you clicked on THIS image's container
          if (clickedNodeKey === nodeKey) {
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
          const target = event.target as HTMLElement;
          if (target.closest("[data-position]")) {
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
    isSelected,
    setSelected,
  ]);

  const draggable = isSelected && $isNodeSelection(selection);
  const isFocused = isSelected;

  const onDimensionsChange = (dimensions: {
    width: number | "inherit";
    height: number | "inherit";
  }) => {
    setCurrentDimensions(dimensions);
  };

  // Callback to update the node's showCaption state
  const updateShowCaption = (show: boolean) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (InlineImageNode.$isInlineImageNode(node)) {
        node.setShowCaption(show);
      }
    });
  };

  // Callback to hide the caption
  const handleHideCaption = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (InlineImageNode.$isInlineImageNode(node)) {
        node.setShowCaption(false);
      }
    });
  };

  return (
    <Suspense fallback={null}>
      <>
        {/* 
          Use inline-flex div for vertical stacking while maintaining inline flow.
         */}
        <div
          draggable={draggable}
          className="inline-flex flex-col relative align-bottom"
        >
          {/* Container for Image, Edit button, and Resizer */}
          <div className="relative">
            <ResizableImage
              className={isFocused ? "ring-1 ring-muted-foreground" : ""}
              src={src}
              altText={altText}
              width={currentDimensions.width}
              height={currentDimensions.height}
              position={position}
              nodeKey={nodeKey}
              containerRef={containerRef as React.RefObject<HTMLDivElement>}
            />
            {/* "Edit" button on top */}
            <Button
              ref={buttonRef}
              variant="ghost"
              className="absolute top-0 right-0 mt-1 mr-1 z-10 bg-muted/60 hover:bg-muted/80 backdrop-blur-xs"
              onClick={() => setIsDialogOpen(true)}
            >
              Edit
            </Button>

            {isSelected && (
              <ImageResizer
                imageRef={containerRef as React.RefObject<HTMLImageElement>}
                editor={editor}
                buttonRef={buttonRef as React.RefObject<HTMLButtonElement>}
                showCaption={showCaption}
                setShowCaption={updateShowCaption}
                captionsEnabled={captionsEnabled}
                // ugly hack to offset the bottom-right resizer
                bottomOffset
                onResizeEnd={(newWidth, newHeight) => {
                  editor.update(() => {
                    const node = $getNodeByKey(nodeKey);
                    if (InlineImageNode.$isInlineImageNode(node)) {
                      node.setWidthAndHeight(newWidth, newHeight);
                    }
                  });
                }}
                onDimensionsChange={onDimensionsChange}
              />
            )}

            {/* Caption rendered inside the relative container */}
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
        </div>

        {/* The "Update Inline Image" dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <UpdateInlineImageDialog
            activeEditor={editor}
            nodeKey={nodeKey}
            onClose={() => setIsDialogOpen(false)}
          />
        </Dialog>
      </>
    </Suspense>
  );
}

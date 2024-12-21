import type { Position } from "./InlineImageNode";
import type { BaseSelection, LexicalEditor, NodeKey } from "lexical";

import "./InlineImageNode.css";

import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
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
import { $isInlineImageNode, InlineImageNode } from "./InlineImageNode";
import { Button } from "~/components/ui/button";
import LexicalContentEditable from "~/components/ui/content-editable";
import Placeholder from "~/components/ui/placeholder";
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

type ResizableImageProps = {
  src: string;
  altText: string;
  width: number | "inherit";
  height: number | "inherit";
  position: string | undefined;
  className?: string;
  nodeKey: NodeKey;
  editor: LexicalEditor;
  onResize: (
    newWidth: number | "inherit",
    newHeight: number | "inherit",
  ) => void;
};

function ResizableImage({
  src,
  altText,
  width,
  height,
  position,
  className,
  nodeKey,
  editor,
  onResize,
}: ResizableImageProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      ref={containerRef}
      className="relative inline-block"
      style={{ width, height }}
      data-position={position}
      data-lexical-node-key={nodeKey}
    >
      {/* Must use fallback img for external images */}
      <ErrorBoundary
        FallbackComponent={() => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={altText}
            draggable={false}
            className="object-contain"
            sizes="(max-width: 600px) 100vw, 300px"
          />
        )}
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
        />
      </ErrorBoundary>
      <ImageResizer
        onResizeStart={() => {}}
        onResizeEnd={(newWidth, newHeight) => {
          onResize(newWidth, newHeight);
        }}
        buttonRef={containerRef}
        imageRef={containerRef}
        editor={editor}
        showCaption={false}
        setShowCaption={() => {}}
        captionsEnabled={false}
      />
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

  const handleAltTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAltText(e.target.value);
  };

  const handleShowCaptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setShowCaption(e.target.checked);
  };

  const handleOnConfirm = () => {
    const payload = { altText, position, showCaption };
    if (node) {
      activeEditor.update(() => {
        node.update(payload);
      });
    }
    onClose();
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Update Inline Image</DialogTitle>
      </DialogHeader>
      <div style={{ marginBottom: "1em" }}>
        <Label htmlFor="alt-text">Alt Text</Label>
        <Input
          placeholder="Descriptive alternative text"
          onChange={handleAltTextChange}
          value={altText}
          data-test-id="image-modal-alt-text-input"
        />
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

      <div className="Input__wrapper">
        <input
          id="caption"
          type="checkbox"
          checked={showCaption}
          onChange={handleShowCaptionChange}
        />
        <label htmlFor="caption">Show Caption</label>
      </div>

      <DialogFooter>
        <Button
          data-test-id="image-modal-file-upload-btn"
          onClick={() => handleOnConfirm()}
        >
          Confirm
        </Button>
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
}: {
  altText: string;
  caption: LexicalEditor;
  height: "inherit" | number;
  nodeKey: NodeKey;
  showCaption: boolean;
  src: string;
  width: "inherit" | number;
  position: Position;
}): React.JSX.Element {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [editor] = useLexicalComposerContext();
  const [selection, setSelection] = useState<BaseSelection | null>(null);
  const activeEditorRef = useRef<LexicalEditor | null>(null);

  const $onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        payload.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if ($isInlineImageNode(node)) {
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
    isSelected,
    nodeKey,
    $onDelete,
    $onEnter,
    $onEscape,
    setSelected,
  ]);

  const draggable = isSelected && $isNodeSelection(selection);
  const isFocused = isSelected;

  return (
    <Suspense fallback={null}>
      <>
        <span draggable={draggable} className="inline-block relative">
          <ResizableImage
            className={isFocused ? "ring-1 ring-muted-foreground" : ""}
            src={src}
            altText={altText}
            width={width}
            height={height}
            position={position}
            nodeKey={nodeKey}
            onResize={(newWidth, newHeight) => {
              editor.update(() => {
                const node = $getNodeByKey(nodeKey);
                if ($isInlineImageNode(node)) {
                  node.setWidthAndHeight(newWidth, newHeight);
                }
              });
            }}
            editor={editor}
          />
          <Button
            ref={buttonRef}
            variant="ghost"
            className="absolute top-0 right-0 mt-1 mr-1 z-10"
            onClick={() => setIsDialogOpen(true)}
          >
            Edit
          </Button>
        </span>
        {showCaption && (
          <div className="mt-2">
            <LexicalNestedComposer initialEditor={caption}>
              <AutoFocusPlugin />
              <LinkPlugin />
              <RichTextPlugin
                contentEditable={
                  <LexicalContentEditable className="border p-2 text-sm w-full" />
                }
                placeholder={
                  <Placeholder className="text-gray-400 text-sm">
                    Enter a caption...
                  </Placeholder>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </LexicalNestedComposer>
          </div>
        )}
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

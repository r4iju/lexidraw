"use client";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  BaseSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  NodeKey,
} from "lexical";
import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { MermaidNode } from "../../nodes/MermaidNode";
import ImageResizer from "~/components/ui/image-resizer";
import MermaidImage from "./MermaidImage";
import { Button } from "~/components/ui/button";
import MermaidModal from "./MermaidModal";
import { cn } from "~/lib/utils";

type Dimension = number | "inherit";

export default function MermaidComponent({
  nodeKey,
  schema,
  width,
  height,
}: {
  nodeKey: NodeKey;
  schema: string;
  width: Dimension;
  height: Dimension;
}) {
  const [editor] = useLexicalComposerContext();

  /* refs & local state */
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [dims, setDims] = useState<{ width: Dimension; height: Dimension }>({
    width,
    height,
  });
  const [selection, setSelection] = useState<BaseSelection | null>(null);

  /* delete key */
  const onDelete = useCallback(
    (e: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        e.preventDefault();
        editor.update(() => {
          const n = $getNodeByKey(nodeKey);
          if (MermaidNode.$isMermaidNode(n)) n.remove();
        });
      }
      return false;
    },
    [editor, isSelected, nodeKey],
  );

  /* click / selection */
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (e: MouseEvent) => {
          if (containerRef.current?.contains(e.target as Node)) {
            if (!e.shiftKey) clearSelection();
            setSelected(!isSelected);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor, onDelete, isSelected, clearSelection, setSelected]);

  /* live-update dimensions while dragging */
  const onDims = ({
    width,
    height,
  }: {
    width: Dimension;
    height: Dimension;
  }) => {
    const container = containerRef.current;
    if (container) {
      container.style.width = width === "inherit" ? "auto" : `${width}px`;
      container.style.height = height === "inherit" ? "auto" : `${height}px`;
    }
    setDims({ width, height });
  };

  const onResizeEnd = (w: Dimension, h: Dimension) => {
    setTimeout(() => setIsResizing(false), 200);
    editor.update(() => {
      const n = $getNodeByKey(nodeKey) as MermaidNode;
      n.setWidthAndHeight({ width: w, height: h });
    });
  };

  const handleSaveSchema = ({
    schema,
    widthAndHeight,
  }: {
    schema: string;
    widthAndHeight: {
      width: number | "inherit";
      height: number | "inherit";
    };
  }) => {
    editor.update(() => {
      const n = $getNodeByKey(nodeKey) as MermaidNode;
      n.setSchema(schema);
      n.setWidthAndHeight(widthAndHeight);
    });
    setModalOpen(false);
  };

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      setSelection(editorState.read(() => $getSelection()));
    });
  }, [editor]);

  return (
    <>
      <div
        className={cn("relative inline-block", {
          "cursor-move":
            isSelected && !isResizing && $isNodeSelection(selection),
        })}
        draggable={isSelected && !isResizing && $isNodeSelection(selection)}
      >
        <MermaidImage
          schema={schema}
          width={dims.width}
          height={dims.height}
          containerRef={containerRef as RefObject<HTMLDivElement>}
          className={
            isSelected || isResizing ? "ring-1 ring-muted-foreground" : ""
          }
        />

        {/* small “Edit” pill, like the image plugin */}
        <Button
          ref={btnRef}
          variant="ghost"
          className="absolute top-0 right-0 mt-1 mr-1 z-10 bg-muted/60 hover:bg-muted/80 backdrop-blur-xs cursor-pointer"
          onClick={() => setModalOpen(true)}
        >
          Edit
        </Button>

        {(isSelected || isResizing) && (
          <ImageResizer
            editor={editor}
            imageRef={containerRef as RefObject<HTMLDivElement>}
            buttonRef={btnRef as RefObject<HTMLButtonElement>}
            onResizeStart={() => setIsResizing(true)}
            onResizeEnd={onResizeEnd}
            onDimensionsChange={onDims}
            captionsEnabled={false}
            showCaption={false}
            setShowCaption={() => null}
            bottomOffset
          />
        )}
      </div>

      {modalOpen && (
        <MermaidModal
          isOpen
          initialSchema={schema}
          initialWidth={width}
          initialHeight={height}
          onCancel={() => setModalOpen(false)}
          onSave={handleSaveSchema}
        />
      )}
    </>
  );
}

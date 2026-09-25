"use client";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  type BaseSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type NodeKey,
} from "lexical";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { MermaidNode } from "../../nodes/MermaidNode";
import ImageResizer from "~/components/ui/image-resizer";
import MermaidImage from "./MermaidImage";
import { NodeEditButton } from "../common/NodeEditButton";
import MermaidModal from "./MermaidModal";
import { cn } from "~/lib/utils";
import type { NaturalSize } from "@packages/lexical-nodes";
import { useKeepNaturalSize } from "../common/natural-size";
import { type Dimension, FIGURE_FRAME } from "../common/figure-box";

export default function MermaidComponent({
  nodeKey,
  schema,
  width,
  height,
  natural,
}: {
  nodeKey: NodeKey;
  schema: string;
  width: Dimension;
  height: Dimension;
  natural: NaturalSize | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  // Mermaid lays a diagram out with the fonts of the machine drawing it, so
  // each reader's copy measures a little differently; the first measure of a
  // source stands, and editing the source drops it.
  const keepNaturalSize = useKeepNaturalSize(nodeKey, { replace: false });

  /* refs & local state */
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const isEditable = useLexicalEditable();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const isFocused = isEditable && isSelected;
  const [isResizing, setIsResizing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
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

  const onDims = ({
    width,
    height,
  }: {
    width: Dimension;
    height: Dimension;
  }) => {
    editor.update(() => {
      const n = $getNodeByKey(nodeKey) as MermaidNode;
      n.setWidthAndHeight({ width, height });
    });
  };

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      setSelection(editorState.read(() => $getSelection()));
    });
  }, [editor]);

  return (
    <>
      <div
        className={cn(FIGURE_FRAME, {
          "cursor-move":
            isFocused && !isResizing && $isNodeSelection(selection),
        })}
        ref={containerRef}
        draggable={isFocused && !isResizing && $isNodeSelection(selection)}
      >
        <MermaidImage
          schema={schema}
          width={width}
          height={height}
          natural={natural}
          onMeasured={keepNaturalSize}
          className={cn(
            typeof width === "number" && "w-full",
            typeof height === "number" && "h-full",
            isFocused || isResizing ? "ring-1 ring-muted-foreground" : null,
          )}
        />
        {isEditable && (
          <NodeEditButton
            ref={btnRef}
            label="Edit diagram"
            visible={isFocused}
            onClick={() => setModalOpen(true)}
          />
        )}

        {(isFocused || isResizing) && (
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

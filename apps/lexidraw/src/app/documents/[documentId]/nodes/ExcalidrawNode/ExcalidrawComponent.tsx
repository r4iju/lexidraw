import type { ExcalidrawInitialElements } from "./ExcalidrawModal";
import type { NodeKey } from "lexical";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from "lexical";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import ImageResizer from "~/components/ui/image-resizer";
import { ExcalidrawNode } from "./index";
import ExcalidrawImage from "./ExcalidrawImage";
import type { BinaryFiles, AppState } from "@excalidraw/excalidraw/types";
import { NodeEditButton } from "../common/NodeEditButton";
import { cn } from "~/lib/utils";
import ExcalidrawModal from "./ExcalidrawModal";
import type { NaturalSize } from "@packages/lexical-nodes";
import { useKeepNaturalSize } from "../common/natural-size";
import { FIGURE_FRAME } from "../common/figure-box";

export default function ExcalidrawComponent({
  nodeKey,
  data,
  defaultOpen,
  width,
  height,
  natural,
}: {
  data: string;
  nodeKey: NodeKey;
  defaultOpen?: boolean;
  width: number | "inherit";
  height: number | "inherit";
  natural: NaturalSize | undefined;
}): JSX.Element {
  const keepNaturalSize = useKeepNaturalSize(nodeKey);
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [modalRequested, setIsOpen] = useState<boolean>(defaultOpen ?? false);
  const isOpen = isEditable && modalRequested;
  const imageContainerRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const captionButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [key, setKey] = useState(0);

  const onDelete = useCallback(
    (event: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        event.preventDefault();
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (ExcalidrawNode.$isExcalidrawNode(node)) {
            node.remove();
            return true;
          }
        });
      }
      return false;
    },
    [editor, isSelected, nodeKey],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          const frame = frameRef.current;
          const eventTarget = event.target;

          if (isResizing) {
            return true;
          }

          if (frame?.contains(eventTarget as Node)) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            if (event.detail > 1) {
              setIsOpen(true);
            }
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
  }, [clearSelection, editor, isSelected, isResizing, onDelete, setSelected]);

  const deleteNode = useCallback(() => {
    setIsOpen(false);
    return editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (ExcalidrawNode.$isExcalidrawNode(node)) {
        node.remove();
      }
    });
  }, [editor, nodeKey]);

  const setData = (
    els: ExcalidrawInitialElements,
    aps: Partial<AppState>,
    fls: BinaryFiles,
  ) => {
    if (!editor.isEditable()) {
      return;
    }
    return editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (ExcalidrawNode.$isExcalidrawNode(node)) {
        if ((els && els.length > 0) || Object.keys(fls).length > 0) {
          node.setData(
            JSON.stringify({
              appState: aps,
              elements: els,
              files: fls,
            }),
          );
        } else {
          node.remove();
        }
      }
    });
  };

  const onResizeStart = () => {
    setIsResizing(true);
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

      if (ExcalidrawNode.$isExcalidrawNode(node)) {
        node.setWidth(nextWidth);
        node.setHeight(nextHeight);
      }
    });
  };

  // Live-resize handler: update the <img> style directly during drag
  const handleDimensionsChange = useCallback(
    ({
      width,
      height,
    }: {
      width: number | "inherit";
      height: number | "inherit";
    }) => {
      const img = imageContainerRef.current;
      if (img) {
        img.style.width =
          width === "inherit" ? "inherit" : `${Math.round(Number(width))}px`;
        img.style.height =
          height === "inherit" ? "inherit" : `${Math.round(Number(height))}px`;
      }
    },
    [],
  );

  const openModal = useCallback(() => {
    setKey((prev) => prev + 1);
    setIsOpen(true);
  }, []);

  const {
    elements = [],
    files = {},
    appState = {},
  } = useMemo(() => {
    const parsed = JSON.parse(data);
    return parsed;
  }, [data]);

  return (
    <>
      {isOpen && (
        <ExcalidrawModal
          key={key}
          initialElements={elements}
          initialFiles={files}
          initialAppState={appState}
          isShown={isOpen}
          onDelete={deleteNode}
          onClose={() => setIsOpen(false)}
          onSave={(els, aps, fls) => {
            setData(els, aps, fls);
            setIsOpen(false);
          }}
        />
      )}
      {elements.length > 0 && (
        <div
          ref={frameRef}
          className={cn(FIGURE_FRAME, {
            selected: isEditable && isSelected,
          })}
        >
          <ExcalidrawImage
            imageContainerRef={
              imageContainerRef as React.RefObject<HTMLDivElement>
            }
            className={
              (isEditable && isSelected) || isResizing
                ? "ring-1 ring-muted-foreground"
                : undefined
            }
            elements={elements}
            files={files}
            appState={appState}
            width={width}
            height={height}
            natural={natural}
            onMeasured={keepNaturalSize}
          >
            {((isEditable && isSelected) || isResizing) && (
              <ImageResizer
                buttonRef={
                  captionButtonRef as React.RefObject<HTMLButtonElement>
                }
                showCaption={true}
                setShowCaption={() => null}
                imageRef={
                  imageContainerRef as React.RefObject<HTMLImageElement>
                }
                editor={editor}
                onResizeStart={onResizeStart}
                onResizeEnd={onResizeEnd}
                onDimensionsChange={handleDimensionsChange}
                captionsEnabled={true}
              />
            )}
          </ExcalidrawImage>
          {isEditable && (
            <NodeEditButton
              label="Edit drawing"
              visible={isSelected}
              onClick={openModal}
            />
          )}
        </div>
      )}
    </>
  );
}

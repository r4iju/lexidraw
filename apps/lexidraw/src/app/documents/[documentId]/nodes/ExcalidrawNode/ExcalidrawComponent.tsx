import type { ExcalidrawInitialElements } from "./ExcalidrawModal";
import type { NodeKey } from "lexical";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import ImageResizer from "~/components/ui/image-resizer";
import { ExcalidrawNode } from "./index";
import ExcalidrawImage from "./ExcalidrawImage";
import type { BinaryFiles, AppState } from "@excalidraw/excalidraw/types";
import ExcalidrawModal from "./ExcalidrawModal";
import { cn } from "~/lib/utils";

export default function ExcalidrawComponent({
  nodeKey,
  data,
  width,
  height,
}: {
  data: string;
  nodeKey: NodeKey;
  width: number | "inherit";
  height: number | "inherit";
}): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [isModalOpen, setModalOpen] = useState<boolean>(
    data === "[]" && editor.isEditable(),
  );
  const imageContainerRef = useRef<HTMLImageElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const captionButtonRef = useRef<HTMLButtonElement | null>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState<boolean>(false);

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

  // Set editor to readOnly if excalidraw is open to prevent unwanted changes
  useEffect(() => {
    if (isModalOpen) {
      editor.setEditable(false);
    } else {
      editor.setEditable(true);
    }
  }, [isModalOpen, editor]);

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          const buttonElem = buttonRef.current;
          const eventTarget = event.target;

          if (isResizing) {
            return true;
          }

          if (buttonElem !== null && buttonElem.contains(eventTarget as Node)) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            if (event.detail > 1) {
              setModalOpen(true);
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
    setModalOpen(false);
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
    setModalOpen(true);
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
      <ExcalidrawModal
        initialElements={elements}
        initialFiles={files}
        initialAppState={appState}
        isShown={isModalOpen}
        onDelete={deleteNode}
        onClose={() => setModalOpen(false)}
        onSave={(els, aps, fls) => {
          editor.setEditable(true);
          setData(els, aps, fls);
          setModalOpen(false);
        }}
      />
      {elements.length > 0 && (
        <button ref={buttonRef} className={cn("", { selected: isSelected })}>
          <ExcalidrawImage
            imageContainerRef={
              imageContainerRef as React.RefObject<HTMLDivElement>
            }
            className={
              isSelected || isResizing
                ? "ring-1 ring-muted-foreground"
                : undefined
            }
            elements={elements}
            files={files}
            appState={appState}
            width={width}
            height={height}
          >
            {(isSelected || isResizing) && (
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
          {isSelected && (
            <div
              className="image-edit-button"
              role="button"
              tabIndex={0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={openModal}
            />
          )}
        </button>
      )}
    </>
  );
}

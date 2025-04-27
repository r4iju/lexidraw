import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $wrapNodeInElement, CAN_USE_DOM, mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $createRangeSelection,
  $getSelection,
  $insertNodes,
  $isNodeSelection,
  $isRootOrShadowRoot,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DRAGOVER_COMMAND,
  DRAGSTART_COMMAND,
  DROP_COMMAND,
  LexicalEditor,
} from "lexical";
import { useEffect, useRef, useState, useCallback } from "react";
import * as React from "react";
import { ImageNode, ImagePayload } from "../../nodes/ImageNode";
import { Button } from "~/components/ui/button";
import { DialogFooter } from "~/components/ui/dialog";
import FileInput from "~/components/ui/file-input";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { useUploader } from "~/hooks/use-uploader";
import { useEntityId } from "~/hooks/use-entity-id";
import { INSERT_IMAGE_COMMAND } from "./commands";

export type InsertImagePayload = Readonly<ImagePayload>;

const getDOMSelection = (targetWindow: Window | null): Selection | null =>
  CAN_USE_DOM ? (targetWindow || window).getSelection() : null;

export function InsertImageUriDialogBody({
  onClick,
}: {
  onClick: (payload: InsertImagePayload) => void;
}) {
  const [src, setSrc] = useState("");
  const [altText, setAltText] = useState("");

  const isDisabled = src === "";

  return (
    <>
      <Label>Image URL</Label>
      <Input
        placeholder="https://picsum.photos/200/300.jpg"
        onChange={(e) => setSrc(e.target.value)}
        value={src}
        data-test-id="image-modal-url-input"
      />
      <Label>Alt Text</Label>
      <Input
        placeholder="Random unsplash image"
        onChange={(e) => setAltText(e.target.value)}
        value={altText}
        data-test-id="image-modal-alt-text-input"
      />
      <DialogFooter>
        <Button
          data-test-id="image-modal-confirm-btn"
          disabled={isDisabled}
          onClick={() => onClick({ altText, src })}
        >
          Confirm
        </Button>
      </DialogFooter>
    </>
  );
}

export function InsertImageUploadedDialogBody({
  onClick,
}: {
  onClick: (payload: InsertImagePayload) => void;
}) {
  const { src, handleFileChange } = useUploader();
  const entityId = useEntityId();
  const [altText, setAltText] = useState("");

  const isDisabled = src === "";

  const onChange = (files: FileList | null) => {
    handleFileChange(files, entityId);
  };

  useEffect(() => {
    console.log("InsertImageUploadedDialogBody", src);
  }, [src]);

  return (
    <>
      <FileInput
        label="Image Upload"
        onChange={onChange}
        accept="image/*"
        data-test-id="image-modal-file-upload"
      />
      <Label htmlFor="alt-text">Alt Text</Label>
      <Input
        placeholder="Descriptive alternative text"
        onChange={(e) => setAltText(e.target.value)}
        value={altText}
        data-test-id="image-modal-alt-text-input"
      />
      <DialogFooter>
        <Button
          data-test-id="image-modal-file-upload-btn"
          disabled={isDisabled}
          onClick={() => onClick({ altText, src })}
        >
          Confirm
        </Button>
      </DialogFooter>
    </>
  );
}

export function InsertImageDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<null | "url" | "file">(null);
  const hasModifier = useRef(false);

  useEffect(() => {
    hasModifier.current = false;
    const handler = (e: KeyboardEvent) => {
      hasModifier.current = e.altKey;
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, [activeEditor]);

  const onClick = (payload: InsertImagePayload) => {
    activeEditor.dispatchCommand(INSERT_IMAGE_COMMAND, payload);
    onClose();
  };

  return (
    <>
      {!mode && (
        <>
          <Button
            data-test-id="image-modal-option-sample"
            onClick={() =>
              onClick(
                hasModifier.current
                  ? {
                      altText:
                        "Daylight fir trees forest glacier green high ice landscape",
                      src: "/images/landscape.jpg",
                    }
                  : {
                      altText: "Yellow flower in tilt shift lens",
                      src: "/images/yellow-flower.jpg",
                    },
              )
            }
          >
            Sample
          </Button>
          <Button
            data-test-id="image-modal-option-url"
            onClick={() => setMode("url")}
          >
            URL
          </Button>
          <Button
            data-test-id="image-modal-option-file"
            onClick={() => setMode("file")}
          >
            File
          </Button>
        </>
      )}
      {mode === "url" && <InsertImageUriDialogBody onClick={onClick} />}
      {mode === "file" && <InsertImageUploadedDialogBody onClick={onClick} />}
    </>
  );
}

export default function ImagesPlugin({
  captionsEnabled,
}: {
  captionsEnabled?: boolean;
}): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();

  const $getImageNodeInSelection = useCallback((): ImageNode | null => {
    const selection = $getSelection();
    if (!$isNodeSelection(selection)) {
      return null;
    }
    const nodes = selection.getNodes();
    const node = nodes[0];
    return ImageNode.$isImageNode(node) ? node : null;
  }, []);

  const canDropImage = useCallback((event: DragEvent): boolean => {
    const target = event.target;
    return !!(
      target &&
      target instanceof HTMLElement &&
      !target.closest("code, span.editor-image") &&
      target.parentElement &&
      target.parentElement.closest("div.ContentEditable__root")
    );
  }, []);

  const getDragImageData = useCallback(
    (event: DragEvent): null | InsertImagePayload => {
      const dragData = event.dataTransfer?.getData(
        "application/x-lexical-drag",
      );
      if (!dragData) {
        return null;
      }
      const { type, data } = JSON.parse(dragData);
      if (type !== "image") {
        return null;
      }

      return data;
    },
    [],
  );

  const getDragSelection = useCallback(
    (event: DragEvent): Range | null | undefined => {
      let range;
      const target = event.target as null | Element | Document;
      const targetWindow =
        target == null
          ? null
          : target.nodeType === 9
            ? (target as Document).defaultView
            : (target as Element).ownerDocument.defaultView;
      const domSelection = getDOMSelection(targetWindow);
      if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(event.clientX, event.clientY);
      } else if (event.rangeParent && domSelection !== null) {
        domSelection.collapse(event.rangeParent, event.rangeOffset || 0);
        range = domSelection.getRangeAt(0);
      } else {
        throw Error(`Cannot get the selection when dragging`);
      }

      return range;
    },
    [],
  );

  const $onDragStart = useCallback(
    (event: DragEvent): boolean => {
      const node = $getImageNodeInSelection();
      if (!node) {
        return false;
      }
      const dataTransfer = event.dataTransfer;
      if (!dataTransfer) {
        return false;
      }
      dataTransfer.setData("text/plain", "_");
      dataTransfer.setDragImage(img, 0, 0);
      dataTransfer.setData(
        "application/x-lexical-drag",
        JSON.stringify({
          data: {
            altText: node.__altText,
            caption: node.__caption,
            height: node.__height,
            key: node.getKey(),
            maxWidth: node.__maxWidth,
            showCaption: node.__showCaption,
            src: node.__src,
            width: node.__width,
          },
          type: "image",
        }),
      );

      return true;
    },
    [$getImageNodeInSelection],
  );

  const $onDragover = useCallback(
    (event: DragEvent): boolean => {
      const node = $getImageNodeInSelection();
      if (!node) {
        return false;
      }
      if (!canDropImage(event)) {
        event.preventDefault();
      }
      return true;
    },
    [$getImageNodeInSelection, canDropImage],
  );

  const $onDrop = useCallback(
    (event: DragEvent, editor: LexicalEditor): boolean => {
      const node = $getImageNodeInSelection();
      if (!node) {
        return false;
      }
      const data = getDragImageData(event);
      if (!data) {
        return false;
      }
      event.preventDefault();
      if (canDropImage(event)) {
        const range = getDragSelection(event);
        node.remove();
        const rangeSelection = $createRangeSelection();
        if (range !== null && range !== undefined) {
          rangeSelection.applyDOMRange(range);
        }
        $setSelection(rangeSelection);
        editor.dispatchCommand(INSERT_IMAGE_COMMAND, data);
      }
      return true;
    },
    [
      $getImageNodeInSelection,
      canDropImage,
      getDragImageData,
      getDragSelection,
    ],
  );

  useEffect(() => {
    if (!editor.hasNodes([ImageNode])) {
      throw new Error("ImagesPlugin: ImageNode not registered on editor");
    }

    return mergeRegister(
      editor.registerCommand<InsertImagePayload>(
        INSERT_IMAGE_COMMAND,
        (payload) => {
          const imageNode = ImageNode.$createImageNode(payload);
          $insertNodes([imageNode]);
          if ($isRootOrShadowRoot(imageNode.getParentOrThrow())) {
            $wrapNodeInElement(imageNode, $createParagraphNode).selectEnd();
          }

          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand<DragEvent>(
        DRAGSTART_COMMAND,
        (event) => {
          return $onDragStart(event);
        },
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand<DragEvent>(
        DRAGOVER_COMMAND,
        (event) => {
          return $onDragover(event);
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand<DragEvent>(
        DROP_COMMAND,
        (event) => {
          return $onDrop(event, editor);
        },
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [$onDragStart, $onDragover, $onDrop, captionsEnabled, editor]);

  return null;
}

const TRANSPARENT_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const img = document.createElement("img");
img.src = TRANSPARENT_IMAGE;

declare global {
  interface DragEvent {
    rangeOffset?: number;
    rangeParent?: Node;
  }
}

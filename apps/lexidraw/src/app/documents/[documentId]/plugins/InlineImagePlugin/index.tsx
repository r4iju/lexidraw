import type { Position } from "../../nodes/InlineImageNode/InlineImageNode";

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
  createCommand,
  DRAGOVER_COMMAND,
  DRAGSTART_COMMAND,
  DROP_COMMAND,
  LexicalCommand,
  LexicalEditor,
} from "lexical";
import * as React from "react";
import { useEffect, useRef, useState, useCallback } from "react";

import {
  InlineImageNode,
  InlineImagePayload,
} from "../../nodes/InlineImageNode/InlineImageNode";
import { DialogFooter } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import FileInput from "~/components/ui/file-input";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectValue,
  SelectTrigger,
} from "~/components/ui/select";
import { useUploader } from "~/hooks/use-uploader";
import { useEntityId } from "~/hooks/use-entity-id";
import { Switch } from "~/components/ui/switch";
import { SwitchThumb } from "@radix-ui/react-switch";

export type InsertInlineImagePayload = Readonly<InlineImagePayload>;

const getDOMSelection = (targetWindow: Window | null): Selection | null =>
  CAN_USE_DOM ? (targetWindow || window).getSelection() : null;

export const INSERT_INLINE_IMAGE_COMMAND: LexicalCommand<InlineImagePayload> =
  createCommand("INSERT_INLINE_IMAGE_COMMAND");

export function InsertInlineImageDialog({
  activeEditor,
  onClose,
}: {
  activeEditor: LexicalEditor;
  onClose: () => void;
}): React.JSX.Element {
  const hasModifier = useRef(false);
  const entityId = useEntityId();
  const { src, handleFileChange } = useUploader();
  const [altText, setAltText] = useState("");
  const [showCaption, setShowCaption] = useState(false);
  const [position, setPosition] = useState<Position>("left");

  const isDisabled = src === "";

  const onChange = (files: FileList | null) => {
    handleFileChange(files, entityId);
  };

  useEffect(() => {
    console.log("InsertInlineImageDialog", src);
  }, [src]);

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

  const handleOnClick = () => {
    const payload = { altText, position, showCaption, src };
    activeEditor.dispatchCommand(INSERT_INLINE_IMAGE_COMMAND, payload);
    console.log("InsertInlineImageDialog handleOnClick", payload);
    onClose();
  };

  return (
    <>
      <div className="">
        <FileInput
          label="Image Upload"
          onChange={onChange}
          accept="image/*"
          data-test-id="image-modal-file-upload"
        />
      </div>
      <div style={{ marginBottom: "1em" }}>
        <Label htmlFor="alt-text">Alt Text</Label>
        <Input
          placeholder="Descriptive alternative text"
          onChange={(e) => setAltText(e.target.value)}
          value={altText}
        />
      </div>

      <Select
        name="position"
        onValueChange={(val) => setPosition(val as Position)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Position" className="mb-1 w-[290px]">
            {position}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="right">Right</SelectItem>
            <SelectItem value="full">Full Width</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Label htmlFor="caption">Show Caption</Label>
        <Switch
          id="caption"
          checked={showCaption}
          onCheckedChange={setShowCaption}
        >
          <SwitchThumb />
        </Switch>
      </div>

      <DialogFooter className="justify-end">
        <Button
          data-test-id="image-modal-file-upload-btn"
          disabled={isDisabled}
          onClick={() => handleOnClick()}
        >
          Confirm
        </Button>
      </DialogFooter>
    </>
  );
}

export default function InlineImagePlugin(): React.JSX.Element | null {
  const [editor] = useLexicalComposerContext();

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
        throw Error("Cannot get the selection when dragging");
      }

      return range;
    },
    [],
  );

  const $getImageNodeInSelection = useCallback((): InlineImageNode | null => {
    const selection = $getSelection();
    if (!$isNodeSelection(selection)) {
      return null;
    }
    const nodes = selection.getNodes();
    const node = nodes[0];
    return InlineImageNode.$isInlineImageNode(node) ? node : null;
  }, []);

  const getDragImageData = useCallback(
    (event: DragEvent): null | InsertInlineImagePayload => {
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
        editor.dispatchCommand(INSERT_INLINE_IMAGE_COMMAND, data);
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
    if (!editor.hasNodes([InlineImageNode])) {
      throw new Error("ImagesPlugin: ImageNode not registered on editor");
    }

    return mergeRegister(
      editor.registerCommand<InsertInlineImagePayload>(
        INSERT_INLINE_IMAGE_COMMAND,
        (payload) => {
          const imageNode = InlineImageNode.$createInlineImageNode(payload);
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
  }, [$onDragStart, $onDragover, $onDrop, editor]);

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

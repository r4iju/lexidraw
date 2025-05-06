import * as React from "react";
import { useState } from "react";
import { LexicalEditor, NodeKey, $getNodeByKey } from "lexical";
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { SwitchThumb } from "@radix-ui/react-switch";
import { ImageNode, UpdateImagePayload } from "./ImageNode"; // Import ImageNode and its payload type

export function UpdateImageDialog({
  activeEditor,
  nodeKey,
  onClose,
}: {
  activeEditor: LexicalEditor;
  nodeKey: NodeKey;
  onClose: () => void;
}): React.JSX.Element {
  const editorState = activeEditor.getEditorState();
  // Read as ImageNode
  const node = editorState.read(() => $getNodeByKey(nodeKey) as ImageNode);
  const [altText, setAltText] = useState(node.getAltText());
  const [showCaption, setShowCaption] = useState(node.getShowCaption());
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
    const payload = {
      altText,
      showCaption,
      width: toWidthOrHeight(widthAndHeight.width),
      height: toWidthOrHeight(widthAndHeight.height),
    } satisfies UpdateImagePayload;
    if (node) {
      activeEditor.update(() => {
        // Check if it's an ImageNode before updating
        if (ImageNode.$isImageNode(node)) {
          node.update(payload);
        }
      });
    }
    onClose();
  };

  return (
    <DialogContent className="min-w-72">
      <DialogHeader>
        {/* Update Title */}
        <DialogTitle>Update Image</DialogTitle>
      </DialogHeader>
      <div style={{ marginBottom: "1em" }}>
        <Label htmlFor="alt-text">Alt Text</Label>
        <Input
          id="alt-text"
          placeholder="Descriptive alternative text"
          onChange={handleAltTextChange}
          value={altText}
          data-testid="image-modal-alt-text-input"
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

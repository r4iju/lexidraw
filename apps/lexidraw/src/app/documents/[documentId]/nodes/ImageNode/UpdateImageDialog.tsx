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

  const handleAltTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAltText(e.target.value);
  };

  const handleOnConfirm = () => {
    // Create payload without position
    const payload: UpdateImagePayload = { altText, showCaption };
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
    <DialogContent>
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
        />
      </div>

      {/* Remove Position Select */}

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

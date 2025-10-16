import type * as React from "react";
import { useState, useEffect, useId } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Button } from "~/components/ui/button";

interface VideoEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialWidth: "inherit" | number;
  initialHeight: "inherit" | number;
  initialShowCaption: boolean;
  onApplyChanges: (newProps: {
    width: "inherit" | number;
    height: "inherit" | number;
    showCaption: boolean;
  }) => void;
}

export default function VideoEditModal({
  isOpen,
  onClose,
  initialWidth,
  initialHeight,
  initialShowCaption,
  onApplyChanges,
}: VideoEditModalProps): React.JSX.Element {
  const [width, setWidth] = useState<string>("");
  const [height, setHeight] = useState<string>("");
  const [showCaption, setShowCaption] = useState(initialShowCaption);

  const widthInputId = useId();
  const heightInputId = useId();
  const showCaptionSwitchId = useId();

  useEffect(() => {
    setWidth(initialWidth === "inherit" ? "" : String(initialWidth));
    setHeight(initialHeight === "inherit" ? "" : String(initialHeight));
    setShowCaption(initialShowCaption);
  }, [initialWidth, initialHeight, initialShowCaption]);

  const handleApply = () => {
    const newWidth = width === "" ? "inherit" : parseInt(width, 10);
    const newHeight = height === "" ? "inherit" : parseInt(height, 10);

    if (
      (typeof newWidth === "number" && Number.isNaN(newWidth)) ||
      (typeof newHeight === "number" && Number.isNaN(newHeight))
    ) {
      // Basic validation, could be more sophisticated
      alert(
        "Please enter valid numbers for width and height, or leave blank for 'inherit'.",
      );
      return;
    }

    onApplyChanges({
      width: newWidth,
      height: newHeight,
      showCaption,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full">
        <DialogHeader>
          <DialogTitle>Edit Video Properties</DialogTitle>
          <DialogDescription>
            Adjust the video dimensions and caption visibility. Leave width or
            height blank to inherit.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 py-4 w-full">
          <div className="flex justify-start flex-col gap-2">
            <Label htmlFor={widthInputId}>Width</Label>
            <Input
              id={widthInputId}
              type="number"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              placeholder="auto"
            />
          </div>
          <div className="flex justify-start flex-col gap-2">
            <Label htmlFor={heightInputId}>Height</Label>
            <Input
              id={heightInputId}
              type="number"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="auto"
            />
          </div>
          <div className="flex items-center gap-x-4 justify-start col-span-2">
            <Label htmlFor={showCaptionSwitchId}>Show Caption</Label>
            <Switch
              id={showCaptionSwitchId}
              checked={showCaption}
              onCheckedChange={setShowCaption}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

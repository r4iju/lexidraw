import type React from "react";
import { useState, useEffect, useCallback } from "react";
import type { LexicalEditor, NodeKey } from "lexical";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import SlideDeckEditorComponent from "./SlideDeckEditor";
import type { SlideDeckData } from "./SlideNode";
import { useMetadataModal } from "./MetadataModalContext";
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/ui/tooltip";

interface SlideModalProps {
  nodeKey: NodeKey;
  initialData: SlideDeckData;
  editor: LexicalEditor;
  onSave: (data: SlideDeckData) => void;
  onOpenChange: (open: boolean) => void;
  isOpen: boolean;
}

export const SlideModal: React.FC<SlideModalProps> = ({
  nodeKey,
  initialData,
  editor,
  onSave,
  onOpenChange,
  isOpen,
}) => {
  const [currentDeckData, setCurrentDeckData] = useState<SlideDeckData | null>(
    null,
  );
  const [deckDataString, setDeckDataString] =
    useState<SlideDeckData>(initialData);

  const { openModal: openMetadataModalFromHook } = useMetadataModal();

  useEffect(() => {
    if (isOpen) {
      setDeckDataString(initialData);
      try {
        setCurrentDeckData(initialData);
      } catch (e) {
        console.error(
          "[SlideModal] Failed to parse initialData in useEffect",
          e,
        );
        setCurrentDeckData(null);
      }
    }
  }, [initialData, isOpen]);

  const handleDeckDataChange = useCallback((newDeckData: SlideDeckData) => {
    setCurrentDeckData(newDeckData);
    setDeckDataString(newDeckData);
  }, []);

  const handleSave = () => {
    onSave(deckDataString);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>Edit Slide Deck</DialogTitle>
        </DialogHeader>
        <div className="flex-grow overflow-y-auto px-6 pb-2 min-h-0">
          <SlideDeckEditorComponent
            initialData={deckDataString}
            onDeckDataChange={handleDeckDataChange}
            parentEditor={editor}
            nodeKey={nodeKey}
          />
        </div>
        <DialogFooter className="p-6 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
            </DialogClose>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() =>
                      openMetadataModalFromHook(
                        currentDeckData?.deckMetadata,
                        null,
                      )
                    }
                    variant="outline"
                    size="icon"
                  >
                    <InfoIcon className="size-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Deck Metadata</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!currentDeckData}
          >
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

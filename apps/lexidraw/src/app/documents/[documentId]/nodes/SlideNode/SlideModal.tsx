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

  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="flex flex-col">
        <DialogHeader>
          <DialogTitle>Edit Slide Deck</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <SlideDeckEditorComponent
            initialData={deckDataString}
            onDeckDataChange={handleDeckDataChange}
            parentEditor={editor}
            nodeKey={nodeKey}
          />
        </div>
        <DialogFooter>
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
                  className="max-sm:self-start sm:mr-auto"
                >
                  <InfoIcon className="size-5" />
                  <span className="sr-only">Deck metadata</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Deck Metadata</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!currentDeckData}
          >
            Save deck
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

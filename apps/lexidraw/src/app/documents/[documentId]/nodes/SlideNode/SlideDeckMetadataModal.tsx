"use client";
import { useEffect, useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import { cn } from "~/lib/utils";
import type {
  DeckStrategicMetadata,
  SlideStrategicMetadata,
} from "./SlideNode";
import { useMetadataModal } from "./MetadataModalContext";
import { Ubuntu_Mono } from "next/font/google";

interface SlideDeckMetadataModalProps {
  onSave: ({
    updatedMeta,
    currentSlideId,
  }: {
    updatedMeta: DeckStrategicMetadata | SlideStrategicMetadata | undefined;
    currentSlideId: string | null;
  }) => void;
}

const mono = Ubuntu_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
});

export default function SlideDeckMetadataModal({
  onSave,
}: SlideDeckMetadataModalProps) {
  const {
    isModalOpen,
    initialData,
    slideId: currentSlideIdForSave,
    closeModal,
  } = useMetadataModal();

  const [editableMetaJson, setEditableMetaJson] = useState("");
  const [metaError, setMetaError] = useState<string | null>(null);

  useEffect(() => {
    if (isModalOpen && initialData) {
      try {
        setEditableMetaJson(JSON.stringify(initialData || {}, null, 2));
        setMetaError(null);
      } catch {
        setEditableMetaJson("Error loading metadata");
        setMetaError("Failed to stringify initial metadata.");
      }
    } else if (!isModalOpen) {
      setEditableMetaJson(""); // clear when modal closes
      setMetaError(null);
    }
  }, [initialData, isModalOpen]);

  const handleSave = () => {
    let parsedMeta: DeckStrategicMetadata | SlideStrategicMetadata | undefined;
    let currentMetaError: string | null = null;

    try {
      if (editableMetaJson.trim()) {
        parsedMeta = JSON.parse(editableMetaJson) as
          | DeckStrategicMetadata
          | SlideStrategicMetadata;
      }
      setMetaError(null);
    } catch (e) {
      currentMetaError =
        e instanceof Error ? e.message : "Invalid JSON for metadata.";
      setMetaError(currentMetaError);
    }

    if (!currentMetaError) {
      onSave({
        updatedMeta: parsedMeta,
        currentSlideId: currentSlideIdForSave,
      });
      closeModal();
    }
  };

  const metadataTextareaId = useId();

  if (!isModalOpen) return null;

  const isDeckMetadata = currentSlideIdForSave === null;
  const title = isDeckMetadata
    ? "Deck Metadata"
    : "Current Slide Page Metadata";
  const description = isDeckMetadata
    ? "View and edit the JSON metadata for the entire deck."
    : "View and edit the JSON metadata for the currently active slide page.";

  return (
    <Dialog open={isModalOpen} onOpenChange={(open) => !open && closeModal()}>
      <DialogOverlay />
      <DialogContent className="max-w-[60dvw] w-full h-[75dvh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description} Be careful, invalid JSON will prevent saving.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-2 overflow-y-auto p-6 pt-2">
          <Label htmlFor="metadataTextarea" className="text-sm">
            Edit JSON
          </Label>
          <Textarea
            id={metadataTextareaId}
            value={editableMetaJson}
            onChange={(e) => {
              setEditableMetaJson(e.target.value);
              setMetaError(null);
            }}
            placeholder="{...}"
            className={cn(
              "resize-none flex-1 font-mono text-sm min-h-[200px]",
              metaError && "border-destructive focus-visible:ring-destructive",
              mono.className,
            )}
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />
          {metaError && <p className="text-xs text-destructive">{metaError}</p>}
        </div>

        <DialogFooter className="p-6 pt-4 border-t border-border">
          <Button variant="outline" onClick={closeModal}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!metaError}>
            Save Metadata
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";
import { useEffect, useId, useState } from "react";
import {
  Dialog,
  DialogContent,
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
import { mono } from "~/lib/fonts";

interface SlideDeckMetadataModalProps {
  onSave: ({
    updatedMeta,
    currentSlideId,
  }: {
    updatedMeta: DeckStrategicMetadata | SlideStrategicMetadata | undefined;
    currentSlideId: string | null;
  }) => void;
}

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
      <DialogContent size="lg" className="flex flex-col sm:h-[75dvh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description} Be careful, invalid JSON will prevent saving.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <Label htmlFor={metadataTextareaId} className="text-sm">
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

        <DialogFooter>
          <Button variant="ghost" onClick={closeModal}>
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

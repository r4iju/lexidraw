"use client";

import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  FileId,
} from "@excalidraw/excalidraw/element/types";
import type {
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { drawingFileStore, SceneFiles } from "./scene-files";

/**
 * Keeps an open drawing's images in step with its file store; see
 * `scene-files.ts`. Answers what Excalidraw's `onChange` has to be given.
 */
export function useSceneFiles(
  excalidraw: ExcalidrawImperativeAPI | null,
  drawingId: string,
  { canUpload }: { canUpload: boolean },
): (elements: readonly ExcalidrawElement[], files: BinaryFiles) => void {
  const utils = api.useUtils();
  const files = useRef<SceneFiles | null>(null);

  // External systems: the drawing's file store and the Excalidraw scene.
  useEffect(() => {
    if (!excalidraw) return;
    const scene = new SceneFiles(
      drawingFileStore(utils.client.drawings, drawingId),
      {
        addFiles: (added) => excalidraw.addFiles(added),
        settle: (statuses) => {
          const status = new Map(statuses);
          updateImages(excalidraw, (image) => {
            const next = status.get(image.fileId);
            return next && image.status !== next ? { status: next } : null;
          });
        },
        rekey: (from, to) =>
          updateImages(excalidraw, (image) =>
            image.fileId === from ? { fileId: to } : null,
          ),
        failed: (_, reason) =>
          toast.error("An image in this drawing wasn’t saved", {
            description: reason,
          }),
      },
      { canUpload },
    );
    files.current = scene;
    scene.changed(
      excalidraw.getSceneElementsIncludingDeleted(),
      excalidraw.getFiles(),
    );
    void scene.open();
    return () => {
      scene.close();
      if (files.current === scene) files.current = null;
    };
  }, [excalidraw, drawingId, canUpload, utils]);

  return useCallback((elements, sceneFiles) => {
    files.current?.changed(elements, sceneFiles);
  }, []);
}

/**
 * Changes the image elements `change` answers a change for, as bookkeeping
 * rather than an edit, so undo passes over it.
 */
function updateImages(
  excalidraw: ExcalidrawImperativeAPI,
  change: (
    image: ExcalidrawImageElement & { fileId: FileId },
  ) => { status?: ExcalidrawImageElement["status"]; fileId?: FileId } | null,
): void {
  excalidraw.updateScene({
    elements: excalidraw.getSceneElementsIncludingDeleted().map((element) => {
      if (element.type !== "image" || !element.fileId) return element;
      const changed = change({ ...element, fileId: element.fileId });
      return changed ? newElementWith(element, changed) : element;
    }),
    captureUpdate: CaptureUpdateAction.NEVER,
  });
}

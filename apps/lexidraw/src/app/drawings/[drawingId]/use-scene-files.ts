"use client";

import {
  CaptureUpdateAction,
  getDataURL,
  newElementWith,
} from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { FileRefused, SceneFiles } from "./scene-files";

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
      {
        list: async () =>
          (await utils.client.drawings.files.query({ id: drawingId })).files,
        fetch: async (stored) => {
          const response = await fetch(stored.url);
          if (!response.ok) throw new Error(`${response.status}`);
          return {
            id: stored.id,
            mimeType: stored.mimeType,
            dataURL: await getDataURL(await response.blob()),
            created: stored.created,
          } as BinaryFileData;
        },
        upload: async (file) => {
          try {
            await utils.client.drawings.putFile.mutate(
              {
                id: drawingId,
                fileId: file.id,
                mimeType: file.mimeType,
                dataURL: file.dataURL,
              },
              { context: { skipBatch: true } },
            );
          } catch (error) {
            if (
              error instanceof TRPCClientError &&
              error.data?.code === "BAD_REQUEST"
            ) {
              throw new FileRefused(error.message);
            }
            throw error;
          }
        },
      },
      {
        addFiles: (added) => excalidraw.addFiles(added),
        settle: (statuses) => {
          const status = new Map(statuses);
          excalidraw.updateScene({
            elements: excalidraw
              .getSceneElementsIncludingDeleted()
              .map((element) => {
                const next =
                  element.type === "image" && element.fileId
                    ? status.get(element.fileId)
                    : undefined;
                return next &&
                  element.type === "image" &&
                  element.status !== next
                  ? newElementWith(element, { status: next })
                  : element;
              }),
            // Bookkeeping rather than an edit, so undo passes over it.
            captureUpdate: CaptureUpdateAction.NEVER,
          });
        },
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

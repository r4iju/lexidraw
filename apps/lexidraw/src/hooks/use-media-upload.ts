import { put } from "@vercel/blob/client";
import { useCallback } from "react";
import { IMAGE, type Upload, uploadMedia, VIDEO } from "~/lib/media-upload";
import { api } from "~/trpc/react";

/** Uploads images into `entityId`'s storage; see `uploadMedia`. */
export function useImageUpload(entityId: string): Upload {
  const { mutateAsync: sign } = api.entities.generateUploadUrl.useMutation();
  return useCallback(
    (file, onProgress) =>
      uploadMedia(file, IMAGE, {
        sign: (contentType) => sign({ entityId, contentType, mode: "direct" }),
        send: put,
        onProgress,
      }),
    [entityId, sign],
  );
}

/** Uploads videos into `entityId`'s storage; see `uploadMedia`. */
export function useVideoUpload(entityId: string): Upload {
  const { mutateAsync: sign } =
    api.entities.generateVideoUploadUrl.useMutation();
  return useCallback(
    (file, onProgress) =>
      uploadMedia(file, VIDEO, {
        sign: (contentType) => sign({ entityId, contentType, mode: "direct" }),
        send: put,
        onProgress,
      }),
    [entityId, sign],
  );
}

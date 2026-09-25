import { put } from "@vercel/blob/client";
import { useCallback } from "react";
import { type UploadImage, uploadImage } from "~/lib/image-upload";
import { api } from "~/trpc/react";

/** Uploads images into `entityId`'s storage; see `uploadImage`. */
export function useImageUpload(entityId: string): UploadImage {
  const { mutateAsync: signUpload } =
    api.entities.generateUploadUrl.useMutation();
  return useCallback(
    (file, onProgress) =>
      uploadImage(file, {
        sign: (contentType) =>
          signUpload({ entityId, contentType, mode: "direct" }),
        send: put,
        onProgress,
      }),
    [entityId, signUpload],
  );
}

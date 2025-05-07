// upload file hook

import { useState } from "react";
import { api } from "~/trpc/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { AppRouter } from "~/server/api/root"; // Assuming AppRouter is available

export const useUploader = () => {
  const [src, setSrc] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const { mutate: generateImageUrl } =
    api.entities.generateUploadUrl.useMutation();
  const { mutate: generateVideoUrl } =
    api.entities.generateVideoUploadUrl.useMutation();

  const allowedImageTypes = [
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "image/webp",
    "image/avif",
  ] as const;
  const allowedVideoTypes = ["video/mp4", "video/webm", "video/ogg"] as const;

  type AllowedImageType = (typeof allowedImageTypes)[number];
  type AllowedVideoType = (typeof allowedVideoTypes)[number];

  const handleFileChange = (
    files: FileList | null,
    entityId: string,
    type: "image" | "video" = "image",
  ) => {
    if (files && files.length > 0 && files[0]) {
      const file = files[0];
      const currentAllowedTypes =
        type === "image" ? allowedImageTypes : allowedVideoTypes;
      const maxSize = type === "image" ? 1024 * 1024 : 10 * 1024 * 1024; // 1MB for images, 10MB for videos
      const sizeErrorMsg =
        type === "image"
          ? "File size should be less than 1MB"
          : "File size should be less than 10MB";
      const typeErrorMsg =
        type === "image"
          ? "File type should be an allowed image format."
          : "File type should be video/mp4, video/webm, or video/ogg.";

      if (file.size > maxSize) {
        setError(sizeErrorMsg);
      } else if (
        !(currentAllowedTypes as readonly string[]).includes(file.type)
      ) {
        setError(typeErrorMsg);
      } else {
        setError(null);
        const commonOptions = {
          onSuccess: async (res: {
            signedUploadUrl: string;
            signedDownloadUrl: string;
          }) => {
            await fetch(res.signedUploadUrl, {
              method: "PUT",
              body: file,
            });
            setSrc(res.signedDownloadUrl);
            console.log("res.signedDownloadUrl", res.signedDownloadUrl);
          },
          onError: (err: TRPCClientErrorLike<AppRouter>) => {
            console.error(`Error generating ${type} upload URL:`, err.message);
            setError(
              `Could not get an upload URL for the ${type}. ${err.message}`,
            );
          },
        };

        if (type === "image") {
          generateImageUrl(
            {
              entityId,
              contentType: file.type as AllowedImageType,
              mode: "direct",
            },
            commonOptions,
          );
        } else if (type === "video") {
          generateVideoUrl(
            {
              entityId,
              contentType: file.type as AllowedVideoType,
              mode: "direct",
            },
            commonOptions,
          );
        }
      }
    }
  };

  return { src, error, handleFileChange };
};

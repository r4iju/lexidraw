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

  const configs = [
    {
      maxSize: 10 * 1024 * 1024,
      sizeErrorMsg: "File size should be less than 10MB",
      typeErrorMsg: "File type should be an allowed image format.",
      allowedTypes: allowedImageTypes,
      type: "image",
    },
    {
      maxSize: 100 * 1024 * 1024,
      sizeErrorMsg: "File size should be less than 100MB",
      typeErrorMsg: "File type should be video/mp4, video/webm, or video/ogg.",
      allowedTypes: allowedVideoTypes,
      type: "video",
    },
  ] as const;

  type AllowedImageType = (typeof allowedImageTypes)[number];
  type AllowedVideoType = (typeof allowedVideoTypes)[number];

  const handleFileChange = (
    files: FileList | null,
    entityId: string,
    type: "image" | "video" = "image",
  ) => {
    if (files && files.length > 0 && files[0]) {
      const file = files[0];
      const currentConfig = configs.find((config) => config.type === type);
      if (!currentConfig) {
        setError("Invalid file type");
        return;
      }
      const { allowedTypes, maxSize, sizeErrorMsg, typeErrorMsg } =
        currentConfig;
      if (file.size > maxSize) {
        setError(sizeErrorMsg);
        return;
      }
      // @ts-expect-error - file.type is a string
      if (!allowedTypes.includes(file.type)) {
        setError(typeErrorMsg);
        return;
      }
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
  };

  return { src, error, handleFileChange };
};

import type { TRPCClientErrorLike } from "@trpc/client";
import { put } from "@vercel/blob/client";
import { useState } from "react";
import type { AppRouter } from "~/server/api/root";
import { api } from "~/trpc/react";

const VIDEO_TYPES = ["video/mp4", "video/webm", "video/ogg"] as const;
type VideoType = (typeof VIDEO_TYPES)[number];
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const isVideoType = (type: string): type is VideoType =>
  (VIDEO_TYPES as readonly string[]).includes(type);

/** Uploads a video into a document's storage; images go through `useImageUpload`. */
export const useVideoUpload = () => {
  const [src, setSrc] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const { mutate: generateVideoUrl } =
    api.entities.generateVideoUploadUrl.useMutation();

  const handleFileChange = (files: FileList | null, entityId: string) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_VIDEO_BYTES) {
      setError("File size should be less than 100MB");
      return;
    }
    const contentType = file.type;
    if (!isVideoType(contentType)) {
      setError("File type should be video/mp4, video/webm, or video/ogg.");
      return;
    }
    setError(null);
    generateVideoUrl(
      { entityId, contentType, mode: "direct" },
      {
        onSuccess: async (res: { token: string; pathname: string }) => {
          const { url } = await put(res.pathname, file, {
            access: "public",
            multipart: true,
            contentType,
            token: res.token,
          });
          setSrc(url);
        },
        onError: (err: TRPCClientErrorLike<AppRouter>) => {
          console.error("Error generating video upload URL:", err.message);
          setError(`Could not get an upload URL for the video. ${err.message}`);
        },
      },
    );
  };

  return { src, error, handleFileChange };
};

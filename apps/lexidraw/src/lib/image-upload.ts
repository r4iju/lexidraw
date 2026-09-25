import { toast } from "sonner";

/** The images a document may carry, as the upload address is signed for. */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
  "image/avif",
] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const isImageType = (type: string): type is ImageType =>
  (IMAGE_TYPES as readonly string[]).includes(type);

/**
 * Uploads an image and answers its address, or null once the reason it could
 * not be has been shown. `onProgress` hears the percentage sent so far.
 */
export type UploadImage = (
  file: File,
  onProgress?: (percentage: number) => void,
) => Promise<string | null>;

type Upload = {
  /** Signs an upload of this type into the document's storage. */
  sign: (
    contentType: ImageType,
  ) => Promise<{ token: string; pathname: string }>;
  /** Sends the file, as `put` from `@vercel/blob/client` does. */
  send: (
    pathname: string,
    file: File,
    options: {
      access: "public";
      multipart: boolean;
      contentType: string;
      token: string;
      onUploadProgress?: (event: { percentage: number }) => void;
    },
  ) => Promise<{ url: string }>;
  onProgress?: (percentage: number) => void;
};

/**
 * The one way an image reaches storage, from the image dialogs, a paste or
 * drop into the document, and the cover: refused here, before anything is
 * sent, when it is not an image a document takes or is too large.
 */
export async function uploadImage(
  file: File,
  { sign, send, onProgress }: Upload,
): Promise<string | null> {
  const contentType = file.type;
  if (!isImageType(contentType)) {
    toast.error("Unsupported image type", {
      description: "Allowed: PNG, JPEG, SVG, WEBP, AVIF.",
    });
    return null;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error("Image too large", { description: "Max size is 10MB." });
    return null;
  }
  try {
    const { token, pathname } = await sign(contentType);
    const { url } = await send(pathname, file, {
      access: "public",
      multipart: true,
      contentType,
      token,
      onUploadProgress: onProgress
        ? ({ percentage }) => onProgress(Math.round(percentage))
        : undefined,
    });
    return url;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown upload error";
    toast.error("Image Upload Failed", { description: message });
    console.error(err);
    return null;
  }
}

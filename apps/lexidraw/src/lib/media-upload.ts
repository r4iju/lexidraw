import { toast } from "sonner";

/**
 * What a document may carry of one kind, as its upload is signed for: the
 * types, the largest size, and how a refusal names them.
 */
type MediaKind<Type extends string> = {
  noun: "Image" | "Video";
  types: readonly Type[];
  maxBytes: number;
  allowed: string;
  max: string;
};

export const IMAGE = {
  noun: "Image",
  types: [
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "image/webp",
    "image/avif",
  ],
  maxBytes: 10 * 1024 * 1024,
  allowed: "PNG, JPEG, SVG, WEBP, AVIF",
  max: "10MB",
} as const satisfies MediaKind<string>;

export const VIDEO = {
  noun: "Video",
  types: ["video/mp4", "video/webm", "video/ogg"],
  maxBytes: 100 * 1024 * 1024,
  allowed: "MP4, WEBM, OGG",
  max: "100MB",
} as const satisfies MediaKind<string>;

/**
 * Uploads a file and answers its address, or null once the reason it could
 * not be has been shown. `onProgress` hears the percentage sent so far.
 */
export type Upload = (
  file: File,
  onProgress?: (percentage: number) => void,
) => Promise<string | null>;

type Transport<Type extends string> = {
  /** Signs an upload of this type into the document's storage. */
  sign: (contentType: Type) => Promise<{ token: string; pathname: string }>;
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
 * The one way a file reaches a document's storage: images from the image
 * dialogs, a paste or drop, the cover and image generation, and videos from
 * the video dialog. It is refused before anything is sent when it is not of
 * a type `kind` takes, or is too large; any failure after is shown too.
 */
export async function uploadMedia<Type extends string>(
  file: File,
  kind: MediaKind<Type>,
  { sign, send, onProgress }: Transport<Type>,
): Promise<string | null> {
  const contentType = kind.types.find((type) => type === file.type);
  if (!contentType) {
    toast.error(`Unsupported ${kind.noun.toLowerCase()} type`, {
      description: `Allowed: ${kind.allowed}.`,
    });
    return null;
  }
  if (file.size > kind.maxBytes) {
    toast.error(`${kind.noun} too large`, {
      description: `Max size is ${kind.max}.`,
    });
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
    toast.error(`${kind.noun} Upload Failed`, { description: message });
    console.error(err);
    return null;
  }
}

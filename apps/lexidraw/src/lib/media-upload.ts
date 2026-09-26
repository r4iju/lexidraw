import { toast } from "sonner";
import { IMAGE, type MediaKind } from "./media-kinds";

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

/** Why `kind` does not take `file`, as a toast says it, or null when it does. */
function refusal<Type extends string>(file: File, kind: MediaKind<Type>) {
  if (!kind.types.some((type) => type === file.type)) {
    return {
      title: `Unsupported ${kind.noun.toLowerCase()} type`,
      description: `Allowed: ${kind.allowed}.`,
    };
  }
  if (file.size > kind.maxBytes) {
    return {
      title: `${kind.noun} too large`,
      description: `Max size is ${kind.max}.`,
    };
  }
  return null;
}

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
  const refused = refusal(file, kind);
  const contentType = kind.types.find((type) => type === file.type);
  if (refused || !contentType) {
    if (refused)
      toast.error(refused.title, { description: refused.description });
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

/**
 * Uploads each dropped or pasted image and hands `insert` the address of
 * each one that arrived, then says how many went in. One that did not has
 * already said why, so it is not counted as inserted.
 */
export async function insertUploads(
  files: File[],
  upload: Upload,
  insert: (url: string, file: File) => void,
): Promise<void> {
  let inserted = 0;
  for (const file of files) {
    const url = await upload(file);
    if (!url) continue;
    try {
      insert(url, file);
      inserted++;
    } catch (err) {
      toast.error("Image not inserted", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }
  if (inserted === 0) return;
  toast.success(
    inserted < files.length
      ? `Inserted ${inserted} of ${files.length} images`
      : inserted === 1
        ? "Image inserted"
        : `Inserted ${inserted} images`,
  );
}

const IMAGE_EXTENSIONS: Record<(typeof IMAGE.types)[number], string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/avif": "avif",
};

/**
 * Uploads an image a model made from `prompt`, named after it with the
 * extension of the type it came as. It says it is uploading only once the
 * image is one `upload` will send.
 */
export async function uploadGeneratedImage(
  imageData: Uint8Array,
  mimeType: string,
  prompt: string,
  upload: Upload,
): Promise<string | null> {
  const extension =
    IMAGE_EXTENSIONS[mimeType as keyof typeof IMAGE_EXTENSIONS] ?? "bin";
  const name = `${prompt.replace(/[^a-z0-9_\-.]/gi, "_").substring(0, 50)}_${crypto.randomUUID()}.${extension}`;
  const file = new File([new Uint8Array(imageData)], name, { type: mimeType });
  if (refusal(file, IMAGE) === null) {
    toast.info("Uploading image…", { description: name });
  }
  const url = await upload(file);
  if (url) toast.success("Upload Successful", { description: name });
  return url;
}

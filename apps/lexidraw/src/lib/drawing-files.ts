import { IMAGE, IMAGE_EXTENSIONS } from "./media-kinds";

/**
 * The file types a drawing stores for its image elements: a document's
 * images, and GIF, which the drawing editor takes and a document does not.
 */
export const DRAWING_FILE_TYPES = [...IMAGE.types, "image/gif"] as const;

export type DrawingFileType = (typeof DRAWING_FILE_TYPES)[number];

export const DRAWING_FILE_EXTENSIONS: Record<DrawingFileType, string> = {
  ...IMAGE_EXTENSIONS,
  "image/gif": "gif",
};

/**
 * The largest file a drawing stores, in decoded bytes. A file travels as a
 * base64 data URL inside a JSON body, every REST path is served by one adapter
 * that reads JSON and nothing else, and the platform refuses a request body
 * over 4.5 MB before it reaches the handler. Base64 adds a third, so 3 MiB is
 * the most that still arrives as a request the server can answer with a reason.
 */
export const MAX_DRAWING_FILE_BYTES = 3 * 1024 * 1024;

/** Excalidraw's own file ids are SHA-1 hex, or a nanoid where that is unavailable. */
export const DRAWING_FILE_ID = /^[A-Za-z0-9_-]{1,128}$/;

const DATA_URL = /^data:([^;,]+)((?:;[^;,]*)*?);base64,([A-Za-z0-9+/]*={0,2})$/;

/**
 * A data URL's payload as a drawing would store it, or why it will not: the
 * URL has to be base64, declare `mimeType`, be a type a drawing stores, and
 * decode to no more than {@link MAX_DRAWING_FILE_BYTES}.
 */
export function readDrawingFile(
  mimeType: string,
  dataURL: string,
):
  | { ok: true; mimeType: DrawingFileType; base64: string }
  | { ok: false; reason: string } {
  const type = DRAWING_FILE_TYPES.find((allowed) => allowed === mimeType);
  if (!type) {
    return {
      ok: false,
      reason: `A drawing cannot store ${mimeType || "a file without a type"}; allowed: ${DRAWING_FILE_TYPES.join(", ")}`,
    };
  }
  const parsed = DATA_URL.exec(dataURL);
  const [, declared, , base64 = ""] = parsed ?? [];
  if (!parsed || base64.length % 4 !== 0) {
    return { ok: false, reason: "The file is not a base64 data URL" };
  }
  if (declared !== mimeType) {
    return {
      ok: false,
      reason: `The data URL is ${declared}, not the ${mimeType} it was sent as`,
    };
  }
  const bytes = decodedLength(base64);
  if (bytes > MAX_DRAWING_FILE_BYTES) {
    return {
      ok: false,
      reason: `The file is ${megabytes(bytes)} MB, over the ${megabytes(MAX_DRAWING_FILE_BYTES)} MB a drawing stores`,
    };
  }
  return { ok: true, mimeType: type, base64 };
}

function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

const megabytes = (bytes: number) =>
  Math.round((bytes / (1024 * 1024)) * 10) / 10;

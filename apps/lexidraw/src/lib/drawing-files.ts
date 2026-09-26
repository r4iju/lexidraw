import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import { MAX_DRAWING_FILE_BYTES } from "@packages/types";
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
 * A drawing file's id: the SHA-1 of its bytes in lowercase hex, as Excalidraw
 * names a file, so one id is one set of bytes. Excalidraw falls back to a
 * nanoid only outside a secure context, where Lexidraw is never served, and
 * no drawing stored a file before ids were checked, so no stored file has one.
 */
export const DRAWING_FILE_ID = /^[0-9a-f]{40}$/;

/** The id a file of `bytes` is stored under. */
export async function drawingFileId(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * A file as Excalidraw holds it. Its id and data URL are branded strings that
 * Excalidraw offers no way to make, so they are asserted here and nowhere else.
 */
export function editorFile(file: {
  id: string;
  mimeType: DrawingFileType;
  dataURL: string;
  created: number;
}): BinaryFileData {
  return {
    ...file,
    id: file.id as BinaryFileData["id"],
    dataURL: file.dataURL as BinaryFileData["dataURL"],
  };
}

export function dataURLOf(mimeType: string, bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

const DATA_URL = /^data:([^;,]+)((?:;[^;,]*)*?);base64,([A-Za-z0-9+/]*={0,2})$/;

/**
 * A data URL's bytes as a drawing would store them, or why it will not: the
 * URL has to be base64, declare `mimeType`, be a type a drawing stores,
 * decode to no more than {@link MAX_DRAWING_FILE_BYTES}, and hold bytes of
 * that type.
 */
export function readDrawingFile(
  mimeType: string,
  dataURL: string,
):
  | { ok: true; mimeType: DrawingFileType; bytes: Uint8Array }
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
  const size = decodedLength(base64);
  if (size > MAX_DRAWING_FILE_BYTES) {
    return {
      ok: false,
      reason: `The file is ${megabytes(size)} MB, over the ${megabytes(MAX_DRAWING_FILE_BYTES)} MB a drawing stores`,
    };
  }
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const actual = typeOfBytes(bytes);
  if (actual !== type) {
    return {
      ok: false,
      reason: actual
        ? `The file is ${TYPE_NAMES[actual]}, not the ${type} it was sent as`
        : `The file is not ${TYPE_NAMES[type]}, the ${type} it was sent as`,
    };
  }
  return { ok: true, mimeType: type, bytes };
}

const TYPE_NAMES: Record<DrawingFileType, string> = {
  "image/png": "a PNG",
  "image/jpeg": "a JPEG",
  "image/gif": "a GIF",
  "image/webp": "a WebP",
  "image/avif": "an AVIF",
  "image/svg+xml": "an SVG",
};

/** The type `bytes` begin as, which is the type they are. */
function typeOfBytes(bytes: Uint8Array): DrawingFileType | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));
  if (
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, at) => bytes[at] === byte,
    )
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && isAvifBrand(bytes)) return "image/avif";
  if (new TextDecoder().decode(bytes).includes("<svg")) return "image/svg+xml";
  return null;
}

/** Whether an ISO media file's `ftyp` box names AVIF among its brands. */
function isAvifBrand(bytes: Uint8Array): boolean {
  const boxEnd = Math.min(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0),
    bytes.length,
  );
  const brands = [8];
  // Past the major brand comes a minor version, then the compatible brands.
  for (let at = 16; at + 4 <= boxEnd; at += 4) brands.push(at);
  return brands.some((at) => {
    const brand = String.fromCharCode(...bytes.subarray(at, at + 4));
    return brand === "avif" || brand === "avis";
  });
}

function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** Bytes as the MB a reason names them in. */
export const megabytes = (bytes: number) =>
  Math.round((bytes / (1024 * 1024)) * 10) / 10;

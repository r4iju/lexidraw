import type { BinaryFileData } from "@excalidraw/excalidraw/types";
import {
  DRAWING_FILE_TYPES,
  type DrawingFileType,
  dataURLOf,
  drawingFileId,
  editorFile,
} from "./drawing-files";

/** Excalidraw's `DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT`, which it scales to. */
const MAX_IMAGE_SIDE = 1440;

const REENCODED_AS_ITSELF = ["image/png", "image/jpeg", "image/webp"] as const;

export type Preparation =
  | { kind: "keep"; mimeType: DrawingFileType }
  | {
      kind: "scale";
      mimeType: (typeof REENCODED_AS_ITSELF)[number];
      width: number;
      height: number;
    };

/**
 * What becomes of an image put in a drawing before it is stored: kept as
 * picked when it is a type a drawing stores and no larger than Excalidraw
 * would scale it to, and otherwise drawn again at most that large, as its own
 * type where a browser encodes it and as PNG where not. An SVG is kept as the
 * editor normalized it.
 */
export function preparation(
  mimeType: string,
  { width, height }: { width: number; height: number },
): Preparation {
  const stored = DRAWING_FILE_TYPES.find((type) => type === mimeType);
  if (stored === "image/svg+xml") return { kind: "keep", mimeType: stored };
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  if (stored && scale === 1) return { kind: "keep", mimeType: stored };
  return {
    kind: "scale",
    mimeType:
      REENCODED_AS_ITSELF.find((type) => type === mimeType) ?? "image/png",
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** An image's bytes as a drawing stores them; see {@link preparation}. */
async function preparedFile(
  file: File,
): Promise<{ mimeType: DrawingFileType; bytes: Uint8Array }> {
  const picked = async (mimeType: DrawingFileType) => ({
    mimeType,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (file.type === "image/svg+xml") return picked("image/svg+xml");
  const bitmap = await createImageBitmap(file);
  try {
    const plan = preparation(file.type, bitmap);
    if (plan.kind === "keep") return picked(plan.mimeType);
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The image could not be scaled");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    const blob = await canvas.convertToBlob({ type: plan.mimeType });
    return {
      // A browser that cannot encode a type encodes PNG instead.
      mimeType:
        DRAWING_FILE_TYPES.find((type) => type === blob.type) ?? "image/png",
      bytes: new Uint8Array(await blob.arrayBuffer()),
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Excalidraw's `generateIdForFile`, making a file's id the hash of the bytes
 * the drawing stores. Excalidraw names a file by the hash of what was picked
 * and then scales it, so the two differ; with the prepared file in the editor
 * under its own hash before the id is answered, Excalidraw keeps that file
 * rather than scaling the picked one.
 */
export function contentAddressedFileIds(editor: {
  addFiles: (files: BinaryFileData[]) => void;
}): (file: File) => Promise<string> {
  return async (file) => {
    const { mimeType, bytes } = await preparedFile(file);
    const id = await drawingFileId(bytes);
    editor.addFiles([
      editorFile({
        id,
        mimeType,
        dataURL: dataURLOf(mimeType, bytes),
        created: Date.now(),
      }),
    ]);
    return id;
  };
}

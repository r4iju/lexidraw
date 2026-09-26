import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import env from "@packages/env";
import { DRAWING_FILES_LIMIT } from "@packages/types";
import { BlobError, head, list, put } from "@vercel/blob";
import { z } from "zod";
import {
  DRAWING_FILE_EXTENSIONS,
  DRAWING_FILE_TYPES,
  type DrawingFileType,
  dataURLOf,
  editorFile,
  megabytes,
} from "~/lib/drawing-files";
import type { CanonicalElement } from "./skeleton-schema";

/** A file a drawing stores, as its image elements refer to it by `id`. */
export const StoredDrawingFile = z.object({
  id: z.string(),
  mimeType: z.enum(DRAWING_FILE_TYPES),
  url: z.url(),
  created: z
    .number()
    .int()
    .meta({ description: "When the file was stored, in epoch milliseconds." }),
});

export type StoredDrawingFile = z.infer<typeof StoredDrawingFile>;

/** The drawing has no room for another file; see `DRAWING_FILES_LIMIT`. */
export class DrawingFilesFullError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingFilesFullError";
  }
}

export const drawingFilesPrefix = (drawingId: string) =>
  `drawings/${drawingId}/files/`;

const drawingFilePath = (
  drawingId: string,
  file: { id: string; mimeType: DrawingFileType },
) =>
  `${drawingFilesPrefix(drawingId)}${file.id}.${DRAWING_FILE_EXTENSIONS[file.mimeType]}`;

/**
 * The file's type is in its name, because a listing of the store says what
 * each blob is called and nothing about what it holds.
 */
const DRAWING_FILE = new RegExp(
  `^drawings/(.+)/files/([^/.]+)\\.(${Object.values(DRAWING_FILE_EXTENSIONS).join("|")})$`,
);

const TYPE_OF_EXTENSION = new Map(
  DRAWING_FILE_TYPES.map((type) => [DRAWING_FILE_EXTENSIONS[type], type]),
);

/** The drawing and file a stored blob is, or null when it is no drawing's file. */
export function drawingFileAt(
  pathname: string,
): { drawingId: string; fileId: string; mimeType: DrawingFileType } | null {
  const [, drawingId, fileId, extension] = DRAWING_FILE.exec(pathname) ?? [];
  const mimeType = extension && TYPE_OF_EXTENSION.get(extension);
  return drawingId && fileId && mimeType
    ? { drawingId, fileId, mimeType }
    : null;
}

/**
 * Stores a file of a drawing, whose id is the hash of its bytes. A file is
 * written once: storing one the drawing already has answers it as it was
 * first stored, even when the drawing has no room for another.
 */
export async function storeDrawingFile(
  drawingId: string,
  file: { id: string; mimeType: DrawingFileType; bytes: Uint8Array },
): Promise<Omit<StoredDrawingFile, "url">> {
  const stored = await listStored(drawingId);
  const existing = stored.find((blob) => blob.file.id === file.id);
  if (existing) return withoutUrl(existing.file);
  // Judged on a listing, so uploads racing each other can pass it together.
  const bytes = stored.reduce((sum, blob) => sum + blob.size, 0);
  if (
    stored.length + 1 > DRAWING_FILES_LIMIT.count ||
    bytes + file.bytes.length > DRAWING_FILES_LIMIT.bytes
  ) {
    throw new DrawingFilesFullError(
      `The drawing stores ${stored.length} files, ${megabytes(bytes)} MB; a drawing stores at most ${DRAWING_FILES_LIMIT.count} files and ${megabytes(DRAWING_FILES_LIMIT.bytes)} MB`,
    );
  }
  const pathname = drawingFilePath(drawingId, file);
  const created = Date.now();
  try {
    await put(pathname, new Blob([new Uint8Array(file.bytes)]), {
      access: "public",
      contentType: file.mimeType,
      addRandomSuffix: false,
      allowOverwrite: false,
      token: env.BLOB_READ_WRITE_TOKEN,
    });
  } catch (error) {
    // The store refuses an existing pathname as a bad request, with nothing
    // but its message to tell it from another one, so ask it what is there.
    if (!(error instanceof BlobError)) throw error;
    const there = await head(pathname, {
      token: env.BLOB_READ_WRITE_TOKEN,
    }).catch(() => null);
    if (!there) throw error;
    return {
      id: file.id,
      mimeType: file.mimeType,
      created: new Date(there.uploadedAt).getTime(),
    };
  }
  return { id: file.id, mimeType: file.mimeType, created };
}

const withoutUrl = ({
  url: _,
  ...file
}: StoredDrawingFile): Omit<StoredDrawingFile, "url"> => file;

/** Every file a drawing stores. */
export async function listDrawingFiles(
  drawingId: string,
): Promise<StoredDrawingFile[]> {
  return (await listStored(drawingId)).map((blob) => blob.file);
}

async function listStored(
  drawingId: string,
): Promise<{ file: StoredDrawingFile; size: number }[]> {
  const stored: { file: StoredDrawingFile; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: drawingFilesPrefix(drawingId),
      cursor,
      token: env.BLOB_READ_WRITE_TOKEN,
    });
    for (const blob of page.blobs) {
      const at = drawingFileAt(blob.pathname);
      if (at?.drawingId !== drawingId) continue;
      stored.push({
        file: {
          id: at.fileId,
          mimeType: at.mimeType,
          url: blob.url,
          created: new Date(blob.uploadedAt).getTime(),
        },
        size: blob.size,
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return stored;
}

/**
 * The files `elements` show, as the editor holds them, with their bytes
 * inline, for drawing them where no browser fetches them. One that cannot be
 * fetched is left out, so its element draws as a placeholder.
 */
export async function loadDrawingFiles(
  drawingId: string,
  elements: readonly CanonicalElement[],
): Promise<BinaryFiles> {
  const fileIds = imageFileIds(elements);
  if (fileIds.size === 0) return {};
  const wanted = (await listDrawingFiles(drawingId)).filter((file) =>
    fileIds.has(file.id),
  );
  const loaded = await Promise.all(
    wanted.map(async (file) => {
      try {
        const response = await fetch(file.url);
        if (!response.ok) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        return editorFile({
          id: file.id,
          mimeType: file.mimeType,
          dataURL: dataURLOf(file.mimeType, bytes),
          created: file.created,
        });
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(
    loaded.flatMap((file) => (file ? [[file.id, file]] : [])),
  );
}

/** The files live image elements show. */
function imageFileIds(elements: readonly CanonicalElement[]): Set<string> {
  const ids = new Set<string>();
  for (const element of elements) {
    if (
      element.type === "image" &&
      element.isDeleted !== true &&
      typeof element.fileId === "string"
    )
      ids.add(element.fileId);
  }
  return ids;
}

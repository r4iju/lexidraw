import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import env from "@packages/env";
import { list, put } from "@vercel/blob";
import {
  DRAWING_FILE_EXTENSIONS,
  DRAWING_FILE_TYPES,
  type DrawingFileType,
} from "~/lib/drawing-files";
import type { CanonicalElement } from "./skeleton-schema";

/** A file a drawing stores, as its image elements refer to it by `id`. */
export type StoredDrawingFile = {
  id: string;
  mimeType: DrawingFileType;
  url: string;
  /** When it was stored, in epoch milliseconds, as Excalidraw keeps it. */
  created: number;
};

export const drawingFilesPrefix = (drawingId: string) =>
  `drawings/${drawingId}/files/`;

/**
 * The file's type is in its name, because a listing of the store says what
 * each blob is called and nothing about what it holds.
 */
const FILE_NAME = new RegExp(
  `^([^/.]+)\\.(${Object.values(DRAWING_FILE_EXTENSIONS).join("|")})$`,
);

const TYPE_OF_EXTENSION = new Map(
  DRAWING_FILE_TYPES.map((type) => [DRAWING_FILE_EXTENSIONS[type], type]),
);

const DRAWING_FILE = /^drawings\/(.+)\/files\/[^/]+$/;

/** The drawing a stored blob is a file of, or null when it is no drawing's. */
export function drawingOfFile(pathname: string): string | null {
  return DRAWING_FILE.exec(pathname)?.[1] ?? null;
}

/**
 * Stores a file of a drawing. Excalidraw names a file by the hash of its
 * bytes, so storing the same id again writes what is already there.
 */
export async function storeDrawingFile(
  drawingId: string,
  file: { id: string; mimeType: DrawingFileType; bytes: Uint8Array },
): Promise<Omit<StoredDrawingFile, "url">> {
  const created = Date.now();
  await put(
    `${drawingFilesPrefix(drawingId)}${file.id}.${DRAWING_FILE_EXTENSIONS[file.mimeType]}`,
    new Blob([new Uint8Array(file.bytes)]),
    {
      access: "public",
      contentType: file.mimeType,
      addRandomSuffix: false,
      allowOverwrite: true,
      token: env.BLOB_READ_WRITE_TOKEN,
    },
  );
  return { id: file.id, mimeType: file.mimeType, created };
}

/** Every file a drawing stores. */
export async function listDrawingFiles(
  drawingId: string,
): Promise<StoredDrawingFile[]> {
  const prefix = drawingFilesPrefix(drawingId);
  const files: StoredDrawingFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix,
      cursor,
      token: env.BLOB_READ_WRITE_TOKEN,
    });
    for (const blob of page.blobs) {
      const [, id, extension] =
        FILE_NAME.exec(blob.pathname.slice(prefix.length)) ?? [];
      const mimeType = extension && TYPE_OF_EXTENSION.get(extension);
      if (!id || !mimeType) continue;
      files.push({
        id,
        mimeType,
        url: blob.url,
        created: new Date(blob.uploadedAt).getTime(),
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return files;
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
    wanted.map(async (file): Promise<BinaryFileData | null> => {
      try {
        const response = await fetch(file.url);
        if (!response.ok) return null;
        const base64 = Buffer.from(await response.arrayBuffer()).toString(
          "base64",
        );
        return {
          id: file.id as BinaryFileData["id"],
          mimeType: file.mimeType,
          dataURL:
            `data:${file.mimeType};base64,${base64}` as BinaryFileData["dataURL"],
          created: file.created,
        };
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

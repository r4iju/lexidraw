import "server-only";

import { list, del, type ListBlobResult } from "@vercel/blob";
import { RetryableError } from "workflow";
import { drawingFileAt } from "~/server/drawings/files";
import type { BlobReferences } from "./get-blob-references-step";

const OWN_AUDIO = /^tts\/(?:doc|article)\/([^/]+)\//;

/**
 * A blob is stored before the row that points at it, so one newer than this
 * before the references were read may be referenced by a row they missed.
 */
const UNRECORDED_FOR = 60 * 60 * 1000;

/**
 * A drawing's file is stored before the element that shows it is saved, and
 * an editor may hold that save back, so one no saved element names is kept
 * this long after it was stored.
 */
const UNREFERENCED_FOR = 24 * 60 * 60 * 1000;

/**
 * Whether nothing refers to a blob any more, judged for one stored at
 * `uploadedAt`. Only the kinds of blob a row refers to directly are judged:
 * thumbnails, uploads, a document's or an article's own audio, and a
 * drawing's files. Anything else, such as audio chunks shared through
 * manifests or database backups, is never an orphan here.
 */
function isOrphan(
  pathname: string,
  uploadedAt: number,
  { pathnames, ttsJobIds, drawingFiles, readAt }: References,
): boolean {
  if (uploadedAt >= readAt - UNRECORDED_FOR) return false;
  if (pathname.startsWith("thumbnails/") || !pathname.includes("/")) {
    return !pathnames.has(pathname);
  }
  const file = drawingFileAt(pathname);
  if (file) {
    const named = drawingFiles.get(file.drawingId);
    if (!named) return true;
    return !named.has(file.fileId) && uploadedAt < readAt - UNREFERENCED_FOR;
  }
  const audioOf = OWN_AUDIO.exec(pathname)?.[1];
  return audioOf !== undefined && !ttsJobIds.has(audioOf);
}

type References = {
  pathnames: ReadonlySet<string>;
  ttsJobIds: ReadonlySet<string>;
  drawingFiles: ReadonlyMap<string, ReadonlySet<string>>;
  readAt: number;
};

export async function processBlobBatchStep(
  references: BlobReferences,
  cursor?: string,
): Promise<{
  deletedCount: number;
  nextCursor?: string;
  hasMore: boolean;
}> {
  "use step";

  const judged: References = {
    pathnames: new Set(references.pathnames),
    ttsJobIds: new Set(references.ttsJobIds),
    drawingFiles: new Map(
      Object.entries(references.drawingFiles).map(([drawing, files]) => [
        drawing,
        new Set(files),
      ]),
    ),
    readAt: references.readAt,
  };

  try {
    const listResult: ListBlobResult = await list({ cursor, limit: 500 });

    const urlsToDelete: string[] = [];
    for (const blob of listResult.blobs) {
      if (
        isOrphan(blob.pathname, new Date(blob.uploadedAt).getTime(), judged)
      ) {
        urlsToDelete.push(blob.url);
      }
    }

    let deletedCount = 0;
    if (urlsToDelete.length > 0) {
      try {
        await del(urlsToDelete);
        deletedCount = urlsToDelete.length;
      } catch (deleteError) {
        throw new RetryableError(
          `Failed to delete blobs batch: ${(deleteError as Error).message}`,
          {
            retryAfter: 30_000,
          },
        );
      }
    }

    return {
      deletedCount,
      nextCursor: listResult.hasMore ? listResult.cursor : undefined,
      hasMore: listResult.hasMore ?? false,
    };
  } catch (error) {
    if (error instanceof RetryableError) {
      throw error;
    }
    throw new RetryableError(
      `Failed to process blob batch: ${(error as Error).message}`,
      {
        retryAfter: 30_000,
      },
    );
  }
}

processBlobBatchStep.maxRetries = 3;

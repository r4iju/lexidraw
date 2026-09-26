import "server-only";

import { list, del, type ListBlobResult } from "@vercel/blob";
import { RetryableError } from "workflow";
import type { BlobReferences } from "./get-blob-references-step";

const OWN_AUDIO = /^tts\/(?:doc|article)\/([^/]+)\//;

/**
 * A blob is stored before the row that points at it, so one newer than this
 * before the references were read may be referenced by a row they missed.
 */
const UNRECORDED_FOR = 60 * 60 * 1000;

/**
 * Whether nothing refers to a blob any more. Only the kinds of blob a row
 * refers to directly are judged: thumbnails, uploads, and a document's or an
 * article's own audio. Anything else, such as audio chunks shared through
 * manifests or database backups, is never an orphan here.
 */
function isOrphan(
  pathname: string,
  pathnames: ReadonlySet<string>,
  ttsJobIds: ReadonlySet<string>,
): boolean {
  if (pathname.startsWith("thumbnails/") || !pathname.includes("/")) {
    return !pathnames.has(pathname);
  }
  const audioOf = OWN_AUDIO.exec(pathname)?.[1];
  return audioOf !== undefined && !ttsJobIds.has(audioOf);
}

export async function processBlobBatchStep(
  references: BlobReferences,
  cursor?: string,
): Promise<{
  deletedCount: number;
  nextCursor?: string;
  hasMore: boolean;
}> {
  "use step";

  const pathnames = new Set(references.pathnames);
  const ttsJobIds = new Set(references.ttsJobIds);

  try {
    const listResult: ListBlobResult = await list({ cursor, limit: 500 });

    const urlsToDelete: string[] = [];
    const judgedBefore = references.readAt - UNRECORDED_FOR;
    for (const blob of listResult.blobs) {
      if (
        new Date(blob.uploadedAt).getTime() < judgedBefore &&
        isOrphan(blob.pathname, pathnames, ttsJobIds)
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

import "server-only";

import { list, del, type ListBlobResult } from "@vercel/blob";
import { RetryableError } from "workflow";

export async function processBlobBatchStep(
  dbBlobPathnames: string[],
  cursor?: string,
): Promise<{
  deletedCount: number;
  nextCursor?: string;
  hasMore: boolean;
}> {
  "use step";

  // Convert array to Set for O(1) lookup
  const dbBlobPathnamesSet = new Set(dbBlobPathnames);

  try {
    const listResult: ListBlobResult = await list({ cursor, limit: 500 });

    const urlsToDelete: string[] = [];
    for (const blob of listResult.blobs) {
      if (!dbBlobPathnamesSet.has(blob.pathname)) {
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

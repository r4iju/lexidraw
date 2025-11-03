import "server-only";

// This workflow coordinates durable blob cleanup: get DB pathnames → process batches → delete orphans.
// Steps are written to be idempotent and safe to retry.

import { getDbBlobPathnamesStep } from "./get-db-blob-pathnames-step";
import { processBlobBatchStep } from "./process-blob-batch-step";

export async function cleanupOrphanedBlobsWorkflow(
  cursor?: string,
): Promise<{ totalDeleted: number }> {
  "use workflow";

  console.log("[cleanup][wf] start", { cursor });

  // Get all blob pathnames referenced in the database
  const dbBlobPathnames = await getDbBlobPathnamesStep();

  console.log("[cleanup][wf] db pathnames collected", {
    count: dbBlobPathnames.length,
  });

  let totalDeleted = 0;
  let currentCursor = cursor;

  // Process batches until no more blobs
  do {
    const result = await processBlobBatchStep(dbBlobPathnames, currentCursor);

    totalDeleted += result.deletedCount;

    console.log("[cleanup][wf] batch processed", {
      deletedInBatch: result.deletedCount,
      totalDeleted,
      hasMore: result.hasMore,
    });

    currentCursor = result.nextCursor;
  } while (currentCursor);

  console.log("[cleanup][wf] cleanup complete", { totalDeleted });

  return { totalDeleted };
}

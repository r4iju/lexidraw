import "server-only";

// This workflow coordinates durable blob cleanup: read what the database refers to → process batches → delete orphans.
// Steps are written to be idempotent and safe to retry.

import { getBlobReferencesStep } from "./get-blob-references-step";
import { processBlobBatchStep } from "./process-blob-batch-step";

export async function cleanupOrphanedBlobsWorkflow(
  cursor?: string,
): Promise<{ totalDeleted: number }> {
  "use workflow";

  console.log("[cleanup][wf] start", { cursor });

  const references = await getBlobReferencesStep();

  console.log("[cleanup][wf] references collected", {
    count: references.pathnames.length,
    ttsJobs: references.ttsJobIds.length,
  });

  let totalDeleted = 0;
  let currentCursor = cursor;

  // Process batches until no more blobs
  do {
    const result = await processBlobBatchStep(references, currentCursor);

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

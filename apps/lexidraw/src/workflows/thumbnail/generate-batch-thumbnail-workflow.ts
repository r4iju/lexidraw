import "server-only";

// Batch workflow for processing multiple thumbnail jobs sequentially.
// Processes entities one at a time within a single workflow for better efficiency.

import { validateJobStep } from "./validate-job-step";
import { renderScreenshotStep } from "./render-screenshot-step";
import { uploadBlobStep } from "./upload-blobs-step";
import { updateEntityStep } from "./update-entity-step";
import { markJobDoneStep } from "./mark-job-done-step";
import { updateJobStatusStep } from "./update-job-status-step";
import { createScreenshotTokenStep } from "./create-screenshot-token-step";
import env from "@packages/env";

export interface BatchThumbnailJob {
  jobId: string;
  entityId: string;
  version: string;
}

export interface BatchThumbnailResult {
  jobId: string;
  entityId: string;
  success: boolean;
  lightUrl?: string;
  darkUrl?: string;
  error?: string;
}

export async function generateBatchThumbnailWorkflow(
  jobs: BatchThumbnailJob[],
): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: BatchThumbnailResult[];
}> {
  "use workflow";

  console.log("[thumbnail][batch-wf] start", {
    jobCount: jobs.length,
    entityIds: jobs.map((j) => j.entityId),
  });

  const results: BatchThumbnailResult[] = [];

  // Process jobs one at a time sequentially
  let index = 0;
  for (const job of jobs) {
    index++;
    console.log(`[thumbnail][batch-wf] processing ${index}/${jobs.length}`, {
      entityId: job.entityId,
    });

    try {
      const result = await processSingleJob(job);
      results.push({
        jobId: job.jobId,
        entityId: job.entityId,
        success: true,
        lightUrl: result.lightUrl,
        darkUrl: result.darkUrl,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      results.push({
        jobId: job.jobId,
        entityId: job.entityId,
        success: false,
        error: errorMessage,
      });
      // Mark job as error
      try {
        await updateJobStatusStep(
          job.jobId,
          "error",
          1,
          undefined,
          errorMessage,
        );
      } catch (updateError) {
        console.error(
          `[thumbnail][batch-wf] failed to update job status for ${job.jobId}`,
          updateError,
        );
      }
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("[thumbnail][batch-wf] complete", {
    total: jobs.length,
    successful,
    failed,
  });

  return {
    total: jobs.length,
    successful,
    failed,
    results,
  };
}

async function processSingleJob(
  job: BatchThumbnailJob,
): Promise<{ lightUrl: string; darkUrl: string }> {
  // Validate job (checks if entity exists and job is not stale)
  const validation = await validateJobStep(
    job.jobId,
    job.entityId,
    job.version,
  );

  // Mark job as processing
  await updateJobStatusStep(job.jobId, "processing", 0);

  // Build screenshot URL
  const explicitOrigin =
    (env as unknown as { APP_ORIGIN?: string }).APP_ORIGIN ||
    (env as unknown as { NEXT_PUBLIC_APP_URL?: string }).NEXT_PUBLIC_APP_URL;
  const derivedFromVercel = env.VERCEL_URL ? `https://${env.VERCEL_URL}` : null;
  const derivedFromNextAuth = env.NEXTAUTH_URL
    ? env.NEXTAUTH_URL.replace(/\/?api\/auth\/?$/, "")
    : null;
  const appBase =
    explicitOrigin ||
    derivedFromVercel ||
    derivedFromNextAuth ||
    "http://localhost:3000";
  const token = await createScreenshotTokenStep(
    validation.userId,
    validation.entityId,
    3 * 60_000,
  );
  const targetW = 640;
  const targetH = 480;
  const pageUrl = `${appBase}/screenshot/documents/${encodeURIComponent(
    validation.entityId,
  )}?st=${encodeURIComponent(token)}&width=${targetW}&height=${targetH}`;

  // Render screenshots for both themes in parallel
  const [light, dark] = await Promise.all([
    renderScreenshotStep(pageUrl, "light"),
    renderScreenshotStep(pageUrl, "dark"),
  ]);

  // Upload blobs
  const lightKey = `${validation.entityId}-light.webp`;
  const darkKey = `${validation.entityId}-dark.webp`;

  const [lightUrl, darkUrl] = await Promise.all([
    uploadBlobStep(lightKey, light),
    uploadBlobStep(darkKey, dark),
  ]);

  // Update entity with thumbnail URLs
  await updateEntityStep(validation.entityId, lightUrl, darkUrl, job.version);

  // Mark job as done
  await markJobDoneStep(job.jobId);

  return { lightUrl, darkUrl };
}

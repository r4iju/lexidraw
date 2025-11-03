import "server-only";

// This workflow coordinates durable thumbnail generation: validate → render → upload → update entity.
// Steps are written to be idempotent and safe to retry.

import { validateJobStep } from "./validate-job-step";
import { renderScreenshotStep } from "./render-screenshot-step";
import { uploadBlobStep } from "./upload-blobs-step";
import { updateEntityStep } from "./update-entity-step";
import { markJobDoneStep } from "./mark-job-done-step";
import { updateJobStatusStep } from "./update-job-status-step";
import { createScreenshotTokenStep } from "./create-screenshot-token-step";
import env from "@packages/env";

export async function generateThumbnailWorkflow(
  jobId: string,
  entityId: string,
  version: string,
  jobCreatedAt: Date,
): Promise<{ lightUrl: string; darkUrl: string }> {
  "use workflow";

  console.log("[thumbnail][wf] start", {
    jobId,
    entityId,
    version,
  });

  // Validate job (checks if entity exists and job is not stale)
  const validation = await validateJobStep(
    jobId,
    entityId,
    version,
    jobCreatedAt,
  );

  // Mark job as processing
  await updateJobStatusStep(jobId, "processing", 0);

  // Build screenshot URL
  // Use NEXTAUTH_URL if available, otherwise construct from VERCEL_URL
  const appBase =
    env.NEXTAUTH_URL ||
    (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "http://localhost:3000");
  const token = await createScreenshotTokenStep(
    validation.userId,
    validation.entityId,
    3 * 60_000,
  );
  const targetW = 640;
  const targetH = 480;
  const pageUrl = `${appBase}/screenshot/documents/${encodeURIComponent(validation.entityId)}?st=${encodeURIComponent(token)}&width=${targetW}&height=${targetH}`;

  console.log("[thumbnail][wf] rendering screenshots", {
    jobId,
    entityId,
    pageUrl,
  });

  // Render screenshots for both themes in parallel
  const [light, dark] = await Promise.all([
    renderScreenshotStep(pageUrl, "light"),
    renderScreenshotStep(pageUrl, "dark"),
  ]);

  console.log("[thumbnail][wf] screenshots rendered", {
    jobId,
    lightBytes: light.byteLength,
    darkBytes: dark.byteLength,
  });

  // Upload blobs
  const lightKey = `${validation.entityId}-light.webp`;
  const darkKey = `${validation.entityId}-dark.webp`;

  const [lightUrl, darkUrl] = await Promise.all([
    uploadBlobStep(lightKey, light),
    uploadBlobStep(darkKey, dark),
  ]);

  console.log("[thumbnail][wf] blobs uploaded", {
    jobId,
    lightUrl,
    darkUrl,
  });

  // Update entity with thumbnail URLs
  await updateEntityStep(validation.entityId, lightUrl, darkUrl, version);

  console.log("[thumbnail][wf] entity updated", {
    jobId,
    entityId: validation.entityId,
  });

  // Mark job as done
  await markJobDoneStep(jobId);

  console.log("[thumbnail][wf] job done", { jobId });

  return { lightUrl, darkUrl };
}

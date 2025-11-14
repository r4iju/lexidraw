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
): Promise<{ lightUrl: string; darkUrl: string }> {
  "use workflow";

  console.log("[thumbnail][wf] start", {
    jobId,
    entityId,
    version,
  });

  // Validate job (checks if entity exists and job is not stale)
  const validation = await validateJobStep(jobId, entityId, version);

  // Mark job as processing
  await updateJobStatusStep(jobId, "processing", 0);

  let light: Uint8Array;
  let dark: Uint8Array;
  let lightKey: string;
  let darkKey: string;

  if (validation.entityType === "drawing") {
    // Use screenshot approach for drawings (same as documents)
    // We cannot use @excalidraw/excalidraw's exportToBlob API because it requires browser APIs
    // (window, DOM) that don't exist in Node.js server environments. Workflow steps run server-side,
    // so we must use a headless browser service to render the drawing and capture a screenshot.
    // This approach is consistent with how we handle documents and ensures server-side compatibility.
    console.log("[thumbnail][wf] rendering drawing screenshots", {
      jobId,
      entityId: validation.entityId,
    });

    // Build screenshot URL
    // Prefer explicit origin if available; otherwise derive from VERCEL_URL or strip /api/auth from NEXTAUTH_URL
    const explicitOrigin =
      (env as unknown as { APP_ORIGIN?: string }).APP_ORIGIN ||
      (env as unknown as { NEXT_PUBLIC_APP_URL?: string }).NEXT_PUBLIC_APP_URL;
    const derivedFromVercel = env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : null;
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
    const basePageUrl = `${appBase}/screenshot/drawings/${encodeURIComponent(
      validation.entityId,
    )}?st=${encodeURIComponent(token)}&width=${targetW}&height=${targetH}`;

    console.log("[thumbnail][wf] rendering screenshots", {
      jobId,
      entityId: validation.entityId,
      basePageUrl,
    });

    // Render screenshots for both themes in parallel
    [light, dark] = await Promise.all([
      renderScreenshotStep(`${basePageUrl}&theme=light`, "light"),
      renderScreenshotStep(`${basePageUrl}&theme=dark`, "dark"),
    ]);

    console.log("[thumbnail][wf] screenshots rendered", {
      jobId,
      lightBytes: light.byteLength,
      darkBytes: dark.byteLength,
    });

    // Use .webp extension for drawings (screenshots)
    lightKey = `${validation.entityId}-light.webp`;
    darkKey = `${validation.entityId}-dark.webp`;
  } else {
    // Use screenshot approach for documents
    // Build screenshot URL
    // Prefer explicit origin if available; otherwise derive from VERCEL_URL or strip /api/auth from NEXTAUTH_URL
    const explicitOrigin =
      (env as unknown as { APP_ORIGIN?: string }).APP_ORIGIN ||
      (env as unknown as { NEXT_PUBLIC_APP_URL?: string }).NEXT_PUBLIC_APP_URL;
    const derivedFromVercel = env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : null;
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
    const basePageUrl = `${appBase}/screenshot/documents/${encodeURIComponent(
      validation.entityId,
    )}?st=${encodeURIComponent(token)}&width=${targetW}&height=${targetH}`;

    console.log("[thumbnail][wf] rendering screenshots", {
      jobId,
      entityId: validation.entityId,
      basePageUrl,
    });

    // Render screenshots for both themes in parallel
    [light, dark] = await Promise.all([
      renderScreenshotStep(`${basePageUrl}&theme=light`, "light"),
      renderScreenshotStep(`${basePageUrl}&theme=dark`, "dark"),
    ]);

    console.log("[thumbnail][wf] screenshots rendered", {
      jobId,
      lightBytes: light.byteLength,
      darkBytes: dark.byteLength,
    });

    // Use .webp extension for documents (screenshots)
    lightKey = `${validation.entityId}-light.webp`;
    darkKey = `${validation.entityId}-dark.webp`;
  }

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

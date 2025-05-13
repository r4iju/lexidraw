import { Elysia, t, type Context as ElysiaContext } from "elysia";
import env from "@packages/env";
import { DownloadService, type DownloadResult } from "./download.service";
import { BlobService } from "./blob.service";
import fs from "node:fs/promises";
import path from "node:path";
import { lookup as mimeLookup } from "mime-types";
import { uploadedVideos } from "@packages/drizzle/drizzle-schema";
import { createId } from "@paralleldrive/cuid2"; // Import CUID generator
import { drizzle, eq } from "@packages/drizzle";
const downloadService = new DownloadService();
const blobService = new BlobService();

// Simple bearer token auth hook for beforeHandle
// Context type will be inferred by Elysia when used in beforeHandle
const authenticate = (
  context: ElysiaContext & {
    set: { status?: number | string };
    request: ElysiaContext["request"];
  },
) => {
  const authHeader = context.request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    context.set.status = 401;
    return { error: "Unauthorized: Missing or invalid token" }; // Elysia will halt and send this
  }
  const token = authHeader.substring(7); // Remove "Bearer " prefix
  if (token !== env.SHARED_KEY) {
    context.set.status = 403;
    return { error: "Forbidden: Invalid token" }; // Elysia will halt and send this
  }
  // If authentication passes, do nothing, Elysia proceeds to the next handler
};

// Helper function to update video status
const updateVideoStatus = async (
  requestId: string,
  status: "DOWNLOADING" | "UPLOADING" | "UPLOADED" | "FAILED",
  data: Partial<
    Omit<
      typeof uploadedVideos.$inferInsert,
      "status" | "requestId" | "updatedAt"
    >
  > = {},
) => {
  console.log(`[Req:${requestId}] Updating status to ${status}`);
  try {
    await drizzle
      .update(uploadedVideos)
      .set({ ...data, status, updatedAt: new Date() })
      .where(eq(uploadedVideos.requestId, requestId));
  } catch (dbError) {
    console.error(
      `[Req:${requestId}] Failed to update status to ${status}:`,
      dbError,
    );
  }
};

const app = new Elysia()
  .decorate("downloadService", downloadService)
  .decorate("blobService", blobService)
  .get("/", () => "Hello from Media Downloader!", {
    beforeHandle: [authenticate], // Use array for hooks
  })
  .post(
    "/download",
    async ({ body, set, downloadService, blobService }) => {
      const { url, userId, entityId, cookies } = body;
      const requestId = crypto.randomUUID().substring(0, 12);

      console.log(
        `[Req:${requestId}] Received download request for URL: ${url}, UserID: ${userId}, EntityID: ${entityId}`,
      );

      try {
        // 1. Immediately create DB record with DOWNLOADING status
        const newVideoId = createId();
        await drizzle.insert(uploadedVideos).values({
          id: newVideoId,
          userId: userId,
          entityId: entityId,
          fileName: `pending-${requestId}`, // Temporary filename
          requestId: requestId,
          signedUploadUrl: "", // Not applicable yet
          signedDownloadUrl: "", // Not applicable yet
          status: "DOWNLOADING",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(
          `[Req:${requestId}] Initial video record created (ID: ${newVideoId}), status: DOWNLOADING`,
        );

        // 2. Return 202 Accepted immediately
        set.status = 202; // Accepted

        // 3. Start background processing (don't await)
        const processInBackground = async () => {
          let downloadResult: DownloadResult | undefined;
          try {
            console.log(
              `[Req:${requestId}] Starting background download for URL: ${url}`,
            );
            downloadResult = await downloadService.downloadVideo({
              url,
              cookies,
            });

            if (downloadResult.error || !downloadResult.filePath) {
              console.error(
                `[Req:${requestId}] Download failed:`,
                downloadResult.error,
              );
              await updateVideoStatus(requestId, "FAILED", {
                errorMessage:
                  downloadResult.error ??
                  "Download failed, no specific error message.",
              }); // Store error detail
              return;
            }

            console.log(
              `[Req:${requestId}] Video downloaded to: ${downloadResult.filePath}`,
            );
            await updateVideoStatus(requestId, "UPLOADING");

            const fileExtension =
              path.extname(downloadResult.filePath) || ".mp4";
            const sanitizedTitle = (downloadResult.title || "untitled")
              .replace(/[^a-zA-Z0-9_.-]/g, "_")
              .substring(0, 30);
            const s3Key = `${entityId}/${requestId}-${sanitizedTitle}${fileExtension}`;

            const s3ContentType =
              mimeLookup(downloadResult.filePath) || "application/octet-stream";
            console.log(
              `[Req:${requestId}] Determined S3 Content-Type: ${s3ContentType} for file ${downloadResult.filePath}`,
            );

            const blobResult = await blobService.uploadFile(
              downloadResult.filePath,
              s3Key,
              s3ContentType,
            );

            console.log(
              `[Req:${requestId}] File uploaded to S3: ${blobResult.url} with key: ${blobResult.key}, ContentType: ${blobResult.contentType}`,
            );

            // Update DB record with final details
            await updateVideoStatus(requestId, "UPLOADED", {
              fileName: blobResult.key,
              signedDownloadUrl: blobResult.url, // Assuming upload URL is also download URL
              // title: downloadResult.title, // Consider adding title/duration if schema allows
            });

            console.log(
              `[Req:${requestId}] Processing complete. Status: UPLOADED`,
            );
          } catch (error) {
            console.error(
              `[Req:${requestId}] Error during background processing for URL ${url}:`,
              error,
            );
            await updateVideoStatus(requestId, "FAILED", {
              errorMessage:
                error instanceof Error ? error.message : String(error),
            });
          } finally {
            if (downloadResult?.filePath) {
              try {
                await fs.unlink(downloadResult.filePath);
                console.log(
                  `[Req:${requestId}] Cleaned up temporary file: ${downloadResult.filePath}`,
                );
              } catch (cleanupError) {
                console.error(
                  `[Req:${requestId}] Error cleaning up temporary file ${downloadResult.filePath}:`,
                  cleanupError,
                );
              }
            }
          }
        };

        processInBackground().catch((err) => {
          // Catch errors from the async function itself (e.g., if DB connection fails initially)
          console.error(
            `[Req:${requestId}] Unhandled error in processInBackground:`,
            err,
          );
          // Attempt to mark as FAILED if possible, though the initial insert might have failed too
          updateVideoStatus(requestId, "FAILED", {
            errorMessage: "Background process failed to start or crashed",
          });
        });

        // Return the requestId to the client immediately
        return {
          requestId: requestId,
        };
      } catch (initialError) {
        // Error during the initial phase (e.g., DB connection issue before starting background task)
        console.error(
          `[Req:${requestId}] Critical error before starting background processing:`,
          initialError,
        );
        set.status = 500;
        return {
          error: "Failed to initiate download process.",
          requestId: requestId,
        };
      }
    },
    {
      body: t.Object({
        url: t.String({ format: "uri", error: "Invalid URL format" }),
        userId: t.String({ minLength: 1, error: "UserID is required" }),
        entityId: t.String({ minLength: 1, error: "EntityID is required" }),
        cookies: t.Optional(
          t.String({ description: "Path or URL to cookies.txt" }),
        ),
      }),
      beforeHandle: [authenticate], // Use array for hooks
    },
  )
  // TODO: Add a /status/:requestId endpoint
  .listen(env.MEDIA_DOWNLOADER_PORT || 3003);

console.log(
  `🦊 Media Downloader is running at http://${app.server?.hostname}:${app.server?.port}`,
);

export type App = typeof app;

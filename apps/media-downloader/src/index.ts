import { Elysia, t, type Context as ElysiaContext } from "elysia";
import env from "@packages/env";
import { DownloadService, type DownloadResult } from "./download.service";
import { S3Service } from "./s3.service";
import fs from "node:fs/promises";
import path from "node:path";
import { uploadedVideos } from "@packages/drizzle/drizzle-schema";
import { createId } from "@paralleldrive/cuid2"; // Import CUID generator
import { db } from "@packages/drizzle/drizzle";
const downloadService = new DownloadService();
const s3Service = new S3Service();

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

const app = new Elysia()
  .decorate("downloadService", downloadService)
  .decorate("s3Service", s3Service)
  .get("/", () => "Hello from Media Downloader!", {
    beforeHandle: [authenticate], // Use array for hooks
  })
  .post(
    "/download",
    async ({ body, set, downloadService, s3Service }) => {
      const { url, userId, entityId } = body;
      const requestId = crypto.randomUUID().substring(0, 12); // Consistent request ID generation
      const logPrefix = `[Req:${requestId}]`;
      console.log(
        `${logPrefix} Received download request for URL: ${url}, UserID: ${userId}, EntityID: ${entityId}`,
      );

      // Respond immediately
      set.status = 202; // Accepted
      const initialResponse = {
        message: "Download request received and is being processed.",
        requestId: requestId, // Using the same ID for consistency
        // statusUrl: `/status/${requestId}`, // Placeholder for a status endpoint
      };

      // Perform download and upload in the background (fire and forget)
      (async () => {
        let downloadResult: DownloadResult | undefined = undefined;
        try {
          console.log(
            `${logPrefix} Starting background processing for URL: ${url}`,
          );
          downloadResult = await downloadService.downloadVideo(url);

          if (downloadResult.error || !downloadResult.filePath) {
            console.error(
              `${logPrefix} Download failed:`,
              downloadResult.error,
            );
            // TODO: Potentially update DB with error status if a preliminary record was made
            // For now, we only insert on success.
            return;
          }

          console.log(
            `${logPrefix} Video downloaded to: ${downloadResult.filePath}`,
          );
          const fileExtension = path.extname(downloadResult.filePath) || ".mp4";
          // Sanitize title and generate a more robust S3 key
          const sanitizedTitle = (downloadResult.title || "untitled")
            .replace(/[^a-zA-Z0-9_.-]/g, "_")
            .substring(0, 100); // Limit length
          const s3Key = `media/${userId}/${entityId}/${requestId}-${sanitizedTitle}${fileExtension}`;

          const s3UploadResult = await s3Service.uploadFile(
            downloadResult.filePath,
            s3Key, // Use the generated S3 key directly
          );

          console.log(
            `${logPrefix} File uploaded to S3: ${s3UploadResult.url} with key: ${s3UploadResult.key}`,
          );

          // Save to database
          const newVideoId = createId();
          await db.insert(uploadedVideos).values({
            id: newVideoId,
            userId: userId,
            entityId: entityId,
            fileName: s3UploadResult.key, // This is the S3 key
            requestId: requestId,
            signedUploadUrl: s3UploadResult.url, // This is the direct S3 URL
            signedDownloadUrl: s3UploadResult.url, // This is the direct S3 URL
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          console.log(
            `${logPrefix} Video record saved to DB with ID: ${newVideoId} and RequestID: ${requestId}`,
          );
        } catch (error) {
          console.error(
            `${logPrefix} Error in background processing for URL ${url}:`,
            error,
          );
          // TODO: Update DB with error status
        } finally {
          if (downloadResult && downloadResult.filePath) {
            // Check if downloadResult and filePath exist
            try {
              await fs.unlink(downloadResult.filePath);
              console.log(
                `${logPrefix} Cleaned up temporary file: ${downloadResult.filePath}`,
              );
            } catch (cleanupError) {
              console.error(
                `${logPrefix} Error cleaning up temporary file ${downloadResult.filePath}:`,
                cleanupError,
              );
            }
          }
        }
      })(); // IIFE to run async immediately

      return initialResponse;
    },
    {
      body: t.Object({
        url: t.String({ format: "uri", error: "Invalid URL format" }),
        userId: t.String({ minLength: 1, error: "UserID is required" }),
        entityId: t.String({ minLength: 1, error: "EntityID is required" }),
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

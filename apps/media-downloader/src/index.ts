import { Elysia, t, type Context as ElysiaContext } from "elysia";
import env from "@packages/env";
import { DownloadService, type DownloadResult } from "./download.service";
import { S3Service } from "./s3.service";
import fs from "node:fs/promises";
import path from "node:path";
import { lookup as mimeLookup } from "mime-types";
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
      const requestId = crypto.randomUUID().substring(0, 12);
      const logPrefix = `[Req:${requestId}]`;
      console.log(
        `${logPrefix} Received download request for URL: ${url}, UserID: ${userId}, EntityID: ${entityId}`,
      );

      let downloadResult: DownloadResult | undefined = undefined;
      try {
        console.log(`${logPrefix} Starting processing for URL: ${url}`);
        downloadResult = await downloadService.downloadVideo(url);

        if (downloadResult.error || !downloadResult.filePath) {
          console.error(`${logPrefix} Download failed:`, downloadResult.error);
          set.status = 500; // Internal Server Error
          return {
            error: "Download failed",
            details: downloadResult.error,
            requestId: requestId,
          };
        }

        console.log(
          `${logPrefix} Video downloaded to: ${downloadResult.filePath}`,
        );
        const fileExtension = path.extname(downloadResult.filePath) || ".mp4";
        const sanitizedTitle = (downloadResult.title || "untitled")
          .replace(/[^a-zA-Z0-9_.-]/g, "_")
          .substring(0, 30);
        const s3Key = `${entityId}/${requestId}-${sanitizedTitle}${fileExtension}`;

        const s3ContentType =
          mimeLookup(downloadResult.filePath) || "application/octet-stream";
        console.log(
          `${logPrefix} Determined S3 Content-Type: ${s3ContentType} for file ${downloadResult.filePath}`,
        );

        const s3UploadResult = await s3Service.uploadFile(
          downloadResult.filePath,
          s3Key,
          s3ContentType,
        );

        console.log(
          `${logPrefix} File uploaded to S3: ${s3UploadResult.url} with key: ${s3UploadResult.key}, ContentType: ${s3UploadResult.contentType}`,
        );

        const newVideoId = createId();
        await db.insert(uploadedVideos).values({
          id: newVideoId,
          userId: userId,
          entityId: entityId,
          fileName: s3UploadResult.key,
          requestId: requestId,
          signedUploadUrl: s3UploadResult.url,
          signedDownloadUrl: s3UploadResult.url,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        console.log(
          `${logPrefix} Video record saved to DB with ID: ${newVideoId} and RequestID: ${requestId}`,
        );

        set.status = 200; // OK
        return {
          message: "Download and upload successful.",
          requestId: requestId,
          videoId: newVideoId,
          s3Url: s3UploadResult.url,
          s3Key: s3UploadResult.key,
          title: downloadResult.title,
          duration: downloadResult.duration,
        };
      } catch (error) {
        console.error(
          `${logPrefix} Error in processing for URL ${url}:`,
          error,
        );
        set.status = 500; // Internal Server Error
        return {
          error: "An unexpected error occurred during processing.",
          details: error instanceof Error ? error.message : String(error),
          requestId: requestId,
        };
      } finally {
        if (downloadResult && downloadResult.filePath) {
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

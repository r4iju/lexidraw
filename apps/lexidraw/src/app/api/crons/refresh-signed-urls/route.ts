import { type NextRequest, NextResponse } from "next/server";
import { s3 } from "~/server/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import env from "@packages/env";
import { and, desc, drizzle, eq, lte, schema } from "@packages/drizzle";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ServerRuntime } from "next";
import { canRunCron } from "../cron-middleware";

export const maxDuration = 120; // 2 minutes
export const runtime: ServerRuntime = "edge";
export const dynamic = "force-dynamic";
export const cache = "force-no-store";

export async function GET(request: NextRequest) {
  console.log("#".repeat(20), " Cron job started ", "#".repeat(20));

  const canRun = await canRunCron();
  if (!canRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shouldForceUpdate =
    request.nextUrl.searchParams.get("force-update") !== null;

  let updateSince = new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: 24 hours ago
  const queryParamUpdateSince =
    request.nextUrl.searchParams.get("update-since");

  if (queryParamUpdateSince) {
    updateSince = new Date(parseInt(queryParamUpdateSince));
  }

  console.log("shouldForceUpdate", shouldForceUpdate);
  console.log("updateSince", updateSince);

  let updatedCount = 0;

  try {
    const imageUpdateCriteria = shouldForceUpdate
      ? undefined
      : lte(schema.uploadedImages.updatedAt, updateSince);

    const uploadedImages = await drizzle
      .select({
        id: schema.uploadedImages.id,
        entityId: schema.uploadedImages.entityId,
        updatedAt: schema.uploadedImages.updatedAt,
      })
      .from(schema.uploadedImages)
      .where(() => imageUpdateCriteria)
      .orderBy(desc(schema.uploadedImages.updatedAt))
      .execute();

    console.log("Found images in table:", uploadedImages.length);

    // Fetch all uploaded videos
    const videoUpdateCriteria = shouldForceUpdate
      ? undefined
      : lte(schema.uploadedVideos.updatedAt, updateSince); // Assuming schema.uploadedVideos exists

    const uploadedVideos = await drizzle
      .select({
        id: schema.uploadedVideos.id, // Assuming schema.uploadedVideos exists
        entityId: schema.uploadedVideos.entityId, // Assuming schema.uploadedVideos exists
        updatedAt: schema.uploadedVideos.updatedAt, // Assuming schema.uploadedVideos exists
      })
      .from(schema.uploadedVideos) // Assuming schema.uploadedVideos exists
      .where(() => videoUpdateCriteria)
      .orderBy(desc(schema.uploadedVideos.updatedAt)) // Assuming schema.uploadedVideos exists
      .execute();

    console.log("Found videos in table:", uploadedVideos.length);

    const allEntityIds = [
      ...new Set([
        ...uploadedImages.map((item) => item.entityId),
        ...uploadedVideos.map((item) => item.entityId),
      ]),
    ];

    console.log("Total unique entities to process:", allEntityIds.length);

    for (const currentEntityId of allEntityIds) {
      const currentEntity = await drizzle
        .select({
          id: schema.entities.id,
          userId: schema.entities.userId,
          publicAccess: schema.entities.publicAccess,
          elements: schema.entities.elements,
          screenShotDark: schema.entities.screenShotDark,
          screenShotLight: schema.entities.screenShotLight,
        })
        .from(schema.entities)
        .where(eq(schema.entities.id, currentEntityId))
        .then((rows) => rows[0]);

      if (!currentEntity) {
        console.warn(`Entity not found for ID: ${currentEntityId}`);
        continue;
      }

      let updatedElements = currentEntity.elements;
      let screenShotDark = currentEntity.screenShotDark;
      let screenShotLight = currentEntity.screenShotLight;
      let entityNeedsUpdate = false;

      // Process images for the current entity
      const imagesForEntity = uploadedImages.filter(
        (img) => img.entityId === currentEntityId,
      );
      for (const _image of imagesForEntity) {
        const image = await drizzle
          .select()
          .from(schema.uploadedImages)
          .where(
            and(
              eq(schema.uploadedImages.id, _image.id),
              eq(schema.uploadedImages.entityId, currentEntityId),
            ),
          )
          .then((rows) => rows[0]);

        if (!image || !image.fileName) {
          console.warn(
            `Image not found or fileName missing for ID: ${_image.id}`,
          );
          continue;
        }

        const downloadCommand = new GetObjectCommand({
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: image.fileName,
        });
        const signedDownloadUrl = await getSignedUrl(s3, downloadCommand, {
          expiresIn: 7 * 24 * 60 * 60,
        });

        await drizzle
          .update(schema.uploadedImages)
          .set({
            signedDownloadUrl,
            updatedAt: new Date(),
          })
          .where(eq(schema.uploadedImages.id, image.id))
          .execute();

        console.log(
          `Updated download URL for image ${image.id}. Old URL: ${image.signedDownloadUrl}, New URL: ${signedDownloadUrl}`,
        );
        updatedCount++;
        entityNeedsUpdate = true;

        if (
          image.kind === "attachment" &&
          image.signedDownloadUrl &&
          updatedElements
        ) {
          const filename = image.fileName.replace(
            /[-[\]{}()*+?.,\\^$|#\\s]/g,
            "\\\\$&",
          );
          const regex = new RegExp(`https://\\S*${filename}\\S*GetObject`, "g");
          updatedElements = updatedElements.replaceAll(
            regex,
            signedDownloadUrl,
          );
        }
        if (image.kind === "thumbnail") {
          if (image.fileName.includes("dark") && screenShotDark) {
            screenShotDark = signedDownloadUrl;
          } else if (screenShotLight) {
            screenShotLight = signedDownloadUrl;
          }
        }
      }

      // Process videos for the current entity
      const videosForEntity = uploadedVideos.filter(
        (vid) => vid.entityId === currentEntityId,
      );
      for (const _video of videosForEntity) {
        const video = await drizzle
          .select()
          .from(schema.uploadedVideos) // Assuming schema.uploadedVideos exists
          .where(
            and(
              eq(schema.uploadedVideos.id, _video.id), // Assuming schema.uploadedVideos exists
              eq(schema.uploadedVideos.entityId, currentEntityId), // Assuming schema.uploadedVideos exists
            ),
          )
          .then((rows) => rows[0]);

        if (!video || !video.fileName) {
          // Assuming video has fileName
          console.warn(
            `Video not found or fileName missing for ID: ${_video.id}`,
          );
          continue;
        }

        const downloadCommand = new GetObjectCommand({
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: video.fileName,
        });
        const signedDownloadUrl = await getSignedUrl(s3, downloadCommand, {
          expiresIn: 7 * 24 * 60 * 60, // Assuming same expiry for videos
        });

        await drizzle
          .update(schema.uploadedVideos) // Assuming schema.uploadedVideos exists
          .set({
            signedDownloadUrl, // Assuming field exists
            updatedAt: new Date(),
          })
          .where(eq(schema.uploadedVideos.id, video.id)) // Assuming schema.uploadedVideos exists
          .execute();

        console.log(
          `Updated download URL for video ${video.id}. Old URL: ${video.signedDownloadUrl}, New URL: ${signedDownloadUrl}`,
        );
        updatedCount++;
        entityNeedsUpdate = true;

        // Assuming videos are also 'attachments' and their URLs are in 'elements'
        // And that videos also have a 'signedDownloadUrl' field that was stored previously.
        if (video.signedDownloadUrl && updatedElements) {
          const filename = video.fileName.replace(
            /[-[\]{}()*+?.,\\^$|#\\s]/g,
            "\\\\$&",
          );
          const regex = new RegExp(`https://\\S*${filename}\\S*GetObject`, "g");
          updatedElements = updatedElements.replaceAll(
            regex,
            signedDownloadUrl,
          );
        }
      }

      if (entityNeedsUpdate) {
        await drizzle
          .update(schema.entities)
          .set({
            ...(updatedElements !== currentEntity.elements
              ? { elements: updatedElements }
              : {}),
            ...(screenShotDark !== currentEntity.screenShotDark
              ? { screenShotDark }
              : {}),
            ...(screenShotLight !== currentEntity.screenShotLight
              ? { screenShotLight }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.entities.id, currentEntityId))
          .execute();
        console.log(
          `Updated entity ${currentEntityId} with new image/video URLs.`,
        );
      }
    }

    console.log("#".repeat(20), " Cron job finished ", "#".repeat(20));
    return NextResponse.json({ ok: true, updatedCount });
  } catch (error) {
    console.error("Error during cron job:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

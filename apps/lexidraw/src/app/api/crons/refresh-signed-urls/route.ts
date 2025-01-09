import { NextRequest, NextResponse } from "next/server";
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
// no cache
export const cache = "force-no-store";

export async function GET(request: NextRequest) {
  console.log("#".repeat(20), " Cron job started ", "#".repeat(20));

  const canRun = await canRunCron();
  if (!canRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // query param to force the cron job to run
  const shouldForceUpdate =
    request.nextUrl.searchParams.get("force-update") !== null;

  let updateSince = new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: 24 hours ago
  const queryParamUpdateSince =
    request.nextUrl.searchParams.get("update-since");

  // epoch time
  if (queryParamUpdateSince) {
    updateSince = new Date(parseInt(queryParamUpdateSince));
  }

  console.log("shouldForceUpdate", shouldForceUpdate);
  console.log("updateSince", updateSince);

  let updatedCount = 0;

  try {
    // Fetch all uploaded images
    const uploadedImages = await drizzle
      .select({
        id: schema.uploadedImages.id,
        entityId: schema.uploadedImages.entityId,
        updatedAt: schema.uploadedImages.updatedAt,
      })
      .from(schema.uploadedImages)
      .where(() =>
        shouldForceUpdate
          ? undefined
          : lte(schema.uploadedImages.updatedAt, updateSince),
      )
      .orderBy(desc(schema.uploadedImages.updatedAt))
      .execute();

    console.log("Found images in table:", uploadedImages.length);

    // Process one entity at a time to avoid holding large data in memory

    for (const currentEntityId of [
      ...new Set(uploadedImages.map((image) => image.entityId)),
    ]) {
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

      for (const _image of uploadedImages) {
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

        if (!image) {
          console.warn(`Image not found for ID: ${_image.id}`);
          continue;
        }

        // Generate a new signed download URL
        const downloadCommand = new GetObjectCommand({
          Bucket: env.SUPABASE_S3_BUCKET,
          Key: image.fileName,
        });
        const signedDownloadUrl = await getSignedUrl(s3, downloadCommand, {
          expiresIn: 7 * 24 * 60 * 60,
        });

        // Update the image record
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

        // Replace URLs in the entity's elements
        if (image.kind === "attachment") {
          const filename = image.fileName.replace(
            /[-[\]{}()*+?.,\\^$|#\s]/g,
            "\\$&",
          ); // Escape special regex characters in the filename
          const regex = new RegExp(`https://\\S*${filename}\\S*GetObject`, "g");

          updatedElements = updatedElements.replaceAll(
            regex,
            signedDownloadUrl,
          );

          updatedCount += 1;
        }
        if (image.kind === "thumbnail") {
          if (image.fileName.includes("dark")) {
            screenShotDark = signedDownloadUrl;
          } else {
            screenShotLight = signedDownloadUrl;
          }
          updatedCount += 1;
        }
      }

      // Final update for the last entity
      if (currentEntity && currentEntityId) {
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
        console.log(`Updated entity ${currentEntityId}`);
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

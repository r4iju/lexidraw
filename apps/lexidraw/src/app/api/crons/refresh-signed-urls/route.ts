import { headers as reqHeaders } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { s3 } from "~/server/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import env from "@packages/env";
import { asc, drizzle, eq, lte, schema } from "@packages/drizzle";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ServerRuntime } from "next";

export const maxDuration = 120; // 2 minutes
export const runtime: ServerRuntime = "edge";

export async function GET(request: NextRequest) {
  console.log("#".repeat(20), " Cron job started ", "#".repeat(20));

  const headers = await reqHeaders();
  if (
    env.NODE_ENV === "production" &&
    headers.get("Authorization") !== `Bearer ${env.CRON_SECRET}`
  ) {
    console.log(
      "Unauthorized, expected: ",
      `"Bearer ${env.CRON_SECRET}"`,
      `got: "${headers.get("Authorization")}"`,
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // query param to force the cron job to run
  const shouldForceUpdate =
    request.nextUrl.searchParams.get("force-update") !== null;

  console.log("shouldForceUpdate", shouldForceUpdate);

  let updatedCount = 0;

  try {
    // Fetch all uploaded images
    const uploadedImages = await drizzle
      .select({
        id: schema.uploadedImages.id,
        kind: schema.uploadedImages.kind,
        signedDownloadUrl: schema.uploadedImages.signedDownloadUrl,
        fileName: schema.uploadedImages.fileName,
        entityId: schema.uploadedImages.entityId,
        updatedAt: schema.uploadedImages.updatedAt,
      })
      .from(schema.uploadedImages)
      .where(() =>
        shouldForceUpdate
          ? undefined
          : lte(
              schema.uploadedImages.updatedAt,
              new Date(Date.now() - 24 * 60 * 60 * 1000),
            ),
      )
      .orderBy(asc(schema.uploadedImages.entityId))
      .execute();

    console.log("Found images in table:", uploadedImages.length);

    // Process one entity at a time to avoid holding large data in memory
    let currentEntityId: string | null = null;
    let currentEntity = null;
    let currentEntityDarkThumbnail = null;
    let currentEntityLightThumbnail = null;

    for (const image of uploadedImages) {
      // If entityId changes, fetch the new entity
      if (image.entityId !== currentEntityId) {
        if (currentEntity && currentEntityId) {
          // Update the previous entity if any changes were made
          await drizzle
            .update(schema.entities)
            .set({
              elements: currentEntity.elements,
              updatedAt: new Date(),
            })
            .where(eq(schema.entities.id, currentEntityId))
            .execute();
          console.log(`Updated entity ${currentEntityId}`);
        }

        // Fetch the new entity
        currentEntityId = image.entityId;
        currentEntity = await drizzle
          .select({
            id: schema.entities.id,
            userId: schema.entities.userId,
            publicAccess: schema.entities.publicAccess,
            elements: schema.entities.elements,
          })
          .from(schema.entities)
          .where(eq(schema.entities.id, currentEntityId))
          .then((rows) => rows[0]);

        if (!currentEntity) {
          console.warn(`Entity not found for ID: ${currentEntityId}`);
          currentEntityId = null;
          currentEntity = null;
          continue;
        }

        console.log(`Processing entity: ${currentEntityId}`);
      }

      if (!currentEntity) continue;

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
        currentEntity.elements = currentEntity.elements.replaceAll(
          image.signedDownloadUrl,
          signedDownloadUrl,
        );
        updatedCount += 1;
      }
      if (image.kind === "thumbnail") {
        if (image.fileName.includes("dark")) {
          currentEntityDarkThumbnail = signedDownloadUrl;
        } else {
          currentEntityLightThumbnail = signedDownloadUrl;
        }
        updatedCount += 1;
      }
    }

    // Final update for the last entity
    if (currentEntity && currentEntityId) {
      await drizzle
        .update(schema.entities)
        .set({
          // only update the parts that have changed
          ...(currentEntity.elements !== currentEntity.elements
            ? { elements: currentEntity.elements }
            : {}),
          ...(currentEntityDarkThumbnail
            ? { darkThumbnail: currentEntityDarkThumbnail }
            : {}),
          ...(currentEntityLightThumbnail
            ? { lightThumbnail: currentEntityLightThumbnail }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.entities.id, currentEntityId))
        .execute();
      console.log(`Updated entity ${currentEntityId}`);
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

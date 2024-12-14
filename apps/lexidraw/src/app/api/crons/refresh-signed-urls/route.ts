import { headers as reqHeaders } from 'next/headers';
import { NextResponse } from 'next/server';
import { s3 } from '~/server/s3';
import { GetObjectCommand } from "@aws-sdk/client-s3";
import env from '@packages/env';
import { asc, drizzle, eq, lte, schema } from '@packages/drizzle';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const maxDuration = 120; // 2 minutes

export async function GET() {
  console.log('#'.repeat(20), ' Cron job started ', '#'.repeat(20));

  const headers = await reqHeaders();
  if (headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let updatedCount = 0

  try {
    // Fetch all uploaded images
    const uploadedImages = await drizzle
      .select({
        id: schema.uploadedImage.id,
        kind: schema.uploadedImage.kind,
        signedDownloadUrl: schema.uploadedImage.signedDownloadUrl,
        fileName: schema.uploadedImage.fileName,
        entityId: schema.uploadedImage.entityId,
        updatedAt: schema.uploadedImage.updatedAt,
      })
      .from(schema.uploadedImage)
      .where(lte(schema.uploadedImage.updatedAt, new Date(Date.now() - 1 * 24 * 60 * 60 * 1000))) // 1 day for testing
      .orderBy(asc(schema.uploadedImage.entityId))
      .execute();

    console.log('Found images in table:', uploadedImages.length);

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
            .update(schema.entity)
            .set({
              elements: currentEntity.elements,
              updatedAt: new Date(),
            })
            .where(eq(schema.entity.id, currentEntityId))
            .execute();
          console.log(`Updated entity ${currentEntityId}`);
        }

        // Fetch the new entity
        currentEntityId = image.entityId;
        currentEntity = await drizzle
          .select({
            id: schema.entity.id,
            userId: schema.entity.userId,
            publicAccess: schema.entity.publicAccess,
            elements: schema.entity.elements,
          })
          .from(schema.entity)
          .where(eq(schema.entity.id, currentEntityId))
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
      const signedDownloadUrl = await getSignedUrl(s3, downloadCommand, { expiresIn: 7 * 24 * 60 * 60 });

      // Update the image record
      await drizzle
        .update(schema.uploadedImage)
        .set({
          signedDownloadUrl,
          updatedAt: new Date(),
        })
        .where(eq(schema.uploadedImage.id, image.id))
        .execute();

      console.log(
        `Updated download URL for image ${image.id}. Old URL: ${image.signedDownloadUrl}, New URL: ${signedDownloadUrl}`
      );

      // Replace URLs in the entity's elements
      if (image.kind === 'attachment') {
        currentEntity.elements = currentEntity.elements.replaceAll(image.signedDownloadUrl, signedDownloadUrl);
        updatedCount += 1;
      }
      if (image.kind === 'thumbnail') {
        if (image.fileName.includes('dark')) {
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
        .update(schema.entity)
        .set({
          // only update the parts that have changed
          ...(currentEntity.elements !== currentEntity.elements ? { elements: currentEntity.elements } : {}),
          ...(currentEntityDarkThumbnail ? { darkThumbnail: currentEntityDarkThumbnail } : {}),
          ...(currentEntityLightThumbnail ? { lightThumbnail: currentEntityLightThumbnail } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.entity.id, currentEntityId))
        .execute();
      console.log(`Updated entity ${currentEntityId}`);
    }

    console.log('#'.repeat(20), ' Cron job finished ', '#'.repeat(20));
    return NextResponse.json({ ok: true, updatedCount });
  } catch (error) {
    console.error('Error during cron job:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

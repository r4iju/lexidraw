import "dotenv/config";
import { s3 } from "~/server/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { put } from "@vercel/blob";
import env from "@packages/env";
import { drizzle, schema, eq } from "@packages/drizzle";

/* ---------------------------------------------------- */
/* helpers                                              */
/* ---------------------------------------------------- */
const isS3Url = (url: string | null | undefined) =>
  !!url && url.includes(env.SUPABASE_S3_ENDPOINT);

const fetchS3Object = async (key: string) => {
  const { Body, ContentType } = await s3.send(
    new GetObjectCommand({ Bucket: env.SUPABASE_S3_BUCKET, Key: key }),
  );
  if (!Body) throw new Error("Empty S3 body");
  const chunks: Buffer[] = [];
  // @ts-expect-error this actually works
  for await (const c of Body) chunks.push(c as Buffer);
  return {
    buffer: Buffer.concat(chunks),
    mime: ContentType ?? "application/octet-stream",
  };
};

type UploadedImage = typeof schema.uploadedImages.$inferSelect;
type UploadedVideo = typeof schema.uploadedVideos.$inferSelect;

const migrateFile = async (
  file: UploadedImage | UploadedVideo,
): Promise<string> => {
  // Already migrated?
  if (file.signedDownloadUrl && !isS3Url(file.signedDownloadUrl)) {
    return file.signedDownloadUrl;
  }

  // 1. get from S3
  const { buffer, mime } = await fetchS3Object(file.fileName);

  // 2. push to Blob
  const blob = await put(file.fileName, buffer, {
    access: "public",
    contentType: mime,
    multipart: true,
    allowOverwrite: true,
  });

  return blob.url;
};

/* ---------------------------------------------------- */
/* migrate one entity                                   */
/* ---------------------------------------------------- */
const migrateEntity = async (entityId: string) => {
  console.log(`\n▶ migrating entity ${entityId}`);

  const entity = await drizzle
    .select()
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId))
    .then((r) => r[0]);
  if (!entity) {
    console.warn("  not found – skipping");
    return;
  }

  /* ---------- images ---------- */
  const images = await drizzle
    .select()
    .from(schema.uploadedImages)
    .where(eq(schema.uploadedImages.entityId, entityId));

  let elements = entity.elements;
  let screenShotDark = entity.screenShotDark;
  let screenShotLight = entity.screenShotLight;

  for (const img of images) {
    if (!img.fileName) continue;
    try {
      const url = await migrateFile(img);
      await drizzle
        .update(schema.uploadedImages)
        .set({ signedDownloadUrl: url, updatedAt: new Date() })
        .where(eq(schema.uploadedImages.id, img.id));

      // patch entity fields
      if (img.kind === "thumbnail") {
        if (img.fileName.includes("dark")) screenShotDark = url;
        else screenShotLight = url;
      }
      if (elements && img.signedDownloadUrl) {
        const safe = img.fileName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
        elements = elements.replace(
          new RegExp(`https://\\S*${safe}\\S*`, "g"),
          url,
        );
      }
    } catch (e) {
      console.error("  error migrating file", img.fileName, e);
      continue;
    }
  }

  /* ---------- videos ---------- */
  const videos = await drizzle
    .select()
    .from(schema.uploadedVideos)
    .where(eq(schema.uploadedVideos.entityId, entityId));

  for (const vid of videos) {
    if (!vid.fileName) continue;
    const url = await migrateFile(vid);
    await drizzle
      .update(schema.uploadedVideos)
      .set({ signedDownloadUrl: url, updatedAt: new Date() })
      .where(eq(schema.uploadedVideos.id, vid.id));

    if (elements && vid.signedDownloadUrl) {
      const safe = vid.fileName.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
      elements = elements.replace(
        new RegExp(`https://\\S*${safe}\\S*`, "g"),
        url,
      );
    }
  }

  // commit entity patch if anything changed
  await drizzle
    .update(schema.entities)
    .set({
      ...(elements !== entity.elements ? { elements } : {}),
      ...(screenShotDark !== entity.screenShotDark ? { screenShotDark } : {}),
      ...(screenShotLight !== entity.screenShotLight
        ? { screenShotLight }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.entities.id, entityId));

  console.log(`  done ✔`);
};

/* ---------------------------------------------------- */
/* main loop                                            */
/* ---------------------------------------------------- */
const main = async () => {
  const rows = await drizzle
    .selectDistinct({ entityId: schema.uploadedImages.entityId })
    .from(schema.uploadedImages)
    .union(
      drizzle
        .selectDistinct({ entityId: schema.uploadedVideos.entityId })
        .from(schema.uploadedVideos),
    );

  for (const row of rows) {
    try {
      await migrateEntity(row.entityId);
    } catch (e) {
      console.error("‼ migration failed for", row.entityId, e);
    }
  }

  console.log("\n🎉 migration complete");
  process.exit(0);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

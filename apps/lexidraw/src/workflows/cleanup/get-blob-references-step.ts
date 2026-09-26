import "server-only";

import { drizzle, schema, sql } from "@packages/drizzle";

/** What the database refers to, in the terms `isOrphan` judges blobs by. */
export type BlobReferences = {
  /** Thumbnails and uploads, by pathname. */
  pathnames: string[];
  /** Jobs whose audio lives under `tts/doc/<id>/` or `tts/article/<id>/`. */
  ttsJobIds: string[];
};

function pathnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/^\//, "");
  } catch {
    return null;
  }
}

export async function getBlobReferencesStep(): Promise<BlobReferences> {
  "use step";

  const [thumbnails, images, videos, jobs] = await Promise.all([
    drizzle
      .select({
        light: schema.entities.screenShotLight,
        dark: schema.entities.screenShotDark,
      })
      .from(schema.entities)
      .where(
        sql`${schema.entities.screenShotDark} != '' OR ${schema.entities.screenShotLight} != ''`,
      ),
    drizzle
      .select({
        fileName: schema.uploadedImages.fileName,
        url: schema.uploadedImages.signedDownloadUrl,
      })
      .from(schema.uploadedImages),
    drizzle
      .select({
        fileName: schema.uploadedVideos.fileName,
        url: schema.uploadedVideos.signedDownloadUrl,
      })
      .from(schema.uploadedVideos),
    drizzle.select({ id: schema.ttsJobs.id }).from(schema.ttsJobs),
  ]);

  const pathnames = new Set<string>();
  for (const row of thumbnails) {
    for (const url of [row.light, row.dark]) {
      const pathname = pathnameFromUrl(url);
      if (pathname) pathnames.add(pathname);
    }
  }
  for (const upload of [...images, ...videos]) {
    const pathname = upload.fileName || pathnameFromUrl(upload.url);
    if (pathname) pathnames.add(pathname);
  }

  return {
    pathnames: [...pathnames],
    ttsJobIds: jobs.map((job) => job.id),
  };
}

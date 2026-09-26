import "server-only";

import { drizzle, schema, sql } from "@packages/drizzle";

/** What the database refers to, in the terms `isOrphan` judges blobs by. */
export type BlobReferences = {
  /** Thumbnails and uploads, by pathname. */
  pathnames: string[];
  /** Jobs whose audio lives under `tts/doc/<id>/` or `tts/article/<id>/`. */
  ttsJobIds: string[];
  /**
   * Every drawing there is, trashed ones too, which come back with their
   * images when restored, and the files under `drawings/<id>/files/` that its
   * saved image elements name, deleted elements included.
   */
  drawingFiles: Record<string, string[]>;
  /** When they were read, in epoch milliseconds. */
  readAt: number;
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

  const readAt = Date.now();
  const [thumbnails, images, videos, jobs, drawings] = await Promise.all([
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
    drizzle.all<{ id: string; fileId: unknown }>(sql`
      SELECT ${schema.entities.id} AS id,
        json_extract(element.value, '$.fileId') AS fileId
      FROM ${schema.entities}
      LEFT JOIN json_each(
        CASE WHEN json_valid(${schema.entities.elements})
          THEN ${schema.entities.elements} ELSE '[]' END
      ) AS element
        ON json_extract(element.value, '$.type') = 'image'
      WHERE ${schema.entities.entityType} = 'drawing'
    `),
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

  const drawingFiles: Record<string, string[]> = {};
  for (const { id, fileId } of drawings) {
    const files = drawingFiles[id] ?? [];
    if (typeof fileId === "string") files.push(fileId);
    drawingFiles[id] = files;
  }

  return {
    pathnames: [...pathnames],
    ttsJobIds: jobs.map((job) => job.id),
    drawingFiles,
    readAt,
  };
}

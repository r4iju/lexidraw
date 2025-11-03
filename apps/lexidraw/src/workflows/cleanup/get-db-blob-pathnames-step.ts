import "server-only";

import { drizzle, schema, sql } from "@packages/drizzle";

export async function getDbBlobPathnamesStep(): Promise<string[]> {
  "use step";

  const dbBlobPathnames = new Set<string>();

  // From entities table (snapshots are stored as full public URLs)
  const entitySnapshots = await drizzle
    .select({
      darkPathUrl: schema.entities.screenShotDark,
      lightPathUrl: schema.entities.screenShotLight,
    })
    .from(schema.entities)
    .where(
      sql`${schema.entities.screenShotDark} IS NOT NULL AND ${schema.entities.screenShotDark} != '' OR ${schema.entities.screenShotLight} IS NOT NULL AND ${schema.entities.screenShotLight} != ''`,
    );

  function getPathnameFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.pathname.startsWith("/")
        ? parsedUrl.pathname.substring(1)
        : parsedUrl.pathname;
    } catch {
      return null;
    }
  }

  for (const entity of entitySnapshots) {
    const darkPathname = getPathnameFromUrl(entity.darkPathUrl);
    if (darkPathname) dbBlobPathnames.add(darkPathname);
    const lightPathname = getPathnameFromUrl(entity.lightPathUrl);
    if (lightPathname) dbBlobPathnames.add(lightPathname);
  }

  // From uploadedImages table
  const imageRecords = await drizzle
    .select({
      fileName: schema.uploadedImages.fileName,
      publicUrl: schema.uploadedImages.signedDownloadUrl,
    })
    .from(schema.uploadedImages)
    .where(
      sql`${schema.uploadedImages.fileName} IS NOT NULL AND ${schema.uploadedImages.fileName} != ''`,
    );

  for (const record of imageRecords) {
    if (record.fileName) {
      dbBlobPathnames.add(record.fileName);
    } else {
      const urlPathname = getPathnameFromUrl(record.publicUrl);
      if (urlPathname) dbBlobPathnames.add(urlPathname);
    }
  }

  return Array.from(dbBlobPathnames);
}

import { NextResponse } from "next/server";
import { list, del, type ListBlobResult } from "@vercel/blob"; // Use Vercel Blob SDK, Add ListBlobResult type
import { drizzle, schema, sql } from "@packages/drizzle"; // Removed unused count, eq, inArray
import type { ServerRuntime } from "next";
import { canRunCron } from "../cron-middleware";

export const maxDuration = 600; // 10 minutes
export const runtime: ServerRuntime = "edge";
export const dynamic = "force-dynamic";

// Helper function to extract pathname from a full Vercel Blob URL
function getPathnameFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsedUrl = new URL(url);
    // Pathname includes the leading slash, remove it if Vercel's list().blobs[].pathname does not have it.
    // Vercel Blob pathnames do NOT have a leading slash.
    return parsedUrl.pathname.startsWith("/")
      ? parsedUrl.pathname.substring(1)
      : parsedUrl.pathname;
  } catch (e) {
    console.warn(
      `[Vercel Blob Cleanup] Could not parse URL to get pathname: ${url}`,
      e,
    );
    return null; // Or handle as an invalid URL entry
  }
}

export async function GET() {
  console.log("#[Vercel Blob Cleanup]# Cron job started ", "#".repeat(20));

  const canRun = await canRunCron();
  if (!canRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let deletedCount = 0;
    let cursor: string | undefined;
    const dbBlobPathnames = new Set<string>();

    // 1. Get all relevant blob pathnames referenced in the database

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

    entitySnapshots.forEach((entity) => {
      const darkPathname = getPathnameFromUrl(entity.darkPathUrl);
      if (darkPathname) dbBlobPathnames.add(darkPathname);
      const lightPathname = getPathnameFromUrl(entity.lightPathUrl);
      if (lightPathname) dbBlobPathnames.add(lightPathname);
    });

    // From uploadedImages table (fileName stores pathname, signedDownloadUrl stores full public URL)
    // We should primarily rely on fileName if it's guaranteed to be the Vercel Blob pathname.
    // If signedDownloadUrl is also a Vercel Blob URL, we can use it as a fallback or cross-reference.
    const imageRecords = await drizzle
      .select({
        fileName: schema.uploadedImages.fileName, // This should be the Vercel Blob pathname
        publicUrl: schema.uploadedImages.signedDownloadUrl, // This is the Vercel Blob public URL
      })
      .from(schema.uploadedImages)
      // Assuming only Vercel Blobs will have a signedDownloadUrl starting with https://*.public.blob.vercel-storage.com
      // Or rely on fileName if it's exclusively used for Vercel Blob pathnames for these records
      .where(
        sql`${schema.uploadedImages.fileName} IS NOT NULL AND ${schema.uploadedImages.fileName} != ''`,
      );
    // Add a more specific where clause if uploadedImages can contain non-Vercel blob data.

    imageRecords.forEach((record) => {
      if (record.fileName) {
        // Prefer fileName if it's the direct Vercel pathname
        dbBlobPathnames.add(record.fileName);
      } else {
        const urlPathname = getPathnameFromUrl(record.publicUrl);
        if (urlPathname) dbBlobPathnames.add(urlPathname);
      }
    });

    console.log(
      `[Vercel Blob Cleanup] Found ${dbBlobPathnames.size} unique blob pathnames referenced in the database.`,
    );
    // For debugging: console.log("[Vercel Blob Cleanup] DB pathnames:", Array.from(dbBlobPathnames));

    // 2. List all blobs in Vercel Blob storage and delete orphans
    do {
      const listResult: ListBlobResult = await list({ cursor, limit: 500 }); // Max limit is 1000
      console.log(
        `[Vercel Blob Cleanup] Fetched ${listResult.blobs.length} blobs from Vercel. Has More: ${listResult.hasMore}, Cursor: ${listResult.cursor}`,
      );

      const urlsToDelete: string[] = [];
      for (const blob of listResult.blobs) {
        // blob.pathname does NOT have a leading slash
        if (!dbBlobPathnames.has(blob.pathname)) {
          console.log(
            `[Vercel Blob Cleanup] Marking for deletion (pathname not in DB): ${blob.pathname}, URL: ${blob.url}`,
          );
          urlsToDelete.push(blob.url); // del() takes an array of URLs
        } else {
          // console.log(`[Vercel Blob Cleanup] Keeping blob (found in DB): ${blob.pathname}`);
        }
      }

      if (urlsToDelete.length > 0) {
        console.log(
          `[Vercel Blob Cleanup] Attempting to delete ${urlsToDelete.length} orphaned blobs...`,
        );
        try {
          await del(urlsToDelete);
          deletedCount += urlsToDelete.length;
          console.log(
            `[Vercel Blob Cleanup] Successfully deleted ${urlsToDelete.length} blobs.`,
          );
        } catch (deleteError) {
          console.error(
            `[Vercel Blob Cleanup] Error deleting blobs: ${urlsToDelete.join(", ")}`,
            deleteError,
          );
          // Decide if you want to retry, or just log and continue
        }
      }

      cursor = listResult.hasMore ? listResult.cursor : undefined;
    } while (cursor);

    console.log(
      "#[Vercel Blob Cleanup]# Cron job finished. Total orphaned blobs deleted:",
      deletedCount,
    );
    return NextResponse.json({ ok: true, deletedCount });
  } catch (error) {
    console.error("[Vercel Blob Cleanup] Error during cron job:", error);
    return NextResponse.json(
      { error: "Internal Server Error during Vercel Blob cleanup" },
      { status: 500 },
    );
  }
}

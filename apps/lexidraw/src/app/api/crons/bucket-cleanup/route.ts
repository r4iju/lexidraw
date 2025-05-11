import { NextResponse } from "next/server";
import { s3 } from "~/server/s3";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import env from "@packages/env";
import { count, drizzle, eq, schema } from "@packages/drizzle";
import type { ServerRuntime } from "next";
import { canRunCron } from "../cron-middleware";

export const maxDuration = 120; // 2 minutes
export const runtime: ServerRuntime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  console.log("#".repeat(20), " Cron job started ", "#".repeat(20));

  const canRun = await canRunCron();
  if (!canRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Count files in bucket
    const bucketRes = await s3.send(
      new ListObjectsV2Command({ Bucket: env.SUPABASE_S3_BUCKET }),
    );
    console.log(
      `Current number of items in ${env.SUPABASE_S3_BUCKET} bucket: ${bucketRes.Contents?.length}`,
    );
    console.log(
      `Current items in ${env.SUPABASE_S3_BUCKET} bucket: ${JSON.stringify(bucketRes.Contents, null, 2)}`,
    );

    const keysToDelete = [];

    for (const item of bucketRes.Contents ?? []) {
      if (!item.Key) continue;
      console.log(`Checking S3 item: ${item.Key}`);

      // Check if the key exists in uploadedImages
      const imageRecord = (
        await drizzle
          .select({ count: count() })
          .from(schema.uploadedImages)
          .where(eq(schema.uploadedImages.fileName, item.Key))
      )[0];

      // Check if the key exists in uploadedVideos (assuming schema.uploadedVideos exists)
      const videoRecord = (
        await drizzle
          .select({ count: count() })
          .from(schema.uploadedVideos) // Assuming schema.uploadedVideos exists
          .where(eq(schema.uploadedVideos.fileName, item.Key))
      )[0]; // Assuming schema.uploadedVideos.fileName exists

      const imageExists = imageRecord && imageRecord.count > 0;
      const videoExists = videoRecord && videoRecord.count > 0;

      if (!imageExists && !videoExists) {
        console.log(
          `Marking for deletion (not found in images or videos): ${item.Key}`,
        );
        keysToDelete.push(item.Key);
      } else {
        console.log(`Keeping S3 item (found in images or videos): ${item.Key}`);
      }
    }

    console.log(
      `${keysToDelete.length} Keys to delete: ${keysToDelete.join(", ")}`,
    );

    if (keysToDelete.length === 0) {
      console.log("No keys to delete");
      return NextResponse.json({ ok: true, deletedCount: 0 });
    }

    const deleteCommand = new DeleteObjectsCommand({
      Bucket: env.SUPABASE_S3_BUCKET,
      Delete: {
        Objects: keysToDelete.map((Key) => ({ Key })),
        Quiet: false,
      },
    });

    await s3.send(deleteCommand);

    console.log("#".repeat(20), " Cron job finished ", "#".repeat(20));
    return NextResponse.json({ ok: true, deletedCount: keysToDelete.length });
  } catch (error) {
    console.error("Error during cron job:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

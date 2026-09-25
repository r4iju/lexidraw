import { NextResponse } from "next/server";
import { canRunCron } from "../cron-middleware";
import { start } from "workflow/api";
import { errorCode } from "~/server/auth/error-code";
import { drizzle } from "@packages/drizzle";
import { purgeExpiredSignInAttempts } from "~/server/auth/sign-in-rate-limit";
import { purgeRoomSignals } from "~/server/rooms/room-signaling";
import { cleanupOrphanedBlobsWorkflow } from "~/workflows/cleanup/cleanup-orphaned-blobs-workflow";

export async function GET() {
  console.log("#[Vercel Blob Cleanup]# Cron job started ", "#".repeat(20));

  const canRun = await canRunCron();
  if (!canRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await purgeExpiredSignInAttempts();
  } catch (error) {
    console.error("[Vercel Blob Cleanup] Sign-in attempt purge failed", {
      error: errorCode(error),
    });
  }

  try {
    await purgeRoomSignals(drizzle, Date.now());
  } catch (error) {
    console.error("[Vercel Blob Cleanup] Room signal purge failed", {
      error: errorCode(error),
    });
  }

  try {
    // Trigger workflow for blob cleanup (fire-and-forget)
    void start(cleanupOrphanedBlobsWorkflow, [undefined]);

    console.log("[Vercel Blob Cleanup] Workflow triggered");
    return NextResponse.json({ ok: true, message: "Cleanup workflow started" });
  } catch (error) {
    console.error("[Vercel Blob Cleanup] Error triggering workflow:", error);
    return NextResponse.json(
      { error: "Internal Server Error during Vercel Blob cleanup" },
      { status: 500 },
    );
  }
}

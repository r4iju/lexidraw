import { NextResponse } from "next/server";
import { canRunCron } from "../cron-middleware";
import { start } from "workflow/api";
import { cleanupOrphanedBlobsWorkflow } from "~/workflows/cleanup/cleanup-orphaned-blobs-workflow";

export async function GET() {
  console.log("#[Vercel Blob Cleanup]# Cron job started ", "#".repeat(20));

  const canRun = await canRunCron();
  if (!canRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

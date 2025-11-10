import { NextResponse } from "next/server";
import { canRunCron } from "../cron-middleware";
import { getTursoDbName } from "@packages/lib/turso";
import { runTursoBackup } from "~/server/backup/turso-backup";

export async function GET() {
  console.log("[Turso Backup] Cron job started");

  const canRun = await canRunCron();
  if (!canRun) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get database name from env override or infer from TURSO_URL
    const dbName = getTursoDbName();

    // Run backup workflow
    const { key, url } = await runTursoBackup(dbName);

    // Log URL for internal monitoring but don't expose in response
    console.log("[Turso Backup] Backup completed", { dbName, key, url });
    return NextResponse.json({
      ok: true,
      message: "Backup completed",
      dbName,
      key,
      // URL intentionally omitted - backups are accessed via /api/backups/download with admin auth
    });
  } catch (error) {
    console.error("[Turso Backup] Error during backup:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error during Turso backup",
        message: (error as Error).message,
      },
      { status: 500 },
    );
  }
}

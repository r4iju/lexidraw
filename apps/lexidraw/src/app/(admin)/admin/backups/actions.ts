"use server";

import { revalidatePath } from "next/cache";
import { getTursoDbName } from "@packages/lib/turso";
import { assertAdminOrRedirect } from "~/server/admin";
import { runTursoBackup } from "~/server/backup/turso-backup";

export async function triggerBackupAction(): Promise<void> {
  await assertAdminOrRedirect();

  // Get database name from env override or infer from TURSO_URL
  const dbName = getTursoDbName();

  // Run backup (fire-and-forget)
  void runTursoBackup(dbName);
}

export async function revalidateBackupsPage(): Promise<void> {
  revalidatePath("/admin/backups", "page");
}

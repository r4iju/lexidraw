import { NextResponse, type NextRequest } from "next/server";
import { canRunCron } from "~/app/api/crons/cron-middleware";
import { drizzle, eq, and, inArray, sql, schema } from "@packages/drizzle";
import { start } from "workflow/api";
import { generateThumbnailWorkflow } from "~/workflows/thumbnail/generate-thumbnail-workflow";

function logCron(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.log(
      JSON.stringify({
        source: "thumbnail_cron",
        event,
        ts: Date.now(),
        ...data,
      }),
    );
  } catch {}
}

export async function GET(_req: NextRequest) {
  const ok = await canRunCron();
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = 10;
  const now = new Date();

  // Pick pending jobs that are ready to run
  const jobs = await drizzle
    .select({
      id: schema.thumbnailJobs.id,
      entityId: schema.thumbnailJobs.entityId,
      version: schema.thumbnailJobs.version,
      status: schema.thumbnailJobs.status,
      attempts: schema.thumbnailJobs.attempts,
      nextRunAt: schema.thumbnailJobs.nextRunAt,
      createdAt: schema.thumbnailJobs.createdAt,
      updatedAt: schema.thumbnailJobs.updatedAt,
    })
    .from(schema.thumbnailJobs)
    .where(
      and(
        inArray(schema.thumbnailJobs.status, ["pending", "error"]),
        sql`${schema.thumbnailJobs.nextRunAt} <= ${now}`,
        sql`${schema.thumbnailJobs.attempts} < 5`,
      ),
    )
    .limit(limit);

  logCron("picked_jobs", { count: jobs.length, jobIds: jobs.map((j) => j.id) });

  let triggered = 0;
  let skipped = 0;

  for (const job of jobs) {
    try {
      // Trigger workflow for this job (fire-and-forget)
      void start(generateThumbnailWorkflow, [
        job.id,
        job.entityId,
        job.version,
        new Date(job.createdAt),
      ]);
      triggered++;
      logCron("workflow_triggered", {
        jobId: job.id,
        entityId: job.entityId,
        version: job.version,
      });
    } catch (e) {
      skipped++;
      logCron("workflow_trigger_failed", {
        jobId: job.id,
        error: (e as Error)?.message ?? String(e),
      });
    }
  }

  logCron("batch_complete", {
    triggered,
    skipped,
    picked: jobs.length,
  });
  return NextResponse.json({
    triggered,
    skipped,
    picked: jobs.length,
  });
}

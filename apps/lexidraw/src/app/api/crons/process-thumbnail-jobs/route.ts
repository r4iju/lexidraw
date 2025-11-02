import { NextResponse, type NextRequest } from "next/server";
import { canRunCron } from "~/app/api/crons/cron-middleware";
import env from "@packages/env";
import { drizzle, eq, and, inArray, sql, schema } from "@packages/drizzle";
import { headers as nextHeaders } from "next/headers";
import { createScreenshotToken } from "~/server/auth/screenshot-token";
import { put } from "@vercel/blob";

type JobRow = {
  id: string;
  entityId: string;
  version: string;
  status: string;
  attempts: number;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function backoffDelayMs(attempts: number): number {
  switch (attempts) {
    case 0:
    case 1:
      return 15_000;
    case 2:
      return 60_000;
    case 3:
      return 5 * 60_000;
    case 4:
      return 20 * 60_000;
    default:
      return 2 * 60 * 60_000;
  }
}

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

  // pick runnable jobs
  const jobs = (await drizzle
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
    .limit(limit)) as JobRow[];

  logCron("picked_jobs", { count: jobs.length, jobIds: jobs.map((j) => j.id) });

  let processed = 0;
  let failed = 0;
  let stale = 0;

  for (const job of jobs) {
    const t0 = Date.now();
    try {
      logCron("job_start", {
        jobId: job.id,
        entityId: job.entityId,
        attempts: job.attempts,
        version: job.version,
      });
      const entity = (
        await drizzle
          .select({
            id: schema.entities.id,
            userId: schema.entities.userId,
            updatedAt: schema.entities.updatedAt,
            thumbnailVersion: schema.entities.thumbnailVersion,
            thumbnailStatus: schema.entities.thumbnailStatus,
          })
          .from(schema.entities)
          .where(eq(schema.entities.id, job.entityId))
      )[0] as unknown as
        | {
            id: string;
            userId: string;
            updatedAt: Date;
            thumbnailVersion?: string | null;
            thumbnailStatus?: string | null;
          }
        | undefined;

      if (!entity) {
        await drizzle
          .update(schema.thumbnailJobs)
          .set({ status: "stale", updatedAt: new Date() })
          .where(eq(schema.thumbnailJobs.id, job.id))
          .execute();
        logCron("job_stale_no_entity", {
          jobId: job.id,
          entityId: job.entityId,
        });
        stale++;
        continue;
      }

      // staleness
      if (
        // 1) Outdated job: entity changed after job creation
        (entity.updatedAt && entity.updatedAt > job.createdAt) ||
        // 2) Duplicate job: same version already marked ready
        (entity.thumbnailVersion === job.version &&
          entity.thumbnailStatus === "ready")
      ) {
        await drizzle
          .update(schema.thumbnailJobs)
          .set({ status: "stale", updatedAt: new Date() })
          .where(eq(schema.thumbnailJobs.id, job.id))
          .execute();
        logCron("job_stale_skipped", {
          jobId: job.id,
          entityId: job.entityId,
          entityVersion: entity.thumbnailVersion ?? null,
          jobVersion: job.version,
          entityUpdatedAt: (entity.updatedAt as Date)?.toISOString?.() ?? null,
          jobCreatedAt: (job.createdAt as Date)?.toISOString?.() ?? null,
          thumbnailStatus: (entity.thumbnailStatus as string) ?? null,
        });
        stale++;
        continue;
      }

      const attempts = (job.attempts ?? 0) + 1;
      const delay = backoffDelayMs(attempts);
      const next = new Date(Date.now() + delay);
      await drizzle
        .update(schema.thumbnailJobs)
        .set({
          status: "processing",
          attempts,
          nextRunAt: next,
          updatedAt: new Date(),
        })
        .where(eq(schema.thumbnailJobs.id, job.id))
        .execute();
      logCron("job_mark_processing", {
        jobId: job.id,
        attempts,
        nextRunAt: next.toISOString(),
      });

      // build screenshot URL
      const heads = await nextHeaders();
      const proto = heads.get("x-forwarded-proto") || "http";
      const host = heads.get("host") || "localhost:3000";
      const appBase = `${proto}://${host}`.replace(/\/$/, "");
      const token = createScreenshotToken({
        userId: entity.userId,
        entityId: entity.id,
        ttlMs: 3 * 60_000,
      });
      const targetW = 640;
      const targetH = 480;
      const pageUrl = `${appBase}/screenshot/documents/${encodeURIComponent(entity.id)}?st=${encodeURIComponent(token)}&width=${targetW}&height=${targetH}`;
      logCron("render_prepare", { jobId: job.id, pageUrl, targetW, targetH });

      if (!env.HEADLESS_RENDER_ENABLED || !env.HEADLESS_RENDER_URL) {
        throw new Error("HEADLESS_RENDER not configured");
      }

      const render = async (theme: "light" | "dark"): Promise<Uint8Array> => {
        const t = Date.now();
        logCron("render_start", { jobId: job.id, theme });
        const r = await fetch(`${env.HEADLESS_RENDER_URL}/api/screenshot`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: pageUrl,
            selector: `#screenshot-root`,
            viewport: { width: targetW, height: targetH, deviceScaleFactor: 2 },
            image: { type: "webp", quality: 92 },
            waitUntil: "networkidle2",
            timeoutMs: 15000,
            theme,
          }),
        });
        if (!r.ok) throw new Error(`screenshot ${theme} failed: ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        logCron("render_done", {
          jobId: job.id,
          theme,
          ms: Date.now() - t,
          bytes: buf.byteLength,
        });
        return buf;
      };

      const [light, dark] = await Promise.all([
        render("light"),
        render("dark"),
      ]);

      // upload
      const lightKey = `${entity.id}-light.webp`;
      const darkKey = `${entity.id}-dark.webp`;
      const upLight = await put(lightKey, new Blob([new Uint8Array(light)]), {
        access: "public",
        contentType: "image/webp",
        token: env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      logCron("upload_done", {
        jobId: job.id,
        theme: "light",
        key: lightKey,
        url: upLight.url,
      });
      const upDark = await put(darkKey, new Blob([new Uint8Array(dark)]), {
        access: "public",
        contentType: "image/webp",
        token: env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      logCron("upload_done", {
        jobId: job.id,
        theme: "dark",
        key: darkKey,
        url: upDark.url,
      });

      await drizzle
        .update(schema.entities)
        .set({
          screenShotLight: upLight.url,
          screenShotDark: upDark.url,
          thumbnailStatus: "ready",
          thumbnailUpdatedAt: new Date(),
          thumbnailVersion: job.version,
          updatedAt: new Date(),
        })
        .where(eq(schema.entities.id, entity.id))
        .execute();
      logCron("db_entity_updated", {
        jobId: job.id,
        entityId: entity.id,
        lightUrl: upLight.url,
        darkUrl: upDark.url,
        version: job.version,
      });

      await drizzle
        .update(schema.thumbnailJobs)
        .set({ status: "done", updatedAt: new Date() })
        .where(eq(schema.thumbnailJobs.id, job.id))
        .execute();

      processed++;
      logCron("job_done", { jobId: job.id, ms: Date.now() - t0 });
    } catch (e) {
      logCron("job_error", {
        jobId: job.id,
        error: (e as Error)?.message ?? String(e),
      });
      const attempts = (job.attempts ?? 0) + 1;
      const next = new Date(Date.now() + backoffDelayMs(attempts));
      await drizzle
        .update(schema.thumbnailJobs)
        .set({
          status: "error",
          attempts,
          nextRunAt: next,
          lastError: String((e as Error).message || e),
          updatedAt: new Date(),
        })
        .where(eq(schema.thumbnailJobs.id, job.id))
        .execute();
      failed++;
    }
  }

  logCron("batch_complete", { processed, failed, stale, picked: jobs.length });
  return NextResponse.json({ processed, failed, stale, picked: jobs.length });
}

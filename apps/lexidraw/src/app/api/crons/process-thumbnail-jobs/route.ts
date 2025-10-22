import { NextResponse, type NextRequest } from "next/server";
import { canRunCron } from "~/app/api/crons/cron-middleware";
import env from "@packages/env";
import { drizzle, eq, and, inArray, sql, schema } from "@packages/drizzle";
import { headers as nextHeaders } from "next/headers";
import { createScreenshotToken } from "~/server/auth/screenshot-token";
import { put } from "@vercel/blob";

export const dynamic = "force-dynamic";

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

  let processed = 0;
  let failed = 0;
  let stale = 0;

  for (const job of jobs) {
    const t0 = Date.now();
    try {
      const entity = (
        await drizzle
          .select()
          .from(schema.entities)
          .where(eq(schema.entities.id, job.entityId))
      )[0] as unknown as
        | {
            id: string;
            userId: string;
            updatedAt: Date;
            thumbnailVersion?: string | null;
          }
        | undefined;

      if (!entity) {
        await drizzle
          .update(schema.thumbnailJobs)
          .set({ status: "stale", updatedAt: new Date() })
          .where(eq(schema.thumbnailJobs.id, job.id))
          .execute();
        stale++;
        continue;
      }

      // staleness
      if (
        (entity.thumbnailVersion && entity.thumbnailVersion !== job.version) ||
        (entity.updatedAt && entity.updatedAt > job.createdAt)
      ) {
        await drizzle
          .update(schema.thumbnailJobs)
          .set({ status: "stale", updatedAt: new Date() })
          .where(eq(schema.thumbnailJobs.id, job.id))
          .execute();
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

      if (!env.HEADLESS_RENDER_ENABLED || !env.HEADLESS_RENDER_URL) {
        throw new Error("HEADLESS_RENDER not configured");
      }

      const render = async (theme: "light" | "dark"): Promise<Uint8Array> => {
        const r = await fetch(`${env.HEADLESS_RENDER_URL}/api/screenshot`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: pageUrl,
            viewport: { width: targetW, height: targetH, deviceScaleFactor: 2 },
            image: { type: "webp", quality: 92 },
            waitUntil: "networkidle2",
            timeoutMs: 15000,
            theme,
          }),
        });
        if (!r.ok) throw new Error(`screenshot ${theme} failed: ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        return buf;
      };

      const [light, dark] = await Promise.all([
        render("light"),
        render("dark"),
      ]);

      // upload
      const lightKey = `${entity.id}-light.webp`;
      const darkKey = `${entity.id}-dark.webp`;
      const upLight = await put(lightKey, light, {
        access: "public",
        contentType: "image/webp",
        token: env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
      });
      const upDark = await put(darkKey, dark, {
        access: "public",
        contentType: "image/webp",
        token: env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
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

      await drizzle
        .update(schema.thumbnailJobs)
        .set({ status: "done", updatedAt: new Date() })
        .where(eq(schema.thumbnailJobs.id, job.id))
        .execute();

      processed++;
      console.log("thumbnail_job_ok", { id: job.id, ms: Date.now() - t0 });
    } catch (e) {
      console.error("thumbnail_job_error", { id: job.id, error: e });
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

  return NextResponse.json({ processed, failed, stale, picked: jobs.length });
}

import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { auth } from "~/server/auth";
import { drizzle, schema, eq, and } from "@packages/drizzle";
import { precomputeTtsKey, synthesizeArticleOrText } from "~/server/tts/engine";
import { computeArticleKey } from "~/server/tts/id";
import { generateArticleTtsWorkflow } from "~/workflows/article-tts/generate-article-tts-workflow";
import { start } from "workflow/api";
import type { TtsRequest } from "~/server/tts/types";
import { htmlToPlainText } from "~/lib/html-to-text";
import env from "@packages/env";

export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as TtsRequest & {
    title?: string;
    entityId?: string;
  };

  // Merge user TTS defaults
  const ttsDefaults = session.user.config?.tts ?? {};
  const resolved = {
    provider: body.provider ?? ttsDefaults.provider ?? "openai",
    voiceId: body.voiceId ?? ttsDefaults.voiceId ?? "alloy",
    speed: body.speed ?? ttsDefaults.speed ?? 1,
    format: body.format ?? ttsDefaults.format ?? "mp3",
    languageCode: body.languageCode ?? ttsDefaults.languageCode ?? "en-US",
    sampleRate: session.user.config?.tts?.sampleRate ?? undefined,
  } as const;

  try {
    // Resolve source text: prefer explicit text, otherwise pull from entity.distilled
    let resolvedText = typeof body.text === "string" ? body.text : undefined;
    let entityType: "url" | "document" | undefined;
    if ((!resolvedText || resolvedText.trim() === "") && body.entityId) {
      try {
        const existing = await drizzle.query.entities.findFirst({
          where: (e) =>
            and(
              eq(e.id, body.entityId as string),
              eq(e.userId, session.user.id),
            ),
          columns: { entityType: true, elements: true },
        });
        if (existing) {
          entityType = existing.entityType as "url" | "document" | undefined;
          if (existing.elements) {
            const parsed = JSON.parse(existing.elements) as {
              distilled?: { contentHtml?: string };
            };
            const html = parsed?.distilled?.contentHtml ?? "";
            if (html) resolvedText = htmlToPlainText(html);
          }
        }
      } catch {
        // ignore DB errors; fallback to other sources
      }
    }

    // If entityId is provided and it's a URL entity, use workflow pattern
    if (body.entityId && entityType === "url" && resolvedText) {
      const articleKey = computeArticleKey(body.entityId, {
        provider: resolved.provider,
        voiceId: resolved.voiceId,
        speed: resolved.speed,
        format: resolved.format,
        languageCode: resolved.languageCode,
        sampleRate: resolved.sampleRate,
      });
      const manifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/article/${articleKey}/manifest.json`;

      // Check if job already exists and is ready
      const existing = await drizzle.query.ttsJobs.findFirst({
        where: (t) =>
          and(eq(t.id, articleKey), eq(t.entityId, body.entityId as string)),
      });
      if (existing?.status === "ready" && existing.manifestUrl) {
        const manifest = await fetch(existing.manifestUrl, {
          cache: "no-store",
        }).then((r) => r.json());
        return NextResponse.json({
          ...manifest,
          manifestUrl: existing.manifestUrl,
        });
      }

      // Upsert queued job
      await drizzle
        .insert(schema.ttsJobs)
        .values({
          id: articleKey,
          entityId: body.entityId,
          userId: session.user.id,
          status: "queued",
          ttsConfig: resolved as unknown as Record<string, unknown>,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.ttsJobs.id,
          set: { status: "queued", updatedAt: new Date() },
        })
        .execute();

      // Fire workflow (do not await full run)
      void start(generateArticleTtsWorkflow, [
        body.entityId,
        resolvedText,
        resolved,
      ]);

      return NextResponse.json(
        { id: articleKey, manifestUrl, status: "queued" },
        { status: 202 },
      );
    }

    // Fallback to legacy behavior for non-entity articles or when entityId not provided
    // Precompute job id + manifest url; if already exists, return immediately
    console.log("[tts][route] incoming", {
      hasUrl: !!body.url,
      textLen:
        typeof resolvedText === "string" ? resolvedText.length : undefined,
      provider: resolved.provider,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      format: resolved.format,
      languageCode: resolved.languageCode,
    });
    const { id, manifestUrl } = precomputeTtsKey({
      ...body,
      text: resolvedText,
      provider: resolved.provider,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      format: resolved.format,
      languageCode: resolved.languageCode,
    });
    const head = await fetch(manifestUrl, {
      method: "HEAD",
      cache: "no-store",
    });
    if (head.ok) {
      const manifest = await fetch(manifestUrl, { cache: "no-store" }).then(
        (r) => r.json(),
      );
      // Optionally persist to entity if provided
      if (body.entityId) {
        const existing = await drizzle.query.entities.findFirst({
          where: (e) =>
            and(
              eq(e.id, body.entityId as string),
              eq(e.userId, session.user.id),
            ),
        });
        if (existing?.elements) {
          try {
            const parsed = JSON.parse(existing.elements) as Record<
              string,
              unknown
            >;
            const next = {
              ...parsed,
              tts: {
                id: manifest.id ?? id,
                provider: manifest.provider,
                voiceId: manifest.voiceId,
                format: manifest.format,
                stitchedUrl: manifest.stitchedUrl ?? "",
                segments: manifest.segments ?? [],
                manifestUrl,
                updatedAt: new Date().toISOString(),
              },
            } satisfies Record<string, unknown>;
            await drizzle
              .update(schema.entities)
              .set({ elements: JSON.stringify(next), updatedAt: new Date() })
              .where(eq(schema.entities.id, body.entityId))
              .execute();
          } catch {
            // ignore persistence errors
          }
        }
      }
      return NextResponse.json({ ...manifest, manifestUrl });
    }

    // Kokoro: run synchronously so client can surface errors immediately
    if (resolved.provider === "kokoro") {
      try {
        const result = await synthesizeArticleOrText({
          url: body.url,
          text: resolvedText,
          provider: resolved.provider,
          voiceId: resolved.voiceId,
          speed: resolved.speed,
          format: resolved.format,
          languageCode: resolved.languageCode,
          titleHint: body.title,
        });
        if (body.entityId) {
          try {
            const existing = await drizzle.query.entities.findFirst({
              where: (e) =>
                and(
                  eq(e.id, body.entityId as string),
                  eq(e.userId, session.user.id),
                ),
            });
            if (existing?.elements) {
              const parsed = JSON.parse(existing.elements) as Record<
                string,
                unknown
              >;
              const next = {
                ...parsed,
                tts: {
                  id: result.id,
                  provider: result.provider,
                  voiceId: result.voiceId,
                  format: result.format,
                  stitchedUrl: result.stitchedUrl ?? "",
                  segments: result.segments,
                  manifestUrl: result.manifestUrl ?? "",
                  updatedAt: new Date().toISOString(),
                },
              } satisfies Record<string, unknown>;
              await drizzle
                .update(schema.entities)
                .set({ elements: JSON.stringify(next), updatedAt: new Date() })
                .where(eq(schema.entities.id, body.entityId))
                .execute();
            }
          } catch (e) {
            console.warn("[tts][route] kokoro persist error", e);
          }
        }
        return NextResponse.json({
          ...result,
          manifestUrl: result.manifestUrl ?? manifestUrl,
        });
      } catch (e) {
        const message = (e as Error)?.message || "Kokoro error";
        console.warn("[tts][route] kokoro immediate error", message);
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    // Otherwise, schedule background synthesis and return 202
    after(async () => {
      try {
        const result = await synthesizeArticleOrText({
          url: body.url,
          text: resolvedText,
          provider: resolved.provider,
          voiceId: resolved.voiceId,
          speed: resolved.speed,
          format: resolved.format,
          languageCode: resolved.languageCode,
          titleHint: body.title,
        });
        if (body.entityId) {
          const existing = await drizzle.query.entities.findFirst({
            where: (e) =>
              and(
                eq(e.id, body.entityId as string),
                eq(e.userId, session.user.id),
              ),
          });
          if (existing?.elements) {
            try {
              const parsed = JSON.parse(existing.elements) as Record<
                string,
                unknown
              >;
              const next = {
                ...parsed,
                tts: {
                  id: result.id,
                  provider: result.provider,
                  voiceId: result.voiceId,
                  format: result.format,
                  stitchedUrl: result.stitchedUrl ?? "",
                  segments: result.segments,
                  manifestUrl: result.manifestUrl ?? "",
                  updatedAt: new Date().toISOString(),
                },
              } satisfies Record<string, unknown>;
              await drizzle
                .update(schema.entities)
                .set({ elements: JSON.stringify(next), updatedAt: new Date() })
                .where(eq(schema.entities.id, body.entityId))
                .execute();
            } catch {
              // ignore persistence errors
            }
          }
        }
      } catch (e) {
        console.warn("[tts][route] background error", e);
      }
    });

    return NextResponse.json(
      { id, manifestUrl, status: "queued" },
      { status: 202 },
    );
  } catch (err) {
    console.warn("[tts][route] immediate error", err);
    const message = err instanceof Error ? err.message : "TTS error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

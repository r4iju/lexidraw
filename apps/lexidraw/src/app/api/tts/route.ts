import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { auth } from "~/server/auth";
import { drizzle, schema, eq, and } from "@packages/drizzle";
import { synthesizeArticleOrText, precomputeTtsKey } from "~/server/tts/engine";
import type { TtsRequest } from "~/server/tts/types";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as TtsRequest & {
    title?: string;
    entityId?: string;
  };

  const userKeys = {
    openaiApiKey: session.user.config?.llm?.openaiApiKey ?? null,
    googleApiKey: session.user.config?.llm?.googleApiKey ?? null,
  } as const;

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
    // Precompute job id + manifest url; if already exists, return immediately
    console.log("[tts][route] incoming", {
      hasUrl: !!body.url,
      textLen: typeof body.text === "string" ? body.text.length : undefined,
      provider: resolved.provider,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      format: resolved.format,
      languageCode: resolved.languageCode,
      hasUserGoogleKey: !!userKeys.googleApiKey,
      hasUserOpenaiKey: !!userKeys.openaiApiKey,
    });
    const { id, manifestUrl } = precomputeTtsKey({
      ...body,
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

    // Otherwise, schedule background synthesis and return 202
    after(async () => {
      try {
        const result = await synthesizeArticleOrText({
          url: body.url,
          text: body.text,
          provider: resolved.provider,
          voiceId: resolved.voiceId,
          speed: resolved.speed,
          format: resolved.format,
          languageCode: resolved.languageCode,
          titleHint: body.title,
          userKeys,
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

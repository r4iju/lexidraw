import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { auth } from "~/server/auth";
import { drizzle, schema, eq, and } from "@packages/drizzle";
import { generateDocumentTtsWorkflow } from "~/workflows/document-tts/generate-document-tts-workflow";
import { start } from "workflow/api";
import { computeDocKey } from "~/server/tts/id";
import env from "@packages/env";

export const maxDuration = 800;

function precomputeDocTtsKey(
  documentId: string,
  opts: {
    provider: string;
    voiceId: string;
    speed: number;
    format: string;
    languageCode: string;
    sampleRate?: number;
  },
) {
  const docKey = computeDocKey(documentId, {
    provider: opts.provider,
    voiceId: opts.voiceId,
    speed: opts.speed,
    format: opts.format as "mp3" | "ogg" | "wav",
    languageCode: opts.languageCode,
    sampleRate: opts.sampleRate,
  });
  const manifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/doc/${docKey}/manifest.json`;
  return { id: docKey, manifestUrl } as const;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resolvedParams = await params;
  const documentId = resolvedParams.documentId;

  const body = (await req.json()) as {
    markdown?: string;
    provider?: "openai" | "google" | "kokoro" | "apple_say" | "xtts";
    voiceId?: string;
    speed?: number;
    format?: "mp3" | "ogg" | "wav";
    languageCode?: string;
    title?: string;
  };

  if (!body.markdown) {
    return NextResponse.json(
      { error: "markdown is required" },
      { status: 400 },
    );
  }
  const markdown = String(body.markdown);

  // Verify document ownership
  try {
    const existing = await drizzle.query.entities.findFirst({
      where: (e) =>
        and(
          eq(e.id, documentId),
          eq(e.userId, session.user.id),
          eq(e.entityType, "document"),
        ),
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to verify document" },
      { status: 500 },
    );
  }

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
    console.log("[tts][route:document] incoming", {
      documentId,
      markdownLen: markdown.length,
      provider: resolved.provider,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      format: resolved.format,
      languageCode: resolved.languageCode,
    });

    const { id, manifestUrl } = precomputeDocTtsKey(documentId, {
      provider: resolved.provider,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      format: resolved.format,
      languageCode: resolved.languageCode,
      sampleRate: resolved.sampleRate,
    });

    // Check if manifest already exists
    const head = await fetch(manifestUrl, {
      method: "HEAD",
      cache: "no-store",
    });
    if (head.ok) {
      const manifest = await fetch(manifestUrl, { cache: "no-store" }).then(
        (r) => r.json(),
      );
      // Optionally persist to entity (best-effort)
      try {
        const existing = await drizzle.query.entities.findFirst({
          where: (e) =>
            and(eq(e.id, documentId), eq(e.userId, session.user.id)),
        });
        if (existing?.elements) {
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
            .where(eq(schema.entities.id, documentId))
            .execute();
        }
      } catch {}
      return NextResponse.json({ ...manifest, manifestUrl });
    }

    // Kokoro: run synchronously but orchestrated via workflow
    if (resolved.provider === "kokoro") {
      try {
        const run = await start(generateDocumentTtsWorkflow, [
          documentId,
          markdown,
          resolved,
        ]);
        // Await completion for synchronous response
        const { manifestUrl: mu, stitchedUrl } = await run.returnValue;
        // Best-effort read-back of manifest for immediate response
        let json: unknown = { stitchedUrl };
        try {
          const r = await fetch(mu, { cache: "no-store" });
          if (r.ok) json = await r.json();
        } catch {}
        return NextResponse.json({ ...(json as object), manifestUrl: mu });
      } catch (e) {
        const message = (e as Error)?.message || "Kokoro error";
        console.warn("[tts][route:document] kokoro immediate error", message);
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    // Otherwise, schedule background workflow run and return 202
    after(async () => {
      try {
        // Fire-and-forget: start workflow and return immediately
        void start(generateDocumentTtsWorkflow, [
          documentId,
          markdown,
          resolved,
        ]);
      } catch (e) {
        console.warn("[tts][route:document] background error", e);
      }
    });

    return NextResponse.json(
      { id, manifestUrl, status: "queued" },
      { status: 202 },
    );
  } catch (err) {
    console.warn("[tts][route:document] immediate error", err);
    const message = err instanceof Error ? err.message : "TTS error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

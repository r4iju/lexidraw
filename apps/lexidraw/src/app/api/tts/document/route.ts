import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { auth } from "~/server/auth";
import { extractArticleFromUrl } from "~/lib/extract-article";
import { synthesizeArticleOrText, precomputeTtsKey } from "~/server/tts/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 800; // 13 minutes 20 seconds

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    url?: string;
    text?: string;
    provider?: "google" | "openai";
    voiceId?: string;
    speed?: number;
    format?: "mp3" | "ogg" | "wav";
    languageCode?: string;
    title?: string;
  };

  if (!body.url && !body.text) {
    return NextResponse.json({ error: "Provide url or text" }, { status: 400 });
  }

  const userKeys = {
    openaiApiKey: session.user.config?.llm?.openaiApiKey ?? null,
    googleApiKey: session.user.config?.llm?.googleApiKey ?? null,
  } as const;

  // Merge user TTS defaults
  const ttsDefaults = session.user.config?.tts ?? {};
  const articleDefaults = session.user.config?.articles ?? {};
  const resolved = {
    provider: body.provider ?? ttsDefaults.provider ?? "openai",
    voiceId: body.voiceId ?? ttsDefaults.voiceId ?? "alloy",
    speed: body.speed ?? ttsDefaults.speed ?? 1,
    format: body.format ?? ttsDefaults.format ?? "mp3",
    languageCode:
      body.languageCode ??
      ttsDefaults.languageCode ??
      articleDefaults.languageCode ??
      "en-US",
    sampleRate: session.user.config?.tts?.sampleRate ?? undefined,
  } as const;

  try {
    const { id, manifestUrl } = precomputeTtsKey({
      url: body.url,
      text: body.text,
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
      return NextResponse.json({ ...manifest, manifestUrl });
    }

    after(async () => {
      try {
        const text = body.text
          ? body.text
          : body.url
            ? (
                await extractArticleFromUrl(body.url, {
                  maxChars: articleDefaults.maxChars,
                  keepQuotes: articleDefaults.keepQuotes,
                })
              ).contentText
            : "";
        await synthesizeArticleOrText({
          url: body.url,
          text,
          provider: resolved.provider,
          voiceId: resolved.voiceId,
          speed: resolved.speed,
          format: resolved.format,
          languageCode: resolved.languageCode,
          titleHint: body.title,
          userKeys,
        });
      } catch {
        // swallow background failures
      }
    });
    return NextResponse.json(
      { id, manifestUrl, status: "queued" },
      { status: 202 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

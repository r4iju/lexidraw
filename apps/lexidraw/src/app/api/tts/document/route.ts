import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { auth } from "~/server/auth";
import { extractArticleFromUrl } from "~/lib/extract-article";
import { synthesizeArticleOrText, precomputeTtsKey } from "~/server/tts/engine";

export const maxDuration = 800;

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
    console.log("[tts][route:document] incoming", {
      hasUrl: !!body.url,
      textLen: typeof body.text === "string" ? body.text.length : undefined,
      provider: resolved.provider,
      voiceId: resolved.voiceId,
      speed: resolved.speed,
      format: resolved.format,
      languageCode: resolved.languageCode,
    });
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
        });
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

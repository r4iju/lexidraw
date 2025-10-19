import type { NextRequest } from "next/server";
import { NextResponse, after } from "next/server";
import { auth } from "~/server/auth";
import { extractDocumentFromUrl } from "~/lib/extract-document";
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

  try {
    const { id, manifestUrl } = precomputeTtsKey({
      url: body.url,
      text: body.text,
      provider: body.provider,
      voiceId: body.voiceId,
      speed: body.speed,
      format: body.format,
      languageCode: body.languageCode,
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
            ? (await extractDocumentFromUrl(body.url)).contentText
            : "";
        await synthesizeArticleOrText({
          ...body,
          text,
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

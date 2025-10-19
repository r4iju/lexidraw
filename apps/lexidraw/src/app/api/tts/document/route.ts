import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { extractDocumentFromUrl } from "~/lib/extract-document";
import { synthesizeArticleOrText } from "~/server/tts/engine";

export const dynamic = "force-dynamic";

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
    const text = body.text
      ? body.text
      : body.url
        ? (await extractDocumentFromUrl(body.url)).contentText
        : "";
    const result = await synthesizeArticleOrText({
      ...body,
      text,
      titleHint: body.title,
      userKeys,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

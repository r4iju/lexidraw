import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "~/server/auth";
import { drizzle, schema, eq, and } from "@packages/drizzle";
import { synthesizeArticleOrText } from "~/server/tts/engine";
import type { TtsRequest } from "~/server/tts/types";

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

  try {
    const result = await synthesizeArticleOrText({
      ...body,
      titleHint: body.title,
      userKeys,
    });
    // optional persistence: store in entity elements if entityId provided and user owns it
    if (body.entityId) {
      const existing = await drizzle.query.entities.findFirst({
        where: (e) =>
          and(eq(e.id, body.entityId as string), eq(e.userId, session.user.id)),
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
          // ignore persistence errors; respond with result
        }
      }
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

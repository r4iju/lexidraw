import type { TtsResult } from "~/server/tts/types";
import { drizzle, schema, eq, and } from "@packages/drizzle";

export async function persistToEntityStep(
  documentId: string,
  result: TtsResult & { manifestUrl?: string },
): Promise<void> {
  "use step";
  const existing = await drizzle.query.entities.findFirst({
    where: (e) => and(eq(e.id, documentId), eq(e.entityType, "document")),
  });
  if (!existing?.elements) return;
  const parsed = JSON.parse(existing.elements) as Record<string, unknown>;
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
    .where(eq(schema.entities.id, documentId))
    .execute();
}

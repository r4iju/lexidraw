import { put } from "@vercel/blob";
import env from "@packages/env";
import { chunkPathOf, planPathOf } from "~/server/tts/parts";

/**
 * Publishes the parts a run will make, in order, each with where its audio
 * will be, so a listener can start on the first while the rest are made.
 */
export async function publishPlanStep(
  key: string,
  runId: string,
  format: "mp3" | "ogg" | "wav",
  planned: Array<{
    index: number;
    text: string;
    chunkHash: string;
    sectionTitle?: string;
    sectionIndex?: number;
    headingDepth?: number;
    sectionId?: string;
  }>,
): Promise<void> {
  "use step";
  const segments = planned.map((p) => ({
    index: p.index,
    text: p.text,
    audioUrl: `${env.VERCEL_BLOB_STORAGE_HOST}/${chunkPathOf(p.chunkHash, format)}`,
    sectionTitle: p.sectionTitle,
    sectionIndex: p.sectionIndex,
    headingDepth: p.headingDepth,
    sectionId: p.sectionId,
    chunkHash: p.chunkHash,
  }));
  await put(planPathOf(key, runId), JSON.stringify({ segments }), {
    access: "public",
    contentType: "application/json",
    allowOverwrite: true,
  });
}

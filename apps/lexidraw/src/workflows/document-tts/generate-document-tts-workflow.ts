import "server-only";

// This workflow coordinates durable TTS generation using plan → synthesize chunks → finalize → persist.
// Steps are written to be idempotent and safe to retry.

import { planChunksStep } from "./plan-chunks-step";
import { chooseProvider } from "./common";
import { ensureChunkSynthesizedStep } from "./ensure-chunk-synthesized-step";
import { updateJobStatusStep } from "./update-job-status-step";
import { updateProgressStep } from "./update-progress-step";
import { finalizeManifestStep } from "./finalize-manifest-step";
import { markJobReadyStep } from "./mark-job-ready-step";
import { persistToEntityStep } from "./persist-to-entity-step";
import { markJobErrorStep } from "./mark-job-error-step";

function slugifySection(title: string | undefined, index: number): string {
  const base = (title || "untitled").toLowerCase().trim();
  const slug = base
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug || "section"}-${index}`;
}

export type TtsConfig = {
  provider: string;
  voiceId: string;
  speed: number;
  format: "mp3" | "ogg" | "wav";
  languageCode?: string;
  sampleRate?: number;
};

export async function generateDocumentTtsWorkflow(
  documentId: string,
  markdown: string,
  tts: TtsConfig,
): Promise<{ manifestUrl: string; stitchedUrl?: string }> {
  "use workflow";
  let docKey = "";
  try {
    console.log("[tts][wf] start", {
      documentId,
      markdownLen: markdown.length,
      provider: tts.provider,
      voiceId: tts.voiceId,
      speed: tts.speed,
      format: tts.format,
      languageCode: tts.languageCode,
    });

    const plannedResult = await planChunksStep(documentId, markdown, tts);
    docKey = plannedResult.docKey;
    const planned = plannedResult.planned;
    console.log("[tts][wf] planned", {
      docKey,
      plannedCount: planned.length,
      firstHashes: planned.slice(0, 3).map((p) => p.chunkHash),
    });

    await updateJobStatusStep(docKey, documentId, "processing", planned.length); // documentId is entityId for documents

    const results: Array<{
      index: number;
      sectionTitle?: string;
      sectionIndex?: number;
      headingDepth?: number;
      sectionId?: string;
      audioUrl: string;
      text: string;
      chunkHash: string;
    }> = [];

    const BATCH = Number(process.env.TTS_WORKFLOW_BATCH_SIZE ?? "4");
    for (let i = 0; i < planned.length; i += BATCH) {
      const slice = planned.slice(i, i + BATCH);
      const batch = await Promise.allSettled(
        slice.map((p) =>
          ensureChunkSynthesizedStep({
            ...p,
            format: tts.format,
            provider: tts.provider,
            voiceId: tts.voiceId,
            speed: tts.speed,
            languageCode: tts.languageCode,
            sampleRate: tts.sampleRate,
            sectionId: slugifySection(p.sectionTitle, p.sectionIndex ?? 0),
          }),
        ),
      );
      const successes = batch
        .filter(
          (r): r is PromiseFulfilledResult<(typeof results)[number]> =>
            r.status === "fulfilled",
        )
        .map((r) => r.value);
      if (successes.length === 0) {
        throw new Error(
          `All chunks in batch ${i}-${Math.min(i + BATCH - 1, planned.length - 1)} failed`,
        );
      }
      results.push(...successes);
      // Update progress after each batch completes
      await updateProgressStep(docKey, results.length);
    }

    const { manifestUrl, stitchedUrl } = await finalizeManifestStep(
      docKey,
      tts,
      results,
    );

    // Mark job ready
    await markJobReadyStep(docKey, {
      manifestUrl,
      stitchedUrl: stitchedUrl ?? null,
      segmentCount: results.length,
    });

    await persistToEntityStep(documentId, {
      id: docKey,
      provider: chooseProvider(tts.provider, tts.languageCode),
      voiceId: tts.voiceId,
      format: tts.format,
      segments: results.map((r) => ({
        index: r.index,
        text: r.text,
        audioUrl: r.audioUrl,
        sectionTitle: r.sectionTitle,
        sectionIndex: r.sectionIndex,
        headingDepth: r.headingDepth,
        sectionId: r.sectionId,
        // durationSec not available synchronously; omitted
      })),
      totalChars: results.reduce((s, r) => s + r.text.length, 0),
      stitchedUrl,
      manifestUrl,
    });

    return { manifestUrl, stitchedUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (docKey) {
      await markJobErrorStep(docKey, message);
    }
    throw err;
  }
}

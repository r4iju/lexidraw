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
import { publishPlanStep } from "./publish-plan-step";
import { runIsCurrentStep } from "./run-is-current-step";

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
  runId: string,
): Promise<{ manifestUrl: string; stitchedUrl?: string } | undefined> {
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

    if (!(await runIsCurrentStep(docKey, runId))) return undefined;
    await publishPlanStep(
      docKey,
      runId,
      tts.format,
      planned.map((p) => ({
        ...p,
        sectionId: slugifySection(p.sectionTitle, p.sectionIndex ?? 0),
      })),
    );
    await updateJobStatusStep(docKey, runId, "processing", planned.length);

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

    // Parts are made in order, a batch at a time, so the parts made are
    // always the first ones; the first two alone, so listening starts on the
    // first while the second is made.
    const BATCH = Number(process.env.TTS_WORKFLOW_BATCH_SIZE ?? "4");
    for (let i = 0; i < planned.length; ) {
      const size = i < 2 ? 1 : BATCH;
      if (i > 0 && !(await runIsCurrentStep(docKey, runId))) return undefined;
      const slice = planned.slice(i, i + size);
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
      // A part left out would be silence in the middle of the reading, so
      // one that can't be made fails the job; parts made are kept for the
      // next run.
      const reasons = batch
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) =>
          r.reason instanceof Error ? r.reason.message : String(r.reason),
        );
      if (reasons.length > 0) {
        throw new Error(
          `Could not make ${reasons.length} of chunks ${i}-${Math.min(i + size - 1, planned.length - 1)}: ${[...new Set(reasons)].join("; ")}`,
        );
      }
      const successes = batch.map(
        (r) => (r as PromiseFulfilledResult<(typeof results)[number]>).value,
      );
      results.push(...successes);
      await updateProgressStep(docKey, runId, results.length);
      i += size;
    }

    const { manifestUrl, stitchedUrl } = await finalizeManifestStep(
      docKey,
      tts,
      results,
    );

    // Mark job ready
    await markJobReadyStep(docKey, runId, {
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
      await markJobErrorStep(docKey, runId, message);
    }
    throw err;
  }
}

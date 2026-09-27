import "server-only";

// This workflow coordinates durable TTS generation for articles using plan → synthesize chunks → finalize → persist.
// Steps are written to be idempotent and safe to retry.

import { planChunksStep } from "./plan-chunks-step";
import { chooseProvider } from "../document-tts/common";
import { ensureChunkSynthesizedStep } from "../document-tts/ensure-chunk-synthesized-step";
import { updateJobStatusStep } from "../document-tts/update-job-status-step";
import { updateProgressStep } from "../document-tts/update-progress-step";
import { finalizeManifestStep } from "./finalize-manifest-step";
import { markJobReadyStep } from "../document-tts/mark-job-ready-step";
import { markJobErrorStep } from "../document-tts/mark-job-error-step";
import { publishPlanStep } from "../document-tts/publish-plan-step";
import { runIsCurrentStep } from "../document-tts/run-is-current-step";
import { persistToEntityStep } from "./persist-to-entity-step";

export type TtsConfig = {
  provider: string;
  voiceId: string;
  speed: number;
  format: "mp3" | "ogg" | "wav";
  languageCode?: string;
  sampleRate?: number;
};

export async function generateArticleTtsWorkflow(
  articleId: string,
  plainText: string,
  htmlContent: string | undefined,
  tts: TtsConfig,
  runId: string,
): Promise<{ manifestUrl: string; stitchedUrl?: string } | undefined> {
  "use workflow";
  let articleKey = "";
  try {
    console.log("[tts][wf][article] start", {
      articleId,
      textLen: plainText.length,
      htmlLen: htmlContent?.length ?? 0,
      provider: tts.provider,
      voiceId: tts.voiceId,
      speed: tts.speed,
      format: tts.format,
      languageCode: tts.languageCode,
    });

    const plannedResult = await planChunksStep(
      articleId,
      plainText,
      htmlContent,
      tts,
    );
    articleKey = plannedResult.articleKey;
    const planned = plannedResult.planned;
    console.log("[tts][wf][article] planned", {
      articleKey,
      plannedCount: planned.length,
      firstHashes: planned.slice(0, 3).map((p) => p.chunkHash),
    });

    if (!(await runIsCurrentStep(articleKey, runId))) return undefined;
    await publishPlanStep(articleKey, runId, tts.format, planned);
    await updateJobStatusStep(articleKey, runId, "processing", planned.length);

    const results: Array<{
      index: number;
      audioUrl: string;
      text: string;
      chunkHash: string;
      sectionTitle?: string;
      sectionIndex?: number;
      headingDepth?: number;
    }> = [];

    // Parts are made in order, a batch at a time, so the parts made are
    // always the first ones; the first two alone, so listening starts on the
    // first while the second is made.
    const BATCH = Number(process.env.TTS_WORKFLOW_BATCH_SIZE ?? "4");
    for (let i = 0; i < planned.length; ) {
      const size = i < 2 ? 1 : BATCH;
      if (i > 0 && !(await runIsCurrentStep(articleKey, runId)))
        return undefined;
      const slice = planned.slice(i, i + size);
      const batch = await Promise.allSettled(
        slice.map((p) =>
          ensureChunkSynthesizedStep({
            index: p.index,
            text: p.text,
            normalizedText: p.normalizedText,
            chunkHash: p.chunkHash,
            format: tts.format,
            provider: tts.provider,
            voiceId: tts.voiceId,
            speed: tts.speed,
            languageCode: tts.languageCode,
            sampleRate: tts.sampleRate,
            sectionTitle: p.sectionTitle,
            sectionIndex: p.sectionIndex,
            headingDepth: p.headingDepth,
            sectionId: undefined,
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
      await updateProgressStep(articleKey, runId, results.length);
      i += size;
    }

    const { manifestUrl, stitchedUrl } = await finalizeManifestStep(
      articleKey,
      tts,
      results,
    );

    await markJobReadyStep(articleKey, runId, {
      manifestUrl,
      stitchedUrl: stitchedUrl ?? null,
      segmentCount: results.length,
    });

    await persistToEntityStep(articleId, {
      id: articleKey,
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
      })),
      totalChars: results.reduce((s, r) => s + r.text.length, 0),
      stitchedUrl,
      manifestUrl,
    });

    return { manifestUrl, stitchedUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[tts][wf][article] failed", {
      articleId,
      articleKey,
      error: message,
    });
    if (articleKey) {
      await markJobErrorStep(articleKey, runId, message);
    }
    throw err;
  }
}

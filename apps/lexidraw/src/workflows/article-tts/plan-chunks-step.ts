import "server-only";
import { chunkTextByParagraphs } from "~/lib/chunk-text";
import { normalizeForTts } from "~/lib/markdown-for-tts";
import type { TtsConfig } from "../document-tts/generate-document-tts-workflow";
import { chooseProvider } from "../document-tts/common";

export type ArticleChunk = {
  index: number;
  text: string;
};

export async function planChunksStep(
  articleId: string,
  plainText: string,
  tts: TtsConfig,
): Promise<{
  articleKey: string;
  planned: Array<ArticleChunk & { normalizedText: string; chunkHash: string }>;
}> {
  "use step";
  // Import Node.js crypto-dependent functions inside the step
  const { computeArticleKey, computeChunkHash } = await import(
    "~/server/tts/id"
  );

  const providerName = chooseProvider(tts.provider, tts.languageCode);
  const voiceId =
    tts.voiceId ?? (providerName === "google" ? "en-US-Standard-C" : "alloy");
  // IMPORTANT: articleKey must match API precomputeArticleTtsKey which hashes the REQUESTED provider string
  // (e.g., "apple_say"), not the mapped internal providerName (e.g., "kokoro").
  const articleKey = computeArticleKey(articleId, {
    provider: tts.provider,
    voiceId,
    speed: tts.speed,
    format: tts.format,
    languageCode: tts.languageCode,
    sampleRate: tts.sampleRate,
  });

  const chunks = chunkTextByParagraphs(plainText, {
    targetSize: 1400,
    hardCap: 4000,
  });

  const planned = chunks.map((c) => {
    const normalizedText = normalizeForTts(c.text);
    const chunkHash = computeChunkHash(normalizedText, {
      provider: providerName,
      voiceId,
      speed: tts.speed,
      format: tts.format,
      languageCode: tts.languageCode ?? "",
      sampleRate: tts.sampleRate,
    });
    return { ...c, normalizedText, chunkHash };
  });
  return { articleKey, planned };
}

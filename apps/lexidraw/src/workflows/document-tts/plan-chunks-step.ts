import {
  chunkSections,
  type DocChunk,
  normalizeForTts,
  sanitizeMarkdownForTts,
  splitMarkdownIntoSections,
} from "~/lib/markdown-for-tts";
import type { TtsConfig } from "./generate-document-tts-workflow";
import { chooseProvider } from "./common";

export async function planChunksStep(
  documentId: string,
  markdown: string,
  tts: TtsConfig,
): Promise<{
  docKey: string;
  planned: Array<DocChunk & { normalizedText: string; chunkHash: string }>;
}> {
  "use step";
  // Import Node.js crypto-dependent functions inside the step
  const { computeDocKey, computeChunkHash } = await import("~/server/tts/id");

  const providerName = chooseProvider(tts.provider, tts.languageCode);
  const voiceId =
    tts.voiceId ?? (providerName === "google" ? "en-US-Standard-C" : "alloy");
  // IMPORTANT: docKey must match API precomputeDocTtsKey which hashes the REQUESTED provider string
  // (e.g., "apple_say"), not the mapped internal providerName (e.g., "kokoro").
  const docKey = computeDocKey(documentId, {
    provider: tts.provider,
    voiceId,
    speed: tts.speed,
    format: tts.format,
    languageCode: tts.languageCode,
    sampleRate: tts.sampleRate,
  });

  const sanitized = sanitizeMarkdownForTts(markdown);
  const sections = splitMarkdownIntoSections(sanitized);
  const chunks = chunkSections(sections, { targetSize: 1400, hardCap: 4000 });

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
  return { docKey, planned };
}

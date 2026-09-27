import "server-only";
import {
  chunkSections,
  htmlToSpeechText,
  normalizeForTts,
  splitHtmlIntoSections,
} from "~/lib/markdown-for-tts";
import type { TtsConfig } from "../document-tts/generate-document-tts-workflow";
import { chooseProvider } from "../document-tts/common";
import { defaultVoice } from "~/app/settings/schema";

export type ArticleChunk = {
  index: number;
  text: string;
  sectionTitle?: string;
  sectionIndex?: number;
  headingDepth?: number;
};

export async function planChunksStep(
  articleId: string,
  plainText: string,
  htmlContent: string | undefined,
  tts: TtsConfig,
): Promise<{
  articleKey: string;
  planned: Array<
    ArticleChunk & {
      normalizedText: string;
      chunkHash: string;
      sectionTitle?: string;
      sectionIndex?: number;
      headingDepth?: number;
    }
  >;
}> {
  "use step";
  // Import Node.js crypto-dependent functions inside the step
  const { computeArticleKey, computeChunkHash } = await import(
    "~/server/tts/id"
  );

  const providerName = chooseProvider(tts.provider, tts.languageCode);
  const voiceId = tts.voiceId ?? defaultVoice(providerName, tts.languageCode);
  // IMPORTANT: articleKey must match API precomputeArticleTtsKey which hashes the REQUESTED provider string
  // (unset means auto), not the providerName that chooseProvider resolves.
  const articleKey = computeArticleKey(articleId, {
    provider: tts.provider,
    voiceId,
    speed: tts.speed,
    format: tts.format,
    languageCode: tts.languageCode,
    sampleRate: tts.sampleRate,
  });

  const hardCap = 4000;

  // Sections by heading when the article has its HTML, else the text whole.
  const sections = htmlContent
    ? splitHtmlIntoSections(htmlContent).map((section) => ({
        ...section,
        title: section.title && htmlToSpeechText(section.title),
        body: htmlToSpeechText(section.body),
      }))
    : [{ title: undefined, depth: 0, body: plainText, index: 0 }];
  const chunks: ArticleChunk[] = chunkSections(sections, { hardCap });

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
    return {
      ...c,
      normalizedText,
      chunkHash,
    };
  });
  return { articleKey, planned };
}

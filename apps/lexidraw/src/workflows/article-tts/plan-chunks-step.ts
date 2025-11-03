import "server-only";
import { chunkTextByParagraphs } from "~/lib/chunk-text";
import {
  normalizeForTts,
  splitHtmlIntoSections,
  chunkSections,
} from "~/lib/markdown-for-tts";
import { htmlToPlainText } from "~/lib/html-to-text";
import type { TtsConfig } from "../document-tts/generate-document-tts-workflow";
import { chooseProvider } from "../document-tts/common";

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

  let chunks: Array<{
    index: number;
    text: string;
    sectionTitle?: string;
    sectionIndex?: number;
    headingDepth?: number;
  }>;

  if (htmlContent) {
    // Extract sections from HTML
    const htmlSections = splitHtmlIntoSections(htmlContent);

    if (htmlSections.length > 0 && htmlSections[0]?.title !== undefined) {
      // Convert HTML sections to markdown-like sections with plain text
      const sections = htmlSections.map((section) => ({
        title: section.title,
        depth: section.depth,
        body: htmlToPlainText(section.body),
        index: section.index,
      }));

      // Chunk sections (this will create chunks with section metadata)
      const docChunks = chunkSections(sections, {
        targetSize: 1400,
        hardCap: 4000,
      });

      chunks = docChunks.map((c) => ({
        index: c.index,
        text: c.text,
        sectionTitle: c.sectionTitle,
        sectionIndex: c.sectionIndex,
        headingDepth: c.headingDepth,
      }));
    } else {
      // No sections found, fall back to plain text chunking
      const textChunks = chunkTextByParagraphs(plainText, {
        targetSize: 1400,
        hardCap: 4000,
      });
      chunks = textChunks.map((c) => ({
        index: c.index,
        text: c.text,
      }));
    }
  } else {
    // No HTML provided, use plain text chunking
    const textChunks = chunkTextByParagraphs(plainText, {
      targetSize: 1400,
      hardCap: 4000,
    });
    chunks = textChunks.map((c) => ({
      index: c.index,
      text: c.text,
    }));
  }

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

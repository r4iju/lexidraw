import { put } from "@vercel/blob";
import { createGoogleTtsProvider } from "~/server/tts/providers/google";
import { chooseProvider } from "./common";
import { createKokoroTtsProvider } from "~/server/tts/providers/kokoro";
import { createOpenAiTtsProvider } from "~/server/tts/providers/openai";
import env from "@packages/env";
import { buildSsmlFromParagraphs } from "~/lib/ssml";

export async function ensureChunkSynthesizedStep(args: {
  index: number;
  sectionTitle?: string;
  sectionIndex?: number;
  headingDepth?: number;
  sectionId?: string;
  text: string;
  normalizedText: string;
  chunkHash: string;
  provider: string;
  voiceId: string;
  speed: number;
  format: "mp3" | "ogg" | "wav";
  languageCode?: string;
  sampleRate?: number;
}): Promise<{
  index: number;
  sectionTitle?: string;
  sectionIndex?: number;
  headingDepth?: number;
  sectionId?: string;
  audioUrl: string;
  text: string;
  chunkHash: string;
}> {
  "use step";
  const providerName = chooseProvider(args.provider, args.languageCode);
  const provider =
    providerName === "google"
      ? createGoogleTtsProvider(env.GOOGLE_API_KEY)
      : providerName === "kokoro"
        ? createKokoroTtsProvider(env.KOKORO_URL ?? "", env.KOKORO_BEARER)
        : createOpenAiTtsProvider(env.OPENAI_API_KEY);
  console.log("[tts][wf][chunk] begin", {
    index: args.index,
    hash: args.chunkHash,
    provider: providerName,
  });

  const ssml = provider.supportsSsml
    ? buildSsmlFromParagraphs(args.text, {
        rate: args.speed,
        languageCode: args.languageCode,
      })
    : undefined;

  // Strip markdown heading syntax (## Heading -> Heading) for non-SSML providers
  const textForTts = ssml
    ? args.text // SSML already handles headings
    : args.text.replace(/^(#{1,6})\s+(.+)$/gm, "$2");

  const segmentFormat: "mp3" | "ogg" | "wav" =
    process.env.TTS_STITCH_WITH_FFMPEG === "true" ? "wav" : args.format;

  // Destination path (idempotent via 'already exists' handling below)
  const path = `tts/chunks/${args.chunkHash}.${segmentFormat}`;
  const existingUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/${path}`;

  // Synthesize (let Workflow default retries handle errors)
  const { audio } = await provider.synthesize({
    textOrSsml: ssml ?? textForTts,
    voiceId: args.voiceId,
    speed: args.speed,
    format: args.format,
    languageCode: args.languageCode,
    sampleRate: args.sampleRate,
    metadata: { requestedProvider: args.provider ?? "" },
  });

  // Upload
  const contentType = (() => {
    switch (args.format) {
      case "mp3":
        return "audio/mpeg";
      case "ogg":
        return "audio/ogg";
      case "wav":
        return "audio/wav";
      default:
        return "audio/mpeg";
    }
  })();
  // Reuse if already uploaded
  const head = await fetch(existingUrl, { method: "HEAD" }).catch(
    () => undefined,
  );
  if (head?.ok) {
    console.log("[tts][wf][chunk] reuse", {
      index: args.index,
      hash: args.chunkHash,
    });
    return {
      index: args.index,
      sectionTitle: args.sectionTitle,
      sectionIndex: args.sectionIndex,
      headingDepth: args.headingDepth,
      sectionId: args.sectionId,
      audioUrl: existingUrl,
      text: args.text,
      chunkHash: args.chunkHash,
    };
  }

  const { url } = await put(path, audio, {
    access: "public",
    contentType,
    allowOverwrite: true,
  });
  console.log("[tts][wf][chunk] uploaded", {
    index: args.index,
    hash: args.chunkHash,
    url,
  });
  return {
    index: args.index,
    sectionTitle: args.sectionTitle,
    sectionIndex: args.sectionIndex,
    headingDepth: args.headingDepth,
    sectionId: args.sectionId,
    audioUrl: url,
    text: args.text,
    chunkHash: args.chunkHash,
  };
}

// Increase retries for TTS synthesis (can be flaky)
ensureChunkSynthesizedStep.maxRetries = 5;

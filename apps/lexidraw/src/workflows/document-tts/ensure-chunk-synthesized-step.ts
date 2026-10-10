import { FatalError } from "workflow";
import { NARRATION_UNAVAILABLE } from "~/lib/narration/contracts";
import env from "@packages/env";
import { chunkPathOf } from "~/server/tts/parts";
import { blobExists } from "~/server/tts/blob-exists";

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
  const path = chunkPathOf(args.chunkHash, args.format);
  const existingUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/${path}`;

  // Checked before a provider is paid, since any run in the same voice may
  // have made this chunk already.
  if (await blobExists(existingUrl)) {
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

  throw new FatalError(NARRATION_UNAVAILABLE);
}

ensureChunkSynthesizedStep.maxRetries = 1;

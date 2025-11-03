import type { TtsResult } from "~/server/tts/types";
import { chooseProvider } from "../document-tts/common";
import type { TtsConfig } from "../document-tts/generate-document-tts-workflow";
import { put } from "@vercel/blob";
import env from "@packages/env";

export async function finalizeManifestStep(
  articleKey: string,
  tts: TtsConfig,
  results: Array<{
    index: number;
    audioUrl: string;
    text: string;
    chunkHash: string;
  }>,
): Promise<{ manifestUrl: string; stitchedUrl?: string }> {
  "use step";

  const ordered = [...results].sort((a, b) => a.index - b.index);
  let stitchedUrl: string | undefined;
  const fullUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/article/${articleKey}/full.${tts.format}`;
  const headFull = await fetch(fullUrl, { method: "HEAD" }).catch(
    () => undefined,
  );
  if (headFull?.ok) {
    stitchedUrl = fullUrl;
    console.log("[tts][wf][article] stitched exists", { fullUrl });
  }

  const manifest = {
    id: articleKey,
    provider: chooseProvider(tts.provider, tts.languageCode),
    voiceId: tts.voiceId,
    format: tts.format,
    segments: ordered.map((s) => ({
      index: s.index,
      text: s.text,
      audioUrl: s.audioUrl,
      chunkHash: s.chunkHash,
    })),
    totalChars: ordered.reduce((sum, s) => sum + s.text.length, 0),
    title: undefined as string | undefined,
    stitchedUrl,
  } satisfies TtsResult;

  const manifestPath = `tts/article/${articleKey}/manifest.json`;
  const manifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/${manifestPath}`;
  const headManifest = await fetch(manifestUrl, { method: "HEAD" }).catch(
    () => undefined,
  );
  if (!headManifest?.ok) {
    await put(manifestPath, Buffer.from(JSON.stringify(manifest), "utf-8"), {
      access: "public",
      contentType: "application/json",
    });
    console.log("[tts][wf][article] manifest written", { manifestUrl });
  }

  return { manifestUrl, stitchedUrl };
}

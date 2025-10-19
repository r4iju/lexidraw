import "server-only";
import crypto from "node:crypto";
import { put } from "@vercel/blob";
import env from "@packages/env";
import { extractArticleFromUrl } from "~/lib/extract-article";
import { chunkTextByParagraphs } from "~/lib/chunk-text";
import { buildSsmlFromParagraphs } from "~/lib/ssml";
import type {
  TtsRequest,
  TtsResult,
  TtsProviderName,
  UserProviderKeys,
} from "./types";
import { createOpenAiTtsProvider } from "./providers/openai";
import { createGoogleTtsProvider } from "./providers/google";

type ChooseProviderArgs = {
  requested?: TtsProviderName;
  languageCode?: string;
};

function chooseProvider({
  requested,
  languageCode,
}: ChooseProviderArgs): TtsProviderName {
  if (requested) return requested;
  if (languageCode && !languageCode.startsWith("en")) return "google";
  return "openai";
}

function stableHash(
  parts: (string | number | boolean | null | undefined)[],
): string {
  const h = crypto.createHash("sha256");
  for (const p of parts) {
    h.update(String(p ?? ""));
    h.update("\u0000");
  }
  return h.digest("hex");
}

export function precomputeTtsKey(req: TtsRequest) {
  const providerName = chooseProvider({
    requested: req.provider,
    languageCode: req.languageCode,
  });
  const format = req.format ?? "mp3";
  const voiceId =
    req.voiceId ?? (providerName === "google" ? "en-US-Standard-C" : "alloy");
  const speed = req.speed ?? 1.0;

  const discriminator = req.url || (req.text ? req.text.slice(0, 8192) : "");
  const key = stableHash([
    discriminator,
    providerName,
    voiceId,
    speed,
    format,
    req.languageCode ?? "",
  ]);
  const manifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/${key}/manifest.json`;
  return { id: key, manifestUrl } as const;
}

export async function synthesizeArticleOrText(
  req: TtsRequest & { userKeys: UserProviderKeys; titleHint?: string },
): Promise<TtsResult> {
  const providerName = chooseProvider({
    requested: req.provider,
    languageCode: req.languageCode,
  });
  const format = req.format ?? "mp3";
  const voiceId =
    req.voiceId ?? (providerName === "google" ? "en-US-Standard-C" : "alloy");
  const speed = req.speed ?? 1.0;

  const sourceText = req.text
    ? req.text
    : req.url
      ? (await extractArticleFromUrl(req.url)).contentText
      : "";
  if (!sourceText.trim()) throw new Error("No text to synthesize");

  // Cost estimation and budget check
  const chars = sourceText.length;
  const pricePerMillion = (() => {
    if (providerName === "google") {
      const v = Number(env.TTS_PRICE_GOOGLE_PER_MILLION_CHARS ?? "0");
      return Number.isFinite(v) && v > 0 ? v : 16; // sensible default
    }
    const v = Number(env.TTS_PRICE_OPENAI_PER_MILLION_CHARS ?? "0");
    return Number.isFinite(v) && v > 0 ? v : 20; // sensible default
  })();
  const estimatedCost = (chars / 1_000_000) * pricePerMillion;
  const maxBudget = Number(env.TTS_MAX_ESTIMATED_COST_USD ?? "0");
  if (
    Number.isFinite(maxBudget) &&
    maxBudget > 0 &&
    estimatedCost > maxBudget
  ) {
    throw new Error(
      `Estimated TTS cost $${estimatedCost.toFixed(4)} exceeds budget $${maxBudget.toFixed(4)}`,
    );
  }

  const key = stableHash([
    req.url || sourceText.slice(0, 8192),
    providerName,
    voiceId,
    speed,
    format,
    req.languageCode ?? "",
  ]);

  // Cache reuse: return existing manifest if already synthesized
  try {
    const existingManifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/${key}/manifest.json`;
    const existing = await fetch(existingManifestUrl, { method: "GET" });
    if (existing.ok) {
      const manifest = (await existing.json()) as TtsResult;
      return { ...manifest, manifestUrl: existingManifestUrl };
    }
  } catch {
    // ignore cache miss or fetch error; proceed to synthesize
  }

  // Build provider instance
  const provider =
    providerName === "google"
      ? createGoogleTtsProvider(req.userKeys.googleApiKey)
      : createOpenAiTtsProvider(req.userKeys.openaiApiKey);

  const chunks = chunkTextByParagraphs(sourceText, {
    targetSize: 1400,
    hardCap: provider.maxCharsPerRequest,
  });
  const segments: TtsResult["segments"] = [];
  const rawBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const ssml = provider.supportsSsml
      ? buildSsmlFromParagraphs(chunk.text, {
          rate: speed,
          languageCode: req.languageCode,
        })
      : undefined;
    let audioBuf: Buffer | null = null;
    try {
      const { audio } = await provider.synthesize({
        textOrSsml: ssml ?? chunk.text,
        voiceId,
        speed,
        format,
      });
      audioBuf = audio;
    } catch (primaryError) {
      // provider fallback (single retry) if alternate provider available
      try {
        const altProvider =
          providerName === "google"
            ? createOpenAiTtsProvider(req.userKeys.openaiApiKey)
            : createGoogleTtsProvider(req.userKeys.googleApiKey);
        const { audio } = await altProvider.synthesize({
          textOrSsml: ssml ?? chunk.text,
          voiceId: providerName === "google" ? "alloy" : voiceId,
          speed,
          format,
        });
        audioBuf = audio;
      } catch (fallbackError) {
        const msg = (primaryError as Error)?.message || String(primaryError);
        const msg2 = (fallbackError as Error)?.message || String(fallbackError);
        throw new Error(
          `TTS failed on primary and fallback providers: ${msg} | ${msg2}`,
        );
      }
    }
    const path = `tts/${key}/${chunk.index}.${format}`;
    const { url } = await put(path, audioBuf, {
      access: "public",
      contentType:
        format === "mp3"
          ? "audio/mpeg"
          : format === "ogg"
            ? "audio/ogg"
            : "audio/wav",
    });
    segments.push({
      index: chunk.index,
      text: chunk.text,
      ssml,
      audioUrl: url,
    });
    rawBuffers.push(audioBuf);
  }

  // Write a manifest for easy GET retrieval
  // Naive server-side stitch for mp3: buffered concatenation works for many encoders
  let stitchedUrl: string | undefined;
  if (format === "mp3" && rawBuffers.length > 1) {
    try {
      const combined = Buffer.concat(rawBuffers);
      const { url } = await put(`tts/${key}/full.${format}`, combined, {
        access: "public",
        contentType: "audio/mpeg",
      });
      stitchedUrl = url;
    } catch {
      // best-effort; ignore stitching failure
    }
  }

  const manifest = {
    id: key,
    provider: providerName,
    voiceId,
    format,
    segments,
    totalChars: sourceText.length,
    title: req.titleHint,
    stitchedUrl,
  } satisfies TtsResult;

  const { url: manifestUrl } = await put(
    `tts/${key}/manifest.json`,
    Buffer.from(JSON.stringify(manifest), "utf-8"),
    {
      access: "public",
      contentType: "application/json",
    },
  );

  return {
    id: key,
    provider: providerName,
    voiceId,
    format,
    segments,
    totalChars: sourceText.length,
    title: req.titleHint,
    manifestUrl,
    stitchedUrl,
  } satisfies TtsResult;
}

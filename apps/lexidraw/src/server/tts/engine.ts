import "server-only";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { put } from "@vercel/blob";
import env from "@packages/env";
import { extractArticleFromUrl } from "~/lib/extract-article";
import { chunkTextByParagraphs } from "~/lib/chunk-text";
import { buildSsmlFromParagraphs } from "~/lib/ssml";
import type { TtsRequest, TtsResult, TtsProviderName } from "./types";
import { createOpenAiTtsProvider } from "./providers/openai";
import { createGoogleTtsProvider } from "./providers/google";
import { createKokoroTtsProvider } from "./providers/kokoro";

type ChooseProviderArgs = {
  // Allow arbitrary strings here so the UI can request local adapters
  // like "apple_say" or "xtts" which are routed via the kokoro sidecar.
  requested?: string | TtsProviderName;
  languageCode?: string;
};

function chooseProvider({
  requested,
  languageCode,
}: ChooseProviderArgs): TtsProviderName {
  // Route explicit local adapters (apple_say, xtts) via kokoro sidecar
  if (requested === "apple_say" || requested === "xtts") return "kokoro";
  if (
    requested === "openai" ||
    requested === "google" ||
    requested === "kokoro"
  )
    return requested;
  const hasSidecar = !!process.env.KOKORO_URL;
  const lang = (languageCode || "").toLowerCase();
  // Route JA/SV via sidecar when available
  if (hasSidecar) {
    if (lang.startsWith("ja")) return "kokoro"; // XTTS under the hood
    if (lang.startsWith("sv")) return "kokoro"; // Apple say under the hood
  }
  // Prefer local Kokoro in development when configured
  if (process.env.NODE_ENV !== "production" && hasSidecar) return "kokoro";
  if (languageCode && !lang.startsWith("en")) return "google";
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
    req.voiceId ??
    (() => {
      if (providerName === "google") return "en-US-Standard-C";
      if (providerName === "kokoro") {
        const lang = (req.languageCode || "").toLowerCase();
        if (lang.startsWith("sv")) return "Erik"; // Apple say default
        if (lang.startsWith("ja")) return "ja_female"; // expects speaker wav
        return "af_heart";
      }
      return "alloy";
    })();
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
  req: TtsRequest & { titleHint?: string },
): Promise<TtsResult> {
  const providerName = chooseProvider({
    requested: req.provider,
    languageCode: req.languageCode,
  });
  const format = req.format ?? "mp3";
  const stitchWithFfmpeg = process.env.TTS_STITCH_WITH_FFMPEG === "true";
  const segmentFormat: "mp3" | "ogg" | "wav" = stitchWithFfmpeg
    ? "wav"
    : format;
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

  // Cache reuse: disabled for Kokoro to force regeneration during local dev
  if (providerName !== "kokoro") {
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
  }

  const provider =
    providerName === "google"
      ? createGoogleTtsProvider(env.GOOGLE_API_KEY)
      : providerName === "kokoro"
        ? createKokoroTtsProvider(env.KOKORO_URL ?? "", env.KOKORO_BEARER)
        : createOpenAiTtsProvider(env.OPENAI_API_KEY);

  const chunks = chunkTextByParagraphs(sourceText, {
    targetSize: 1400,
    hardCap: provider.maxCharsPerRequest,
  });
  const segments: TtsResult["segments"] = [];
  // Track audio buffers by segment index for stitching; reused segments may be fetched later
  const bufferByIndex = new Map<number, Buffer>();

  for (const chunk of chunks) {
    const ssml = provider.supportsSsml
      ? buildSsmlFromParagraphs(chunk.text, {
          rate: speed,
          languageCode: req.languageCode,
        })
      : undefined;
    // Reuse existing segment if blob already exists (disabled for Kokoro)
    const path = `tts/${key}/${chunk.index}.${segmentFormat}`;
    const existingUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/${path}`;
    if (providerName !== "kokoro") {
      try {
        const head = await fetch(existingUrl, { method: "HEAD" });
        if (head.ok) {
          segments.push({
            index: chunk.index,
            text: chunk.text,
            ssml,
            audioUrl: existingUrl,
          });
          // Do not synthesize or upload again; also skip adding to rawBuffers
          continue;
        }
      } catch {
        // ignore and proceed to synthesize
      }
    }
    let audioBuf: Buffer | null = null;
    try {
      const { audio } = await provider.synthesize({
        textOrSsml: ssml ?? chunk.text,
        voiceId,
        speed,
        format: format,
        languageCode: req.languageCode,
        sampleRate: req.sampleRate,
        metadata: { requestedProvider: req.provider ?? "" },
      });
      audioBuf = audio;
    } catch (primaryError) {
      // No fallback when user selected Kokoro; surface error
      if (providerName === "kokoro") {
        throw primaryError;
      }
      try {
        const altProvider =
          providerName === "google"
            ? createOpenAiTtsProvider(env.OPENAI_API_KEY)
            : env.KOKORO_URL
              ? createKokoroTtsProvider(env.KOKORO_URL, env.KOKORO_BEARER)
              : createGoogleTtsProvider(env.GOOGLE_API_KEY);
        const targetProviderName: TtsProviderName =
          providerName === "google"
            ? "openai"
            : env.KOKORO_URL
              ? "kokoro"
              : "google";
        const fallbackVoiceId =
          targetProviderName === "openai"
            ? "alloy"
            : targetProviderName === "kokoro"
              ? "af_heart"
              : "en-US-Standard-C";

        const { audio } = await altProvider.synthesize({
          textOrSsml: ssml ?? chunk.text,
          voiceId: fallbackVoiceId,
          speed,
          format: format,
          languageCode: req.languageCode,
          sampleRate: req.sampleRate,
          metadata: { requestedProvider: req.provider ?? "" },
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
    try {
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
      if (audioBuf) bufferByIndex.set(chunk.index, audioBuf);
    } catch (e) {
      const message = (e as Error)?.message ?? "";
      if (typeof message === "string" && message.includes("already exists")) {
        // Reuse existing
        segments.push({
          index: chunk.index,
          text: chunk.text,
          ssml,
          audioUrl: existingUrl,
        });
      } else {
        throw e;
      }
    }
    // If we skipped upload due to existing, buffer will be fetched later if stitching
  }

  // Write a manifest for easy GET retrieval
  // Naive server-side stitch for mp3 or robust WAV concat via ffmpeg when enabled
  let stitchedUrl: string | undefined;
  // Prefer existing stitched file if present
  try {
    const fullUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/${key}/full.${format}`;
    const headFull = await fetch(fullUrl, { method: "HEAD" });
    if (headFull.ok) {
      stitchedUrl = fullUrl;
    } else if (segments.length > 1) {
      // Build complete ordered buffers: use in-memory when available, otherwise fetch from blob URLs
      try {
        // Ensure segments are ordered by index
        const ordered = [...segments].sort((a, b) => a.index - b.index);

        if (process.env.TTS_STITCH_WITH_FFMPEG === "true") {
          // Robust approach: concat WAV files via ffmpeg and transcode to requested format
          // Download or use in-memory buffers to temp WAV files
          const tmpDir = await fs.mkdtemp(
            path.join(os.tmpdir(), `tts-${key}-`),
          );
          const wavPaths: string[] = [];
          for (const seg of ordered) {
            const inMem = bufferByIndex.get(seg.index);
            let buf: Buffer;
            if (inMem) {
              buf = inMem;
            } else {
              const url = seg.audioUrl;
              if (!url) throw new Error("Missing segment URL for stitching");
              const r = await fetch(url, { method: "GET", cache: "no-store" });
              if (!r.ok)
                throw new Error(`Failed to fetch segment ${seg.index}`);
              const arr = new Uint8Array(await r.arrayBuffer());
              buf = Buffer.from(arr);
            }
            const fp = path.join(tmpDir, `${seg.index}.wav`);
            await fs.writeFile(fp, buf);
            wavPaths.push(fp);
          }
          // Create concat list file
          const listFile = path.join(tmpDir, "list.txt");
          await fs.writeFile(
            listFile,
            wavPaths
              .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
              .join("\n"),
            { encoding: "utf-8" },
          );
          // Output temp file
          const outExt =
            format === "ogg" ? "ogg" : format === "wav" ? "wav" : "mp3";
          const outPath = path.join(tmpDir, `out.${outExt}`);
          const args = [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            listFile,
            outPath,
          ];
          await new Promise<void>((resolve, reject) => {
            const ps = spawn("ffmpeg", args);
            ps.on("error", reject);
            ps.on("exit", (code) =>
              code === 0
                ? resolve()
                : reject(new Error(`ffmpeg exited ${code}`)),
            );
          });
          const finalBuf = await fs.readFile(outPath);
          const { url } = await put(`tts/${key}/full.${format}`, finalBuf, {
            access: "public",
            contentType:
              format === "mp3"
                ? "audio/mpeg"
                : format === "ogg"
                  ? "audio/ogg"
                  : "audio/wav",
          });
          stitchedUrl = url;
        } else if (format === "mp3") {
          // Legacy best-effort buffered mp3 concat
          const orderedBuffers: Buffer[] = [];
          for (const seg of ordered) {
            const inMem = bufferByIndex.get(seg.index);
            if (inMem) {
              orderedBuffers.push(inMem);
              continue;
            }
            const url = seg.audioUrl;
            if (!url) throw new Error("Missing segment URL for stitching");
            const r = await fetch(url, { method: "GET", cache: "no-store" });
            if (!r.ok) throw new Error(`Failed to fetch segment ${seg.index}`);
            const arr = new Uint8Array(await r.arrayBuffer());
            orderedBuffers.push(Buffer.from(arr));
          }
          const combined = Buffer.concat(orderedBuffers);
          const { url } = await put(`tts/${key}/full.${format}`, combined, {
            access: "public",
            contentType: "audio/mpeg",
          });
          stitchedUrl = url;
        }
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        if (typeof msg === "string" && msg.includes("already exists")) {
          stitchedUrl = fullUrl;
        }
        // Otherwise leave stitchedUrl undefined (best-effort)
      }
    }
  } catch {
    // ignore failures
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

  const manifestPath = `tts/${key}/manifest.json`;
  const manifestUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/${manifestPath}`;
  try {
    const headManifest = await fetch(manifestUrl, { method: "HEAD" });
    if (!headManifest.ok) {
      await put(manifestPath, Buffer.from(JSON.stringify(manifest), "utf-8"), {
        access: "public",
        contentType: "application/json",
      });
    }
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    if (typeof msg === "string" && msg.includes("already exists")) {
      // reuse existing manifest
    } else {
      // best-effort; ignore manifest write failures to avoid blocking response
    }
  }

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

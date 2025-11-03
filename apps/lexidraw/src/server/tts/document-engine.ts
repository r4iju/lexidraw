import "server-only";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { put } from "@vercel/blob";
import env from "@packages/env";
import {
  sanitizeMarkdownForTts,
  splitMarkdownIntoSections,
  chunkSections,
  normalizeForTts,
} from "~/lib/markdown-for-tts";
import { buildSsmlFromParagraphs } from "~/lib/ssml";
import type { TtsResult, TtsProviderName } from "./types";
import { createOpenAiTtsProvider } from "./providers/openai";
import { createGoogleTtsProvider } from "./providers/google";
import { createKokoroTtsProvider } from "./providers/kokoro";

type ChooseProviderArgs = {
  requested?: string | TtsProviderName;
  languageCode?: string;
};

function chooseProvider({
  requested,
  languageCode,
}: ChooseProviderArgs): TtsProviderName {
  if (requested === "apple_say" || requested === "xtts") return "kokoro";
  if (
    requested === "openai" ||
    requested === "google" ||
    requested === "kokoro"
  )
    return requested;
  const hasSidecar = !!process.env.KOKORO_URL;
  const lang = (languageCode || "").toLowerCase();
  if (hasSidecar) {
    if (lang.startsWith("ja")) return "kokoro";
    if (lang.startsWith("sv")) return "kokoro";
  }
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

function computeChunkHash(
  normalizedText: string,
  opts: {
    provider: string;
    voiceId: string;
    speed: number;
    languageCode: string;
    sampleRate?: number;
  },
): string {
  return stableHash([
    normalizedText,
    opts.provider,
    opts.voiceId,
    String(opts.speed),
    opts.languageCode,
    String(opts.sampleRate ?? ""),
    "md-v1", // engine version
  ]);
}

export async function synthesizeDocumentFromMarkdown(args: {
  documentId: string;
  markdown: string;
  provider?: string;
  voiceId?: string;
  speed?: number;
  format?: "mp3" | "ogg" | "wav";
  languageCode?: string;
  sampleRate?: number;
  titleHint?: string;
}): Promise<TtsResult> {
  const providerName = chooseProvider({
    requested: args.provider,
    languageCode: args.languageCode,
  });
  const format = args.format ?? "mp3";
  const stitchWithFfmpeg = process.env.TTS_STITCH_WITH_FFMPEG === "true";
  const segmentFormat: "mp3" | "ogg" | "wav" = stitchWithFfmpeg
    ? "wav"
    : format;
  const voiceId =
    args.voiceId ??
    (() => {
      if (providerName === "google") return "en-US-Standard-C";
      if (providerName === "kokoro") {
        const lang = (args.languageCode || "").toLowerCase();
        if (lang.startsWith("sv")) return "Erik";
        if (lang.startsWith("ja")) return "ja_female";
        return "af_heart";
      }
      return "alloy";
    })();
  const speed = args.speed ?? 1.0;

  // Sanitize markdown (remove code, math, images, etc.)
  const sanitized = sanitizeMarkdownForTts(args.markdown);

  // Split into sections by headings
  const sections = splitMarkdownIntoSections(sanitized);

  // Chunk sections into ~1400 char pieces
  const chunks = chunkSections(sections, {
    targetSize: 1400,
    hardCap: 4000,
  });

  if (chunks.length === 0) {
    throw new Error("No text content found after sanitization");
  }

  // Compute document key
  const docKey = stableHash([
    args.documentId,
    providerName,
    voiceId,
    speed,
    format,
    args.languageCode ?? "",
    args.sampleRate ?? "",
  ]);

  // Cost estimation (reuse logic from engine.ts)
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const pricePerMillion = (() => {
    if (providerName === "google") {
      const v = Number(env.TTS_PRICE_GOOGLE_PER_MILLION_CHARS ?? "0");
      return Number.isFinite(v) && v > 0 ? v : 16;
    }
    const v = Number(env.TTS_PRICE_OPENAI_PER_MILLION_CHARS ?? "0");
    return Number.isFinite(v) && v > 0 ? v : 20;
  })();
  const estimatedCost = (totalChars / 1_000_000) * pricePerMillion;
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

  const provider =
    providerName === "google"
      ? createGoogleTtsProvider(env.GOOGLE_API_KEY)
      : providerName === "kokoro"
        ? createKokoroTtsProvider(env.KOKORO_URL ?? "", env.KOKORO_BEARER)
        : createOpenAiTtsProvider(env.OPENAI_API_KEY);

  const segments: TtsResult["segments"] = [];
  const bufferByIndex = new Map<number, Buffer>();

  for (const chunk of chunks) {
    const normalizedText = normalizeForTts(chunk.text);
    const chunkHash = computeChunkHash(normalizedText, {
      provider: providerName,
      voiceId,
      speed,
      languageCode: args.languageCode ?? "",
      sampleRate: args.sampleRate,
    });

    const ssml = provider.supportsSsml
      ? buildSsmlFromParagraphs(chunk.text, {
          rate: speed,
          languageCode: args.languageCode,
        })
      : undefined;

    // Check if chunk audio already exists
    const chunkPath = `tts/chunks/${chunkHash}.${segmentFormat}`;
    const existingUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/${chunkPath}`;

    if (providerName !== "kokoro") {
      try {
        const head = await fetch(existingUrl, { method: "HEAD" });
        if (head.ok) {
          segments.push({
            index: chunk.index,
            text: chunk.text,
            ssml,
            audioUrl: existingUrl,
            sectionTitle: chunk.sectionTitle,
            chunkHash,
          });
          continue;
        }
      } catch {
        // ignore and proceed to synthesize
      }
    }

    // Synthesize chunk
    let audioBuf: Buffer | null = null;
    try {
      const { audio } = await provider.synthesize({
        textOrSsml: ssml ?? chunk.text,
        voiceId,
        speed,
        format: format,
        languageCode: args.languageCode,
        sampleRate: args.sampleRate,
        metadata: { requestedProvider: args.provider ?? "" },
      });
      audioBuf = audio;
    } catch (primaryError) {
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
          languageCode: args.languageCode,
          sampleRate: args.sampleRate,
          metadata: { requestedProvider: args.provider ?? "" },
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

    // Upload chunk audio
    try {
      const { url } = await put(chunkPath, audioBuf, {
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
        sectionTitle: chunk.sectionTitle,
        chunkHash,
      });
      if (audioBuf) bufferByIndex.set(chunk.index, audioBuf);
    } catch (e) {
      const message = (e as Error)?.message ?? "";
      if (typeof message === "string" && message.includes("already exists")) {
        segments.push({
          index: chunk.index,
          text: chunk.text,
          ssml,
          audioUrl: existingUrl,
          sectionTitle: chunk.sectionTitle,
          chunkHash,
        });
      } else {
        throw e;
      }
    }
  }

  // Stitch segments if needed
  let stitchedUrl: string | undefined;
  try {
    const fullUrl = `${env.VERCEL_BLOB_STORAGE_HOST}/tts/doc/${docKey}/full.${format}`;
    const headFull = await fetch(fullUrl, { method: "HEAD" });
    if (headFull.ok) {
      stitchedUrl = fullUrl;
    } else if (segments.length > 1) {
      try {
        const ordered = [...segments].sort((a, b) => a.index - b.index);

        if (process.env.TTS_STITCH_WITH_FFMPEG === "true") {
          const tmpDir = await fs.mkdtemp(
            path.join(os.tmpdir(), `tts-doc-${docKey}-`),
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
          const listFile = path.join(tmpDir, "list.txt");
          await fs.writeFile(
            listFile,
            wavPaths
              .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
              .join("\n"),
            { encoding: "utf-8" },
          );
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
          const { url } = await put(
            `tts/doc/${docKey}/full.${format}`,
            finalBuf,
            {
              access: "public",
              contentType:
                format === "mp3"
                  ? "audio/mpeg"
                  : format === "ogg"
                    ? "audio/ogg"
                    : "audio/wav",
            },
          );
          stitchedUrl = url;
        } else if (format === "mp3") {
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
          const { url } = await put(
            `tts/doc/${docKey}/full.${format}`,
            combined,
            {
              access: "public",
              contentType: "audio/mpeg",
            },
          );
          stitchedUrl = url;
        }
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        if (typeof msg === "string" && msg.includes("already exists")) {
          stitchedUrl = fullUrl;
        }
      }
    }
  } catch {
    // ignore failures
  }

  const manifest = {
    id: docKey,
    provider: providerName,
    voiceId,
    format,
    segments,
    totalChars,
    title: args.titleHint,
    stitchedUrl,
  } satisfies TtsResult;

  const manifestPath = `tts/doc/${docKey}/manifest.json`;
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
      // best-effort; ignore manifest write failures
    }
  }

  return {
    id: docKey,
    provider: providerName,
    voiceId,
    format,
    segments,
    totalChars,
    title: args.titleHint,
    manifestUrl,
    stitchedUrl,
  } satisfies TtsResult;
}

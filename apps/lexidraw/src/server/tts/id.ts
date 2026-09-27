import "server-only";
import crypto from "node:crypto";
import { languageMatters } from "~/app/settings/schema";

export type TtsConfigResolved = {
  provider: string;
  voiceId: string;
  speed: number;
  format: "mp3" | "ogg" | "wav";
  languageCode?: string;
  sampleRate?: number;
};

export function stableHash(
  parts: (string | number | boolean | null | undefined)[],
): string {
  const h = crypto.createHash("sha256");
  for (const p of parts) {
    h.update(String(p ?? ""));
    h.update("\u0000");
  }
  return h.digest("hex");
}

// Left out where the service ignores it, so changing it keeps the audio.
const languageOf = (cfg: TtsConfigResolved) =>
  languageMatters(cfg.provider) ? (cfg.languageCode ?? "") : "";

export function computeDocKey(
  documentId: string,
  cfg: TtsConfigResolved,
): string {
  return stableHash([
    documentId,
    cfg.provider, // requested provider string (unset means auto)
    cfg.voiceId,
    cfg.speed,
    cfg.format,
    languageOf(cfg),
    cfg.sampleRate ?? "",
  ]);
}

export function computeArticleKey(
  articleId: string,
  cfg: TtsConfigResolved,
): string {
  return stableHash([
    articleId,
    cfg.provider, // requested provider string (unset means auto)
    cfg.voiceId,
    cfg.speed,
    cfg.format,
    languageOf(cfg),
    cfg.sampleRate ?? "",
  ]);
}

export function computeChunkHash(
  normalizedText: string,
  cfg: TtsConfigResolved,
): string {
  return stableHash([
    normalizedText,
    cfg.provider,
    cfg.voiceId,
    cfg.speed,
    cfg.format,
    languageOf(cfg),
    cfg.sampleRate ?? "",
    "md-v1",
  ]);
}

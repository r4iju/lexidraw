import "server-only";
import crypto from "node:crypto";

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

export function computeDocKey(
  documentId: string,
  cfg: TtsConfigResolved,
): string {
  return stableHash([
    documentId,
    cfg.provider, // requested provider string (e.g., "apple_say")
    cfg.voiceId,
    cfg.speed,
    cfg.format,
    cfg.languageCode ?? "",
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
    cfg.languageCode ?? "",
    cfg.sampleRate ?? "",
    "md-v1",
  ]);
}

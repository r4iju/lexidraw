import type { TtsProviderName } from "~/server/tts/types";

export function chooseProvider(
  requested?: string,
  languageCode?: string,
): TtsProviderName {
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


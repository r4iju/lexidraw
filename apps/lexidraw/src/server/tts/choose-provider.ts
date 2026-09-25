import { defaultVoice } from "~/app/settings/schema";
import type { TtsProviderName } from "./types";

// Kokoro picks its language pipeline from the voice id prefix.
const KOKORO_LANGUAGE_PREFIXES = [
  "en",
  "ja",
  "zh",
  "es",
  "fr",
  "hi",
  "it",
  "pt",
];

function kokoroSpeaks(lang: string): boolean {
  return (
    lang === "" || KOKORO_LANGUAGE_PREFIXES.some((p) => lang.startsWith(p))
  );
}

export function chooseProvider(
  requested?: string,
  languageCode?: string,
): TtsProviderName {
  if (
    requested === "openai" ||
    requested === "google" ||
    requested === "kokoro"
  )
    return requested;
  const lang = (languageCode || "").toLowerCase();
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.KOKORO_URL &&
    kokoroSpeaks(lang)
  )
    return "kokoro";
  if (languageCode && !lang.startsWith("en")) return "google";
  return "openai";
}

export function defaultKokoroVoice(languageCode?: string): string {
  return defaultVoice("kokoro", languageCode);
}

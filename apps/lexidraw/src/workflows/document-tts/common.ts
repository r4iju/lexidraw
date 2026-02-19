import type { TtsProviderName } from "~/server/tts/types";

export const CHIRP3_HD_VOICES = new Set([
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam",
  "Aoede", "Autonoe", "Callirrhoe", "Charon", "Despina",
  "Enceladus", "Erinome", "Fenrir", "Gacrux", "Iapetus",
  "Kore", "Laomedeia", "Leda", "Orus", "Pulcherrima",
  "Puck", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar",
  "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
]);

export function isChirp3HdVoice(voiceId: string): boolean {
  return CHIRP3_HD_VOICES.has(voiceId) || voiceId.includes("Chirp3-HD");
}

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


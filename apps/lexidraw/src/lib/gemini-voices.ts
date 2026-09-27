/** Gemini's prebuilt voices, each with the character Google describes. */
export const GEMINI_VOICES = [
  { name: "Kore", character: "Firm" },
  { name: "Puck", character: "Upbeat" },
  { name: "Charon", character: "Informative" },
  { name: "Zephyr", character: "Bright" },
  { name: "Fenrir", character: "Excitable" },
  { name: "Leda", character: "Youthful" },
  { name: "Orus", character: "Firm" },
  { name: "Aoede", character: "Breezy" },
  { name: "Callirrhoe", character: "Easy-going" },
  { name: "Autonoe", character: "Bright" },
  { name: "Enceladus", character: "Breathy" },
  { name: "Iapetus", character: "Clear" },
  { name: "Umbriel", character: "Easy-going" },
  { name: "Algieba", character: "Smooth" },
  { name: "Despina", character: "Smooth" },
  { name: "Erinome", character: "Clear" },
  { name: "Algenib", character: "Gravelly" },
  { name: "Rasalgethi", character: "Informative" },
  { name: "Laomedeia", character: "Upbeat" },
  { name: "Achernar", character: "Soft" },
  { name: "Alnilam", character: "Firm" },
  { name: "Schedar", character: "Even" },
  { name: "Gacrux", character: "Mature" },
  { name: "Pulcherrima", character: "Forward" },
  { name: "Achird", character: "Friendly" },
  { name: "Zubenelgenubi", character: "Casual" },
  { name: "Vindemiatrix", character: "Gentle" },
  { name: "Sadachbia", character: "Lively" },
  { name: "Sadaltager", character: "Knowledgeable" },
  { name: "Sulafat", character: "Warm" },
] as const;

export const DEFAULT_GEMINI_VOICE = "Kore";

const NAMES = new Set<string>(GEMINI_VOICES.map((v) => v.name));

/**
 * The Gemini voice a saved Google voice reads in. Google Cloud TTS served the
 * same voices as Chirp3-HD ones (`en-US-Chirp3-HD-Puck`); its other voices
 * have no Gemini counterpart.
 */
export function geminiVoice(voiceId: string | undefined): string | undefined {
  const name = voiceId?.split("-").at(-1);
  return name && NAMES.has(name) ? name : undefined;
}

/**
 * Languages offered for a Gemini voice. Gemini reads any of them in every
 * voice and tells them apart itself; the code only picks the list's entry.
 */
export const GEMINI_LANGUAGES = [
  "en-US",
  "en-GB",
  "en-AU",
  "en-IN",
  "ar-EG",
  "bn-BD",
  "cs-CZ",
  "da-DK",
  "de-DE",
  "el-GR",
  "es-ES",
  "es-US",
  "fi-FI",
  "fr-CA",
  "fr-FR",
  "he-IL",
  "hi-IN",
  "hu-HU",
  "id-ID",
  "it-IT",
  "ja-JP",
  "ko-KR",
  "mr-IN",
  "nb-NO",
  "nl-NL",
  "pl-PL",
  "pt-BR",
  "pt-PT",
  "ro-RO",
  "ru-RU",
  "sv-SE",
  "ta-IN",
  "te-IN",
  "th-TH",
  "tr-TR",
  "uk-UA",
  "vi-VN",
  "zh-CN",
  "zh-TW",
];

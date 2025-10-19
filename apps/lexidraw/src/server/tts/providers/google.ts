import "server-only";
import type { TtsProvider, TtsSynthesizeInput } from "../types";
import env from "@packages/env";

type GoogleTtsRequest = {
  input: { text?: string; ssml?: string };
  voice: { languageCode?: string; name?: string };
  audioConfig: {
    audioEncoding: "MP3" | "OGG_OPUS" | "LINEAR16";
    speakingRate?: number;
    sampleRateHertz?: number;
  };
};

export function createGoogleTtsProvider(
  apiKeyFromUser?: string | null,
): TtsProvider {
  const apiKey = apiKeyFromUser || env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Google API key not configured");
  }

  return {
    name: "google",
    maxCharsPerRequest: 5000, // per-request cap for text/ssml
    supportsSsml: true,
    async synthesize(input: TtsSynthesizeInput) {
      const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`;
      const encoding =
        input.format === "mp3"
          ? "MP3"
          : input.format === "ogg"
            ? "OGG_OPUS"
            : "LINEAR16";
      const payload: GoogleTtsRequest = {
        input: input.textOrSsml.trim().startsWith("<speak")
          ? { ssml: input.textOrSsml }
          : { text: input.textOrSsml },
        voice: { name: input.voiceId },
        audioConfig: {
          audioEncoding: encoding,
          speakingRate: input.speed,
          sampleRateHertz: input.sampleRate,
        },
      };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Google TTS error: ${res.status} ${res.statusText} ${text}`,
        );
      }
      const json = (await res.json()) as { audioContent: string };
      const audio = Buffer.from(json.audioContent, "base64");
      return { audio };
    },
  };
}

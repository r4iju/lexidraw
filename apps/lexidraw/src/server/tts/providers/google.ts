import "server-only";
import type { TtsProvider, TtsSynthesizeInput } from "../types";
import { CHIRP3_HD_VOICES } from "~/server/tts/google-voices";
import { FatalError } from "workflow";
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

function resolveGoogleVoiceName(
  voiceId: string,
  languageCode: string | undefined,
): string {
  if (CHIRP3_HD_VOICES.has(voiceId)) {
    return `${languageCode ?? "en-US"}-Chirp3-HD-${voiceId}`;
  }
  return voiceId;
}

export function createGoogleTtsProvider(
  apiKeyFromUser?: string | null,
): TtsProvider {
  const apiKey = apiKeyFromUser || env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Google API key not configured");
  }

  return {
    name: "google",
    maxCharsPerRequest: 5000,
    supportsSsml: true,
    async synthesize(input: TtsSynthesizeInput) {
      const endpointBase =
        "https://texttospeech.googleapis.com/v1/text:synthesize";
      const endpoint = `${endpointBase}?key=${encodeURIComponent(apiKey)}`;
      const encoding =
        input.format === "mp3"
          ? "MP3"
          : input.format === "ogg"
            ? "OGG_OPUS"
            : "LINEAR16";
      const voiceName = resolveGoogleVoiceName(
        input.voiceId,
        input.languageCode,
      );
      const payload: GoogleTtsRequest = {
        input: input.textOrSsml.trim().startsWith("<speak")
          ? { ssml: input.textOrSsml }
          : { text: input.textOrSsml },
        voice: {
          name: voiceName,
          languageCode: input.languageCode,
        },
        audioConfig: {
          audioEncoding: encoding,
          speakingRate: input.speed,
          sampleRateHertz: input.sampleRate,
        },
      };

      const kind = payload.input.ssml ? "ssml" : "text";
      console.log("[tts][google] request", {
        endpoint: endpointBase,
        kind,
        textLen: payload.input.text ? payload.input.text.length : undefined,
        ssmlLen: payload.input.ssml ? payload.input.ssml.length : undefined,
        voice: payload.voice.name,
        languageCode: payload.voice.languageCode,
        audioEncoding: payload.audioConfig.audioEncoding,
        speakingRate: payload.audioConfig.speakingRate,
        sampleRateHertz: payload.audioConfig.sampleRateHertz,
      });

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        console.warn("[tts][google] error", {
          status: res.status,
          statusText: res.statusText,
          body: text.slice(0, 500),
        });
        const msg = `Google TTS error: ${res.status} ${res.statusText} ${text}`;
        if (res.status >= 400 && res.status < 500) {
          throw new FatalError(msg);
        }
        throw new Error(msg);
      }
      const json = (await res.json()) as { audioContent: string };
      const audio = Buffer.from(json.audioContent, "base64");
      console.log("[tts][google] success", { bytes: audio.byteLength });
      return { audio };
    },
  };
}

import "server-only";
import type { TtsProvider, TtsSynthesizeInput } from "../types";
import env from "@packages/env";

export function createOpenAiTtsProvider(
  apiKeyFromUser?: string | null,
): TtsProvider {
  const apiKey = apiKeyFromUser || env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  return {
    name: "openai",
    maxCharsPerRequest: 4000, // conservative default
    supportsSsml: false,
    async synthesize(input: TtsSynthesizeInput) {
      const model = "gpt-4o-mini-tts"; // steerable, fast TTS
      const voice = input.voiceId || "alloy";
      const speed = input.speed;
      const format = input.format ?? "mp3";

      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: input.textOrSsml,
          voice,
          format,
          speed,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `OpenAI TTS error: ${res.status} ${res.statusText} ${text}`,
        );
      }
      const arrayBuf = await res.arrayBuffer();
      const audio = Buffer.from(new Uint8Array(arrayBuf));
      return { audio };
    },
  };
}

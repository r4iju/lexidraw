import "server-only";
import type { TtsProvider, TtsSynthesizeInput } from "../types";
import env from "@packages/env";

export function createKokoroTtsProvider(
  baseUrl: string,
  bearer?: string,
): TtsProvider {
  if (!baseUrl) {
    throw new Error("Kokoro baseUrl not configured");
  }

  return {
    // Temporary cast until provider union includes "kokoro"
    name: "kokoro" as unknown as TtsProvider["name"],
    maxCharsPerRequest: 4000,
    supportsSsml: false,
    async synthesize(input: TtsSynthesizeInput) {
      const cfHeaders =
        env.NODE_ENV === "production"
          ? {
              "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,
              "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,
            }
          : undefined;

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/audio/speech`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(cfHeaders ?? {}),
        },
        body: JSON.stringify({
          model: "kokoro-82m",
          input: input.textOrSsml,
          voice: input.voiceId,
          format: input.format ?? "wav",
          // Hints for sidecar routing
          languageCode: input.languageCode,
          provider: input.metadata?.requestedProvider,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Kokoro TTS error: ${res.status} ${res.statusText} ${text}`,
        );
      }

      const arrayBuf = await res.arrayBuffer();
      const audio = Buffer.from(new Uint8Array(arrayBuf));
      return { audio };
    },
  };
}

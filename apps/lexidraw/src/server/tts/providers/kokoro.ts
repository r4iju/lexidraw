import "server-only";
import type { TtsProvider, TtsSynthesizeInput } from "../types";
import { RetryableError, FatalError } from "workflow";
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
        const msg = `Kokoro TTS error: ${res.status} ${res.statusText} ${text}`;
        if (res.status === 429) {
          // Rate limited → retry with backoff from Retry-After header
          const retryAfterHeader = res.headers.get("Retry-After");
          const retryAfter = retryAfterHeader
            ? Number.parseInt(retryAfterHeader, 10) || 2
            : 2;
          throw new RetryableError(msg, { retryAfter });
        }
        if (res.status >= 500) {
          // transient → let the step retry with a small backoff
          throw new RetryableError(msg, { retryAfter: 2 });
        }
        if (
          res.status === 404 ||
          res.status === 400 ||
          res.status === 401 ||
          res.status === 403
        ) {
          // permanent → do not retry
          throw new FatalError(msg);
        }
        throw new Error(msg);
      }

      const arrayBuf = await res.arrayBuffer();
      const audio = Buffer.from(new Uint8Array(arrayBuf));
      return { audio };
    },
  };
}

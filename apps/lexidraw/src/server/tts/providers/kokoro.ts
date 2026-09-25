import "server-only";
import type { TtsProvider, TtsSynthesizeInput } from "../types";
import { RetryableError, FatalError } from "workflow";
import env from "@packages/env";
import { refusal } from "./refusal";

export function createKokoroTtsProvider(baseUrl: string): TtsProvider {
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

      const server = baseUrl.replace(/\/$/, "");
      const res = await fetch(`${server}/v1/audio/speech`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfHeaders ?? {}),
        },
        body: JSON.stringify({
          model: "kokoro",
          input: input.textOrSsml,
          voice: input.voiceId,
          // Kokoro-FastAPI serves Ogg as Opus
          response_format: input.format === "ogg" ? "opus" : input.format,
          speed: input.speed,
        }),
      }).catch((error: unknown) => {
        // Nothing answered, as when the shared Kokoro-FastAPI server is down.
        const cause = (error as { cause?: { code?: string; message?: string } })
          ?.cause;
        throw new Error(
          `Kokoro server did not answer (${cause?.code ?? cause?.message ?? String(error)}); choose another voice`,
        );
      });

      if (!res.ok) {
        const msg = await refusal("Kokoro", res);
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

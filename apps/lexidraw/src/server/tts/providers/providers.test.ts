/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
import type { TtsProvider } from "../types";

await installServerRuntime();
const { createKokoroTtsProvider } = await import("./kokoro");
const { createOpenAiTtsProvider } = await import("./openai");
const { createGoogleTtsProvider } = await import("./google");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const fetchAnswers = (answer: () => Promise<Response>) => {
  globalThis.fetch = answer as unknown as typeof fetch;
};
const HELLO = { textOrSsml: "Hello", voiceId: "alloy", format: "mp3" } as const;
const failureOf = (call: Promise<unknown>) =>
  call.then(
    () => null,
    (error: Error) => error.message,
  );

describe("a speech provider's failure, as the job's error shows it", () => {
  test("Kokoro says the shared Kokoro server did not answer, not only that a fetch failed", async () => {
    fetchAnswers(async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8880"), {
          code: "ECONNREFUSED",
        }),
      });
    });
    const kokoro = createKokoroTtsProvider("http://127.0.0.1:8880/");

    const failure = await failureOf(kokoro.synthesize(HELLO));

    expect(failure).toContain("Kokoro server at http://127.0.0.1:8880");
    expect(failure).toContain("ECONNREFUSED");
    expect(failure).toContain("KOKORO_URL");
    expect(failure).not.toContain("kokoro-service");
  });

  // OpenAI's refusal quotes part of the key it refused.
  const refusals: [
    string,
    () => TtsProvider,
    number,
    unknown,
    string,
    string,
  ][] = [
    [
      "OpenAI",
      () => createOpenAiTtsProvider("sk-test-key"),
      401,
      {
        error: {
          message: "Incorrect API key provided: sk-proj-AbCd****WxYz.",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      },
      "invalid_api_key",
      "Incorrect API key provided: sk-proj-AbCd****WxYz.",
    ],
    [
      "Google",
      () => createGoogleTtsProvider("google-test-key"),
      403,
      {
        error: {
          code: 403,
          message: "API key AIzaSyAbCd not valid.",
          status: "PERMISSION_DENIED",
        },
      },
      "PERMISSION_DENIED",
      "API key AIzaSyAbCd not valid.",
    ],
    [
      "Kokoro",
      () => createKokoroTtsProvider("http://127.0.0.1:8880"),
      400,
      {
        detail: {
          error: "validation_error",
          message: "Voice 'Alva' not found. Available voices: af_alloy",
          type: "invalid_request_error",
        },
      },
      "validation_error",
      "Available voices",
    ],
  ];
  test.each(refusals)(
    "%s names the status and its reason, and none of what its answer quotes",
    async (_, provider, status, body, reason, quoted) => {
      fetchAnswers(async () =>
        Response.json(body, { status, statusText: "Refused" }),
      );

      const failure = await failureOf(provider().synthesize(HELLO));

      expect(failure).toContain(String(status));
      expect(failure).toContain(reason);
      expect(failure).not.toContain(quoted);
    },
  );
});

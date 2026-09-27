/// <reference types="bun" />
import { afterEach, describe, expect, test } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
import type { TtsProvider } from "../types";

await installServerRuntime();
const { createKokoroTtsProvider } = await import("./kokoro");
const { createOpenAiTtsProvider } = await import("./openai");
const { createGeminiTtsProvider } = await import("./gemini");

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
  test("Kokoro says its server did not answer, not only that a fetch failed, and not where the server is", async () => {
    fetchAnswers(async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8880"), {
          code: "ECONNREFUSED",
        }),
      });
    });
    const kokoro = createKokoroTtsProvider("http://127.0.0.1:8880/");

    const failure = await failureOf(kokoro.synthesize(HELLO));

    expect(failure).toContain("Kokoro server did not answer");
    expect(failure).toContain("ECONNREFUSED");
    expect(failure).not.toContain("127.0.0.1");
    expect(failure).not.toContain("KOKORO_URL");
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
      () => createGeminiTtsProvider("google-test-key"),
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

/** Half a second of a 440 Hz tone, as Gemini answers: 16-bit mono WAV. */
function wavTone(sampleRate = 24000) {
  const samples = sampleRate / 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000;
    wav.writeInt16LE(Math.round(sample), 44 + i * 2);
  }
  return wav;
}

describe("a Gemini reading", () => {
  const WAV = wavTone();
  const read = async (input: {
    voiceId?: string;
    speed?: number;
    format?: "mp3" | "wav";
  }) => {
    let sent: { url: string; headers: Headers; body: Record<string, unknown> } =
      { url: "", headers: new Headers(), body: {} };
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent = {
        url,
        headers: new Headers(init.headers),
        body: JSON.parse(String(init.body)),
      };
      return Response.json({
        id: "i1",
        status: "completed",
        steps: [
          { type: "user_input", content: [{ type: "text", text: "Hello" }] },
          {
            type: "model_output",
            content: [
              {
                type: "audio",
                mime_type: "audio/wav",
                data: WAV.toString("base64"),
              },
            ],
          },
        ],
      });
    }) as unknown as typeof fetch;
    const { audio } = await createGeminiTtsProvider(
      "google-test-key",
    ).synthesize({ ...HELLO, voiceId: "Puck", ...input });
    return { sent, audio };
  };

  test("is Flash-Lite reading the text in the voice asked, and not kept", async () => {
    const { sent } = await read({});

    expect(sent.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
    );
    expect(sent.headers.get("x-goog-api-key")).toBe("google-test-key");
    expect(sent.body).toMatchObject({
      model: "gemini-3.8-flash-lite-tts",
      input: [{ type: "text", text: "Hello" }],
      response_format: { type: "audio", mime_type: "audio/wav" },
      generation_config: { speech_config: [{ voice: "Puck" }] },
      store: false,
    });
  });

  // Gemini answers in WAV alone, a sixth the size of MP3 in bytes per minute.
  test("asked for MP3 is MP3, far smaller than the WAV Gemini sends", async () => {
    const { audio } = await read({ format: "mp3" });

    expect(audio[0]).toBe(0xff);
    expect((audio[1] ?? 0) & 0xe0).toBe(0xe0);
    expect(audio.byteLength).toBeLessThan(WAV.byteLength / 4);
  });

  test("asked for WAV is the WAV Gemini sends", async () => {
    const { audio } = await read({ format: "wav" });

    expect(audio.equals(WAV)).toBe(true);
  });

  test("of a Google Cloud voice is in the Gemini voice of its name", async () => {
    const { sent } = await read({ voiceId: "en-US-Chirp3-HD-Charon" });

    expect(sent.body).toMatchObject({
      generation_config: { speech_config: [{ voice: "Charon" }] },
    });
  });

  test("asked to be faster says so in its style, not in the text it reads", async () => {
    const { sent } = await read({ speed: 1.5 });

    const [text] = sent.body.input as {
      text: string;
      annotations?: { type: string; style: string }[];
    }[];
    expect(text?.text).toBe("Hello");
    expect(text?.annotations?.[0]?.type).toBe("speech_metadata");
    expect(text?.annotations?.[0]?.style).toContain("quick");
  });
});

import { expect, test } from "bun:test";
import { createByokSession } from "../byok/session";

test("direct narration confines the current key to speech and rejects retired references", async () => {
  const requests: Request[] = [];
  const session = createByokSession(
    async (request) => {
      requests.push(request);
      return new Response(new Uint8Array(48000), {
        headers: { "Content-Type": "audio/pcm" },
      });
    },
    "https://app.test",
    { narrationFixture: true },
  );
  const reference = session.replace(
    "openrouter",
    "sk-or-v1-NARRATION-FAKE-ONLY",
  );
  const part = await session.narrate(reference, "Hello reader.");
  expect(part.seconds).toBe(1);
  expect(requests[0]?.url).toBe("https://openrouter.ai/api/v1/audio/speech");
  expect(requests[0]?.headers.get("Authorization")).toBe(
    "Bearer sk-or-v1-NARRATION-FAKE-ONLY",
  );
  expect(await requests[0]?.json()).toEqual({
    model: "google/gemini-3.8-flash-lite-tts",
    input: "Hello reader.",
    voice: "Kore",
    instructions:
      "Read the supplied text faithfully with clear, natural narration.",
    response_format: "pcm",
  });
  session.remove();
  await expect(session.narrate(reference, "Next part")).rejects.toThrow();
  expect(requests).toHaveLength(1);
});

test("provider audio and recovered metadata reject compressed and encoded credential envelopes before app egress", async () => {
  const { gzipSync } = await import("node:zlib");
  const secret = "opaque-retired-narration-key";
  let bytes: Uint8Array = gzipSync(
    Buffer.from(JSON.stringify({ rawResponse: { key: secret } })),
  );
  const session = createByokSession(
    async () =>
      new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": "audio/pcm" },
      }),
    "https://app.test",
    { narrationFixture: true },
  );
  const ref = session.replace("openrouter", secret);
  await expect(session.narrate(ref, "Hello")).rejects.toThrow();
  bytes = new TextEncoder().encode(
    JSON.stringify({ rawResponse: btoa(encodeURIComponent(secret)) }),
  );
  if (bytes.length % 2) bytes = new Uint8Array([...bytes, 0]);
  await expect(session.narrate(ref, "Hello")).rejects.toThrow();
  session.remove();
  await expect(
    session.fetch("/api/storage", {
      method: "POST",
      body: gzipSync(Buffer.from(secret)),
      headers: { "Content-Encoding": "gzip" },
    }),
  ).rejects.toThrow("Credential egress blocked");
});

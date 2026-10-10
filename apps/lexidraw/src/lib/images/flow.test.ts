import { inflateSync } from "node:zlib";
// Bun 1.3 lacks the browser decoding primitive. Inject that host boundary with real bounded zlib decoding.
if (typeof DecompressionStream === "undefined")
  Object.defineProperty(globalThis, "DecompressionStream", {
    value: class extends TransformStream<Uint8Array, Uint8Array> {
      constructor() {
        const chunks: Uint8Array[] = [];
        super({
          transform(chunk) {
            chunks.push(chunk);
          },
          flush(controller) {
            controller.enqueue(
              new Uint8Array(
                inflateSync(Buffer.concat(chunks), {
                  maxOutputLength: 4_195_328,
                }),
              ),
            );
          },
        });
      }
    },
  });
import { expect, test } from "bun:test";
import { ImageFlow } from "./flow";
import { fixtureImage } from "~/test/image-fixture";
import { createByokSession } from "~/lib/byok/session";
test("selected BYOK uses approved direct request, rejects encoded echoes, retains completed image across key removal and failed sync", async () => {
  let generated = 0,
    uploads = 0,
    fail = true;
  const key = "sk-or-v1-DEVICE-IMAGE-TEST-SECRET";
  const session = createByokSession(
    async (request) => {
      expect(request.url).toBe("https://openrouter.ai/api/v1/images");
      expect(request.redirect).toBe("error");
      expect(request.headers.get("Authorization")).toBe(`Bearer ${key}`);
      generated++;
      return Response.json({
        data: [{ b64_json: fixtureImage().base64, media_type: "image/png" }],
      });
    },
    "https://app.test",
    { imageFixture: true },
  );
  session.replace("openrouter", key);
  const flow = new ImageFlow({
    source: () => ({ mode: "byok", provider: "openrouter" }),
    availability: () => ({
      available: true,
      maximum: 60_000_000,
      fixture: true,
    }),
    byok: session,
    pro: async () => {
      throw new Error("Pro must not run");
    },
    save: async (_id, image) => {
      session.assertEgress(JSON.stringify(image));
      uploads++;
      if (fail) throw new Error("failure");
      return "https://storage.test/saved.png";
    },
  });
  await flow.generate("tree");
  expect(flow.state().kind).toBe("completed");
  session.remove();
  expect(await flow.upload()).toBeNull();
  expect(flow.state().kind).toBe("sync_failed");
  fail = false;
  expect(await flow.upload()).toBe("https://storage.test/saved.png");
  expect(generated).toBe(1);
  expect(uploads).toBe(2);
  const unsafe = createByokSession(
    async () =>
      Response.json({
        data: [{ b64_json: btoa(key), media_type: "image/png" }],
      }),
    "https://app.test",
    { imageFixture: true },
  );
  const reference = unsafe.replace("openrouter", key);
  await expect(unsafe.image(reference, "tree")).rejects.toThrow(
    "Image provider unavailable",
  );
});
test("Pro quote must be explicitly accepted; decline dispatches nothing and local has no fallback", async () => {
  let calls = 0;
  const flow = new ImageFlow({
    source: () => ({ mode: "pro" }),
    availability: () => ({
      available: true,
      maximum: 60_000_000,
      fixture: true,
    }),
    byok: createByokSession(async () => {
      throw new Error("network");
    }, "https://app.test"),
    pro: async () => {
      calls++;
      return fixtureImage();
    },
    save: async () => "https://storage.test/image.png",
  });
  await flow.generate("tree");
  expect(flow.state().kind).toBe("quote");
  expect(calls).toBe(0);
  flow.decline();
  expect(calls).toBe(0);
  await flow.generate("tree");
  await flow.accept();
  expect(calls).toBe(1);
  await flow.generate("tree");
  await flow.accept();
  expect(calls).toBe(2);
});

test("image provider response stops consuming after its byte bound", async () => {
  let cancelled = false;
  let chunk = 0;
  const session = createByokSession(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (chunk++ < 8) controller.enqueue(new Uint8Array(1024 * 1024));
            else controller.close();
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    "https://app.test",
    { imageFixture: true },
  );
  const reference = session.replace("openrouter", "fixture-byte-limit-key");
  await expect(session.image(reference, "tree")).rejects.toThrow(
    "Image provider unavailable",
  );
  expect(cancelled).toBe(true);
});

test("direct browser image rejects an encoded SDK envelope before retaining output", async () => {
  const bytes = await Bun.file(
    "../ios/Tests/LexidrawKitTests/Fixtures/invalid-envelope-image.bin",
  ).arrayBuffer();
  const session = createByokSession(
    async () =>
      Response.json({
        data: [
          {
            media_type: "image/png",
            b64_json: Buffer.from(bytes).toString("base64"),
          },
        ],
      }),
    "https://app.test",
    { imageFixture: true },
  );
  const reference = session.replace("openrouter", "fixture-envelope-key");
  await expect(session.image(reference, "tree")).rejects.toThrow(
    "Image provider unavailable",
  );
});

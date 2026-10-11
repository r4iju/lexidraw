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

test("known provider credential in valid RGB pixel rows never reaches completed image or guarded upload", async () => {
  const { deflateSync } = await import("node:zlib");
  const { crc32 } = await import("./format");
  const key = "pixel-custody-synthetic-supplied-provider-credential-291";
  for (const payload of [
    null,
    key,
    btoa(key),
    Buffer.from(key).toString("hex"),
  ]) {
    const echoed = payload !== null;
    const pixels = new Uint8Array(3073 * 1024);
    if (payload) pixels.set(new TextEncoder().encode(payload), 3073 * 100 + 1);
    function chunk(type: string, data: Uint8Array) {
      const bytes = new Uint8Array(data.length + 12),
        view = new DataView(bytes.buffer);
      view.setUint32(0, data.length);
      bytes.set(new TextEncoder().encode(type), 4);
      bytes.set(data, 8);
      view.setUint32(
        data.length + 8,
        crc32(bytes.subarray(4, data.length + 8)),
      );
      return bytes;
    }
    const header = new Uint8Array(13),
      view = new DataView(header.buffer);
    view.setUint32(0, 1024);
    view.setUint32(4, 1024);
    header.set([8, 2, 0, 0, 0], 8);
    const png = Buffer.concat([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", new Uint8Array()),
    ]);
    let uploads = 0;
    const byok = createByokSession(
      async (request) => {
        if (request.url === "https://openrouter.ai/api/v1/images")
          return Response.json({
            data: [
              { b64_json: png.toString("base64"), media_type: "image/png" },
            ],
          });
        if (request.url !== "https://storage.test/image")
          throw new Error("Unexpected network");
        uploads++;
        return new Response(null, { status: 200 });
      },
      "https://app.test",
      { imageFixture: true },
    );
    byok.replace("openrouter", key);
    const flow = new ImageFlow({
      source: () => ({ mode: "byok", provider: "openrouter" }),
      availability: () => ({ available: true, maximum: 0, fixture: true }),
      byok,
      pro: async () => {
        throw new Error("No fallback");
      },
      save: async (_id, image) => {
        await byok.fetch("https://storage.test/image", {
          method: "PUT",
          body: JSON.stringify(image),
        });
        return "https://storage.test/image";
      },
    });
    await flow.generate("tree");
    const state = flow.state().kind;
    const uploaded = await flow.upload();
    expect(uploads).toBe(echoed ? 0 : 1);
    expect(state).toBe(echoed ? "failed" : "completed");
    expect(uploaded).toBe(echoed ? null : "https://storage.test/image");
  }
}, 20_000);

import { expect, test } from "bun:test";
import { deflateSync, gzipSync } from "node:zlib";
import { createByokSession } from "../byok/session";
import { DeviceNarration } from "./device-flow";
import { crc32 } from "../images/format";
import { pcmWav } from "./portable";
const key = "opaque-compressed-device-credential-fixture";
const incidental = new Uint8Array([0, 0, 0x1f, 0x8b, 8, 0, 0, 0]);
function compressedRasterEcho() {
  const pixels = new Uint8Array(4097 * 1024);
  pixels.set(new TextEncoder().encode(key), 1);
  const chunk = (type: string, data: Uint8Array) => {
    const bytes = new Uint8Array(data.length + 12),
      view = new DataView(bytes.buffer);
    view.setUint32(0, data.length);
    bytes.set(new TextEncoder().encode(type), 4);
    bytes.set(data, 8);
    view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)));
    return bytes;
  };
  const header = new Uint8Array(13),
    view = new DataView(header.buffer);
  view.setUint32(0, 1024);
  view.setUint32(4, 1024);
  header.set([8, 6, 0, 0, 0], 8);
  const png = Buffer.concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", new Uint8Array()),
  ]);
  return new TextEncoder().encode(png.toString("base64"));
}
const echoes = [
  gzipSync(key),
  deflateSync(key),
  new TextEncoder().encode(gzipSync(key).toString("base64")),
  deflateSync("a".repeat(2_000_000)),
  compressedRasterEcho(),
].map((b) => (b.length % 2 ? new Uint8Array([...b, 0]) : b));
for (const [index, samples] of [
  ...echoes,
  incidental,
  new Uint8Array([0, 0, 80, 75, 3, 4, 0, 0, ...new Array(40).fill(0)]),
].entries()) {
  for (const retired of [false, true]) {
    test(`real browser adapter/checkpoint/guarded upload ${index}, retired=${retired}`, async () => {
      let provider = 0,
        app = 0;
      const byok = createByokSession(
        async (request) => {
          if (request.url.startsWith("https://openrouter.ai/")) {
            provider++;
            return new Response(samples, {
              headers: { "Content-Type": "audio/pcm" },
            });
          }
          app++;
          return Response.json({ id: "saved" });
        },
        "https://app.test",
        { narrationFixture: true },
      );
      byok.replace("openrouter", key);
      if (retired)
        byok.replace("openrouter", "new-synthetic-compression-credential");
      const disk = new Map<string, string>();
      const ports = {
        account: () => "alice",
        available: () => true,
        byok,
        store: {
          load: async (s: string) => disk.get(s) ?? null,
          save: async (s: string, v: string, expected: string | null) => {
            if ((disk.get(s) ?? null) !== expected) return false;
            disk.set(s, v);
            return true;
          },
          clear: async (s: string) => {
            disk.delete(s);
          },
        },
        sync: async (_id: string, recording: unknown) => {
          await byok.fetch("/recordings", {
            method: "POST",
            body: JSON.stringify(recording),
          });
          return "saved";
        },
      };
      const flow = new DeviceNarration("alice", "doc", ports);
      await flow.start("Hello");
      const safe = index >= echoes.length;
      expect(flow.state()?.parts.some((p) => p.kind === "completed")).toBe(
        safe,
      );
      const reopened = new DeviceNarration("alice", "doc", ports);
      await reopened.restore();
      await reopened.sync();
      const artifact = {
        mimeType: "audio/wav",
        parts: [
          {
            text: "Hello",
            audio: Buffer.from(pcmWav(samples)).toString("base64"),
            seconds: samples.length / 48000,
          },
        ],
      };
      if (safe) {
        expect(reopened.state()?.status).toBe("saved");
        expect(app).toBe(1);
      } else {
        expect(Array.from(disk.values()).join()).not.toContain(
          artifact.parts[0]?.audio ?? "invalid",
        );
        await expect(
          byok.fetch("/recordings", {
            method: "POST",
            body: JSON.stringify(artifact),
          }),
        ).rejects.toThrow();
        expect(app).toBe(0);
      }
      expect(provider).toBe(1);
    });
  }
}

test("prefix-heavy browser egress stops before app network instead of unbounded fingerprint work", async () => {
  let calls = 0;
  const byok = createByokSession(async () => {
    calls++;
    return new Response("{}");
  }, "https://app.test");
  byok.replace("openrouter", "hashwork-synthetic-credential-fixture");
  await expect(
    byok.fetch("/diagnostic", {
      method: "POST",
      body: JSON.stringify({ message: "hash".repeat(30_000) }),
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

test("sixty seconds of canonical tone can checkpoint and sync without a provider key", async () => {
  const pcm = new Uint8Array(60 * 48000);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < pcm.length / 2; i++)
    view.setInt16(
      i * 2,
      Math.round(2000 * Math.sin((2 * Math.PI * 220 * i) / 24000)),
      true,
    );
  let appCalls = 0;
  const byok = createByokSession(
    async (request) => {
      if (request.url === "https://openrouter.ai/api/v1/audio/speech")
        return new Response(pcm, { headers: { "Content-Type": "audio/pcm" } });
      if (request.url !== "https://app.test/recordings")
        throw new Error("Unexpected network");
      appCalls++;
      return Response.json({ id: "saved" });
    },
    "https://app.test",
    { narrationFixture: true },
  );
  byok.replace("openrouter", key);
  const disk = new Map<string, string>();
  const ports = {
    account: () => "alice",
    available: () => true,
    byok,
    store: {
      load: async (scope: string) => disk.get(scope) ?? null,
      save: async (scope: string, value: string, expected: string | null) => {
        if ((disk.get(scope) ?? null) !== expected) return false;
        disk.set(scope, value);
        return true;
      },
      clear: async (scope: string) => {
        disk.delete(scope);
      },
    },
    sync: async (_id: string, recording: unknown) => {
      await byok.fetch("/recordings", {
        method: "POST",
        body: JSON.stringify(recording),
      });
      return "saved";
    },
  };
  const flow = new DeviceNarration("alice", "doc", ports);
  await flow.start("Hello");
  expect(flow.state()?.status).toBe("completed");
  byok.remove();
  const reopened = new DeviceNarration("alice", "doc", ports);
  await reopened.restore();
  await reopened.sync();
  expect(reopened.state()?.status).toBe("saved");
  expect(appCalls).toBe(1);
}, 20_000);

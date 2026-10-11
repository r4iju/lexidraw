import { expect, test, mock } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { deflateSync, gzipSync } from "node:zlib";
import * as schema from "@packages/drizzle/drizzle-schema";
import { installServerRuntime } from "~/test/server-runtime";
import { pcmWav } from "~/lib/narration/portable";
import type { createTRPCContext } from "../trpc";
// Configuration is an external boundary; no secret environment files are loaded.
mock.module("@packages/env", () => ({
  default: {
    NODE_ENV: "test",
    NATIVE_SIGN_IN_CALLBACKS: ["lexidraw://auth/callback"],
  },
}));
const db = await installServerRuntime();
const { createDeviceNarrationRouter } = await import("./device-narration");
const { GeneratedRecordings } = await import(
  "~/server/entities/generated-recordings"
);
test("authenticated recording save admits incidental native samples, rejects compression before storage", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0026_generated_recordings.sql",
    ).text(),
  );
  let storageCalls = 0;
  const observed: Client = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (
          ["execute", "executeMultiple", "transaction"].includes(
            String(property),
          )
        )
          storageCalls++;
        return Reflect.apply(value, target, args);
      };
    },
  });
  const records = new GeneratedRecordings(observed, {
    now: () => 1000,
    canEdit: async (a, d) => a === "alice" && d === "doc",
    canRead: async (a, d) => a === "alice" && d === "doc",
  });
  const router = createDeviceNarrationRouter({
    records: () => records,
    read: async () => "Hello",
  });
  function caller(id: string | null) {
    const context = {
      drizzle: db,
      schema,
      headers: new Headers(),
      auth: { kind: "session" as const },
      session: id ? { user: { id }, expires: "2099-01-01" } : null,
    } satisfies Awaited<ReturnType<typeof createTRPCContext>>;
    return router.createCaller(context);
  }
  function input(samples: Uint8Array, id: string) {
    if (samples.length % 2) samples = new Uint8Array([...samples, 0]);
    return {
      documentId: "doc",
      idempotencyKey: id,
      recording: {
        mimeType: "audio/wav" as const,
        parts: [
          {
            text: "Hello",
            audio: Buffer.from(pcmWav(samples)).toString("base64"),
            seconds: samples.length / 48000,
          },
        ],
      },
    };
  }
  try {
    const incidental = input(
      new Uint8Array([0, 0, 0x1f, 0x8b, 8, 0, 0, 0]),
      "incidental",
    );
    await expect(caller(null).save(incidental)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(storageCalls).toBe(0);
    const saved = await caller("alice").save(incidental);
    expect(await caller("alice").saved({ documentId: "doc" })).toEqual({
      ...saved,
      recording: incidental.recording,
    });
    await expect(caller("bob").saved({ documentId: "doc" })).rejects.toThrow(
      "Read access",
    );
    for (const [index, samples] of [
      new Uint8Array([0, 0, 80, 75, 3, 4, 0, 0]),
      new Uint8Array([0, 0, 80, 75, 3, 4, 0, 0, ...new Array(40).fill(0)]),
    ].entries()) {
      const artifact = input(samples, `incidental-zip-${index}`);
      const result = await caller("alice").save(artifact);
      expect(await caller("alice").saved({ documentId: "doc" })).toEqual({
        ...result,
        recording: artifact.recording,
      });
    }
    // The server receives no device-key registry or secret fingerprints.
    const nodes = [
      gzipSync("opaque-synthetic-recording-credential"),
      deflateSync("opaque-synthetic-recording-credential"),
      new TextEncoder().encode(
        gzipSync("opaque-synthetic-recording-credential").toString("base64"),
      ),
      deflateSync("a".repeat(2_000_000)),
    ];
    for (const [i, bytes] of nodes.entries()) {
      storageCalls = 0;
      await expect(
        caller("alice").save(input(bytes, `blocked-${i}`)),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(storageCalls).toBe(0);
    }
    expect(
      (await client.execute("SELECT COUNT(*) n FROM generated_recordings"))
        .rows[0]?.n,
    ).toBe(3);
  } finally {
    client.close();
  }
});

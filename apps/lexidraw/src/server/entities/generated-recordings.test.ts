import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { GeneratedRecordings } from "./generated-recordings";
import { audioFromPCM } from "~/lib/narration/portable";

test("authenticated finished recording finalization is private, bounded, idempotent and keyless on another device", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0026_generated_recordings.sql",
    ).text(),
  );
  let now = 1000;
  const records = new GeneratedRecordings(client, {
    now: () => now,
    canEdit: async (a, d) => a === "alice" && d === "doc",
    canRead: async (a, d) => a === "alice" && d === "doc",
  });
  const recording = {
    mimeType: "audio/wav" as const,
    parts: [
      { text: "Hello", ...audioFromPCM(new Uint8Array(48000), () => {}) },
    ],
  };
  const input = { documentId: "doc", idempotencyKey: "same", recording };
  try {
    await expect(records.save("bob", input)).rejects.toThrow("Edit access");
    await expect(
      records.save("alice", {
        ...input,
        recording: { ...recording, apiKey: "forbidden" },
      }),
    ).rejects.toThrow();
    const [one, two] = await Promise.all([
      records.save("alice", input),
      records.save("alice", input),
    ]);
    expect(one).toEqual(two);
    expect(await records.saved("alice", "doc")).toEqual({ ...one, recording });
    await expect(records.saved("bob", "doc")).rejects.toThrow("Read access");
    await expect(
      records.save("alice", {
        ...input,
        recording: {
          ...recording,
          parts: [{ ...recording.parts[0], text: "Changed" }],
        },
      }),
    ).rejects.toThrow("Idempotency conflict");
    const grant = await records.authorize("alice", {
      ...input,
      idempotencyKey: "abandoned",
    });
    now += 600001;
    await expect(
      records.finalize("alice", grant, input.recording),
    ).rejects.toThrow("Upload expired");
    expect(await records.cleanup()).toBe(1);
  } finally {
    client.close();
  }
});

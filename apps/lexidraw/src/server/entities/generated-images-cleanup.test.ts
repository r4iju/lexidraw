import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { GeneratedImages } from "./generated-images";
import { fixtureImage } from "~/test/image-fixture";

test("expiry admits at most 100 legitimate partial uploads per cleanup", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0024_generated_images.sql",
    ).text(),
  );
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0033_generated_image_cleanup_cursor.sql",
    ).text(),
  );
  let now = 1000;
  const images = new GeneratedImages(client, {
    now: () => now,
    canEdit: async () => true,
    store: {
      async put() {
        throw new Error("synthetic outage");
      },
      async remove() {},
    },
  });
  try {
    for (let i = 0; i < 151; i++) {
      await expect(
        images.save(`account-${Math.floor(i / 100)}`, {
          entityId: "document",
          idempotencyKey: `upload-${i}`,
          image: fixtureImage(),
        }),
      ).rejects.toThrow("Image sync failed");
    }
    now += 600001;
    expect(await images.cleanup()).toBe(100);
    expect(await images.cleanup()).toBe(51);
    expect(await images.cleanup()).toBe(0);
  } finally {
    client.close();
  }
});

test("durable circular cleanup survives independent failures, reopen and late puts without losing tombstones", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { drizzle } = await import("drizzle-orm/libsql");
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const directory = await mkdtemp("/tmp/lexidraw-c-cleanup-");
  const migrations = join(directory, "migrations");
  await mkdir(join(migrations, "meta"), { recursive: true });
  const journal = await Bun.file(
    "../../packages/drizzle/drizzle/meta/_journal.json",
  ).json();
  // Minimal generated-image feature chain only, not the historical empty-DB baseline.
  const entries = journal.entries.filter((entry: { tag: string }) =>
    [
      "0024_generated_images",
      "0032_backend_migration_repair",
      "0033_generated_image_cleanup_cursor",
    ].includes(entry.tag),
  );
  await writeFile(
    join(migrations, "meta/_journal.json"),
    JSON.stringify({
      ...journal,
      entries: entries.filter(
        (entry: { tag: string }) =>
          entry.tag !== "0033_generated_image_cleanup_cursor",
      ),
    }),
  );
  for (const entry of entries) {
    await writeFile(
      join(migrations, `${entry.tag}.sql`),
      await Bun.file(`../../packages/drizzle/drizzle/${entry.tag}.sql`).text(),
    );
  }
  let client = createClient({ url: `file:${join(directory, "fixture.db")}` });
  await migrate(drizzle(client), { migrationsFolder: migrations });
  let now = 1000;
  const blobs = new Map<string, Uint8Array>();
  const attempts: string[] = [];
  let failRemoval = true;
  let persistentFailure = "";
  let releaseLate: () => void = () => {};
  let admitLate: () => void = () => {};
  const admitted = new Promise<void>((resolve) => {
    admitLate = resolve;
  });
  const lateGate = new Promise<void>((resolve) => {
    releaseLate = resolve;
  });
  let latePath = "";
  let mode: "registered" | "partial" | "late" = "registered";
  const deps = {
    now: () => now,
    canEdit: async () => true,
    canRead: async () => true,
    store: {
      async put(path: string, bytes: Uint8Array) {
        if (mode === "late") {
          latePath = path;
          admitLate();
          await lateGate;
        }
        blobs.set(path, bytes);
        if (mode === "partial") throw new Error("partial synthetic put");
        return path;
      },
      async read(path: string) {
        return blobs.get(path) ?? null;
      },
      async remove(path: string) {
        attempts.push(path);
        if (failRemoval || path === persistentFailure || path === latePath)
          throw new Error("synthetic removal outage");
        blobs.delete(path);
      },
    },
  };
  let images = new GeneratedImages(client, deps);
  const request = {
    entityId: "document",
    idempotencyKey: "registered",
    image: fixtureImage(),
  };
  try {
    const saved = await images.save("owner", request);
    const registeredPath = `generated-images/${saved.id}.png`;
    mode = "partial";
    for (let i = 0; i < 150; i++) {
      await expect(
        images.save(`partial-${Math.floor(i / 100)}`, {
          ...request,
          idempotencyKey: `partial-${i}`,
        }),
      ).rejects.toThrow("Image sync failed");
    }
    await writeFile(
      join(migrations, "meta/_journal.json"),
      JSON.stringify({ ...journal, entries }),
    );
    await migrate(drizzle(client), { migrationsFolder: migrations });
    mode = "late";
    const lateRequest = { ...request, idempotencyKey: "late" };
    const late = images.save("late-owner", lateRequest);
    const lateResult = late.then(
      () => false,
      (error: unknown) =>
        error instanceof Error && error.message.includes("Image sync failed"),
    );
    await admitted;
    now += 600001;
    expect(await images.cleanup()).toBe(100);
    expect(attempts.length).toBe(3);
    expect(new Set(attempts).size).toBe(3);
    persistentFailure = attempts[0] ?? "";
    failRemoval = false;
    const uploadingClient = client;
    client = createClient({ url: `file:${join(directory, "fixture.db")}` });
    await migrate(drizzle(client), { migrationsFolder: migrations });
    images = new GeneratedImages(client, deps);
    expect(await images.cleanup()).toBe(51);
    expect(new Set(attempts).size).toBe(6);
    releaseLate();
    expect(await lateResult).toBe(true);
    uploadingClient.close();
    const seen = new Set(attempts);
    for (let i = 0; i < 49; i++) {
      const start = attempts.length;
      expect(await images.cleanup()).toBe(0);
      const call = attempts.slice(start);
      expect(call.length).toBeLessThanOrEqual(3);
      expect(new Set(call).size).toBe(call.length);
      for (const path of call) seen.add(path);
      client.close();
      client = createClient({ url: `file:${join(directory, "fixture.db")}` });
      images = new GeneratedImages(client, deps);
    }
    expect(seen.size).toBe(151);
    expect(seen.has(registeredPath)).toBe(false);
    // A completed delete remains a tombstone and can be revisited after a late put.
    persistentFailure = "";
    latePath = "";
    for (let i = 0; i < 51; i++) await images.cleanup();
    expect([...blobs.keys()]).toEqual([registeredPath]);
    await expect(images.save("late-owner", lateRequest)).rejects.toThrow(
      "Upload expired",
    );
    await expect(
      images.save("partial-0", { ...request, idempotencyKey: "partial-0" }),
    ).rejects.toThrow("Upload expired");
    expect(await images.save("owner", request)).toEqual(saved);
    expect(await images.read("owner", saved.id)).toEqual(
      Buffer.from(request.image.base64, "base64"),
    );
    await migrate(drizzle(client), { migrationsFolder: migrations });
    expect(await images.read("owner", saved.id)).toEqual(
      Buffer.from(request.image.base64, "base64"),
    );
  } finally {
    releaseLate();
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});

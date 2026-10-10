import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { GeneratedImages } from "./generated-images";
import { fixtureImage } from "~/test/image-fixture";
test("saved image URLs require current document access and survive generation closure", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0024_generated_images.sql",
    ).text(),
  );
  const objects = new Map<string, Uint8Array>();
  let shared = false,
    deleted = false,
    reads = 0,
    writes = 0;
  const images = new GeneratedImages(client, {
    now: () => 1000,
    canEdit: async (account) => account === "alice" && !deleted,
    canRead: async (account) =>
      !deleted && (account === "alice" || (account === "bob" && shared)),
    store: {
      async put(path, bytes) {
        writes++;
        objects.set(path, bytes);
        return "https://private-bucket.test/never-return-this";
      },
      async remove(path) {
        objects.delete(path);
      },
      async read(path) {
        reads++;
        return objects.get(path) ?? null;
      },
    },
  });
  try {
    const input = {
      entityId: "document",
      idempotencyKey: "upload",
      image: fixtureImage(),
    };
    const saved = await images.save("alice", input);
    expect(saved.url).toBe(`/api/generated-images/${saved.id}`);
    expect(await images.save("alice", input)).toEqual(saved);
    expect(writes).toBe(1);
    expect(await images.read("bob", saved.id)).toBeNull();
    expect(reads).toBe(0);
    shared = true;
    expect(await images.read("bob", saved.id)).toEqual(
      Buffer.from(input.image.base64, "base64"),
    );
    shared = false;
    expect(await images.read("bob", saved.id)).toBeNull();
    deleted = true;
    expect(await images.read("alice", saved.id)).toBeNull();
  } finally {
    client.close();
  }
});

test("Pro agent image storage uses private registration and retries a partial upload without false registration", async () => {
  const { createAgentImageStore } = await import("./agent-image-store");
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0024_generated_images.sql",
    ).text(),
  );
  const objects = new Map<string, Uint8Array>();
  let now = 1000,
    fail = true;
  const images = new GeneratedImages(client, {
    now: () => now,
    canEdit: async () => true,
    canRead: async () => true,
    store: {
      async put(path, bytes) {
        objects.set(path, bytes);
        if (fail)
          throw new Error("private storage credential: synthetic-secret");
        return "never-expose";
      },
      async remove(path) {
        objects.delete(path);
      },
      async read(path) {
        return objects.get(path) ?? null;
      },
    },
  });
  try {
    const store = createAgentImageStore(() => images);
    await expect(
      store.save("alice", "document", "operation:image:0", fixtureImage()),
    ).rejects.toThrow("Image sync failed");
    const pending = (await client.execute("SELECT id FROM generated_images"))
      .rows[0];
    expect(await images.read("alice", String(pending?.id))).toBeNull();
    fail = false;
    const saved = await store.save(
      "alice",
      "document",
      "operation:image:0",
      fixtureImage(),
    );
    expect(saved).toMatch(/^\/api\/generated-images\//);
    expect(
      await store.save(
        "alice",
        "document",
        "operation:image:0",
        fixtureImage(),
      ),
    ).toBe(saved);
    fail = true;
    await expect(
      store.save("alice", "document", "abandoned:image:0", fixtureImage()),
    ).rejects.toThrow("Image sync failed");
    now += 600001;
    await images.cleanup();
    expect(objects.size).toBe(1);
  } finally {
    client.close();
  }
});

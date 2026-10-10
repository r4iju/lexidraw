import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { GeneratedImages } from "./generated-images";
import { fixtureImage } from "~/test/image-fixture";
import { createByokSession } from "~/lib/byok/session";
test("artifact upload is access checked, bounded, key-free, idempotent and retryable without provider or ledger calls", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0024_generated_images.sql",
    ).text(),
  );
  const blobs = new Map<string, Uint8Array>();
  let failed = true,
    writes = 0,
    now = 1000;
  const images = new GeneratedImages(client, {
    now: () => now,
    canEdit: async (account, entity) =>
      account === "alice" && entity === "document",
    store: {
      async put(path, bytes) {
        writes++;
        if (failed) throw new Error("storage failure");
        blobs.set(path, bytes);
        return `https://storage.test/${path}`;
      },
      async remove(path) {
        blobs.delete(path);
      },
    },
  });
  const request = {
    idempotencyKey: "upload",
    entityId: "document",
    image: fixtureImage(),
  };
  try {
    await expect(images.save("bob", request)).rejects.toThrow("Edit access");
    await expect(
      images.save("alice", {
        ...request,
        image: { ...request.image, providerConfig: "forbidden" },
      }),
    ).rejects.toThrow();
    await expect(images.save("alice", request)).rejects.toThrow(
      "Image sync failed",
    );
    failed = false;
    const saved = await images.save("alice", request);
    expect(saved.url).toMatch(/^https:\/\/storage.test\//);
    expect(await images.save("alice", request)).toEqual(saved);
    expect(writes).toBe(2);
    const session = createByokSession(async () => {
      throw new Error("unexpected network");
    }, "https://app.test");
    const key = "sk-or-v1-PRIVATE-IMAGE-SECRET";
    session.replace("openrouter", key);
    session.remove();
    await expect(
      images.save(
        "alice",
        {
          ...request,
          idempotencyKey: "secret",
          image: { ...request.image, base64: btoa(key) },
        },
        session.assertSafe,
      ),
    ).rejects.toThrow();
    await expect(
      images.save("alice", { ...request, entityId: "another" }),
    ).rejects.toThrow("Edit access");
    expect(blobs.size).toBe(1);
    failed = true;
    await expect(
      images.save("alice", { ...request, idempotencyKey: "abandoned" }),
    ).rejects.toThrow();
    now += 600_001;
    expect(await images.cleanup()).toBe(1);
    expect(blobs.size).toBe(1);
  } finally {
    client.close();
  }
});

test("late duplicate upload cannot delete an already registered saved image", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0024_generated_images.sql",
    ).text(),
  );
  let now = 1000,
    writes = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blobs = new Map<string, Uint8Array>();
  const images = new GeneratedImages(client, {
    now: () => now,
    canEdit: async () => true,
    store: {
      async put(path, data) {
        if (++writes === 1) await gate;
        blobs.set(path, data);
        return `https://storage.test/${path}`;
      },
      async remove(path) {
        blobs.delete(path);
      },
    },
  });
  const request = {
    idempotencyKey: "same",
    entityId: "document",
    image: fixtureImage(),
  };
  try {
    const first = images.save("alice", request);
    while (writes === 0) await Bun.sleep(1);
    now += 31000;
    const second = await images.save("alice", request);
    release();
    expect(await first).toEqual(second);
    expect(blobs.size).toBe(1);
  } finally {
    release();
    client.close();
  }
});

test("encoded SDK envelope cannot masquerade as PNG image pixels", async () => {
  const { deflateSync } = await import("node:zlib");
  const { crc32 } = await import("~/lib/images/format");
  const original = Buffer.from(fixtureImage().base64, "base64");
  const data = deflateSync(
    Buffer.from('{"providerConfig":{"key":"fixture-secret"}}'),
  );
  const idat = Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("IDAT"),
    data,
    Buffer.alloc(4),
  ]);
  idat.writeUInt32BE(data.length);
  idat.writeUInt32BE(crc32(idat.subarray(4, -4)), idat.length - 4);
  const image = {
    ...fixtureImage(),
    base64: Buffer.concat([
      original.subarray(0, 33),
      idat,
      original.subarray(original.length - 12),
    ]).toString("base64"),
  };
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await Bun.file(
      "../../packages/drizzle/drizzle/0024_generated_images.sql",
    ).text(),
  );
  let uploaded = false;
  const images = new GeneratedImages(client, {
    now: () => 1000,
    canEdit: async () => true,
    store: {
      async put() {
        uploaded = true;
        return "https://storage.test/image.png";
      },
      async remove() {},
    },
  });
  try {
    await expect(
      images.save("alice", {
        idempotencyKey: "envelope",
        entityId: "document",
        image,
      }),
    ).rejects.toThrow();
    expect(uploaded).toBe(false);
  } finally {
    client.close();
  }
});

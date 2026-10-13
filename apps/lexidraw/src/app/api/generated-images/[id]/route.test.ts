import { expect, test, mock } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";
import * as schema from "@packages/drizzle/drizzle-schema";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { hashApiToken } from "~/server/auth/api-token-format";
import { GeneratedImages } from "~/server/entities/generated-images";

import { fixtureImage } from "~/test/image-fixture";
import { PublicAccess, AccessLevel } from "@packages/types";
const db = await installServerRuntime();
const { findEntityWith, findReadableFacts } = await import(
  "~/server/entities/readable"
);
let cookieAccount: string | null = null;
mock.module("~/server/auth", () => ({
  authEffective: async () =>
    cookieAccount ? { user: { id: cookieAccount } } : null,
}));
let corrupt = false;
let readGate: (() => Promise<void>) | undefined;
const blobs = new Map<string, Uint8Array>();
const client = createClient({ url: ":memory:" });
await client.executeMultiple(
  await Bun.file(
    "../../packages/drizzle/drizzle/0024_generated_images.sql",
  ).text(),
);
const images = new GeneratedImages(client, {
  now: Date.now,
  canEdit: async (a, d) => !!(await findEntityWith(db, d, a, "edit")),
  canRead: async (a, d) => !!(await findReadableFacts(db, d, a)),
  store: {
    async put(path, bytes) {
      blobs.set(path, bytes);
      return "private-url";
    },
    async remove(path) {
      blobs.delete(path);
    },
    async read(path) {
      await readGate?.();
      return corrupt ? new Uint8Array([1]) : (blobs.get(path) ?? null);
    },
  },
});
mock.module("~/server/pro/image-runtime", () => ({
  generatedImages: () => images,
}));
const { GET } = await import("./route");
test("authenticated image route supports web cookies/native tokens, current shares, deletion, bounded output and private caches", async () => {
  await db.insert(schema.users).values([
    { id: "alice", name: "Alice", email: "alice@images.test" },
    { id: "bob", name: "Bob", email: "bob@images.test" },
  ]);
  await db.insert(schema.entities).values({
    id: "document",
    userId: "alice",
    title: "Image",
    entityType: "document",
    publicAccess: PublicAccess.PRIVATE,
    elements: "{}",
    appState: "{}",
  });
  await db.insert(schema.apiTokens).values({
    id: "token",
    userId: "alice",
    tokenHash: hashApiToken("lxd_image_read"),
    name: "native",
    scope: "read",
  });
  const image = fixtureImage();
  const saved = await images.save("alice", {
    entityId: "document",
    idempotencyKey: "image",
    image,
  });
  const get = (headers: HeadersInit = {}) =>
    GET(new Request(`https://app.test${saved.url}`, { headers }), {
      params: Promise.resolve({ id: saved.id }),
    });
  expect((await get()).status).toBe(404);
  cookieAccount = "alice";
  const web = await get({ cookie: "synthetic-session" });
  expect(web.status).toBe(200);
  expect(web.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(web.headers.get("vary")).toBe("Cookie, Authorization");
  expect(web.headers.get("content-type")).toBe("image/png");
  expect(web.headers.get("x-content-type-options")).toBe("nosniff");
  expect(web.headers.get("location")).toBeNull();
  expect(Buffer.from(await web.arrayBuffer())).toEqual(
    Buffer.from(image.base64, "base64"),
  );
  cookieAccount = null;
  expect((await get({ authorization: "Bearer lxd_image_read" })).status).toBe(
    200,
  );
  expect((await get({ authorization: "Bearer lxd_revoked" })).status).toBe(401);
  cookieAccount = "bob";
  expect((await get()).status).toBe(404);
  await db.insert(schema.sharedEntities).values({
    id: "share",
    entityId: "document",
    userId: "bob",
    accessLevel: AccessLevel.READ,
  });
  expect((await get()).status).toBe(200);
  await expect(
    images.save("bob", {
      entityId: "document",
      idempotencyKey: "viewer",
      image,
    }),
  ).rejects.toThrow();
  await db
    .delete(schema.sharedEntities)
    .where(eq(schema.sharedEntities.userId, "bob"));
  expect((await get()).status).toBe(404);
  cookieAccount = "alice";
  corrupt = true;
  const bad = await get();
  expect(bad.status).toBe(503);
  expect(await bad.text()).not.toContain("private-url");
  corrupt = false;
  await db
    .update(schema.entities)
    .set({ deletedAt: new Date() })
    .where(eq(schema.entities.id, "document"));
  expect((await get()).status).toBe(404);
});

test("anonymous image delivery follows live nonprivate document ACL and supplied auth remains strict", async () => {
  await db.insert(schema.users).values({
    id: "public-owner",
    name: "Owner",
    email: "public-owner@images.test",
  });
  cookieAccount = null;
  for (const access of [
    PublicAccess.READ,
    PublicAccess.EDIT,
    PublicAccess.PRIVATE,
  ]) {
    const entityId = `public-image-${access}`;
    await db.insert(schema.entities).values({
      id: entityId,
      userId: "public-owner",
      title: "Public image",
      entityType: "document",
      publicAccess: access,
      elements: "{}",
      appState: "{}",
    });
    const image = fixtureImage();
    const saved = await images.save("public-owner", {
      entityId,
      idempotencyKey: entityId,
      image,
    });
    const get = (headers: HeadersInit = {}, id = saved.id) =>
      GET(new Request(`https://app.test${saved.url}`, { headers }), {
        params: Promise.resolve({ id }),
      });
    const response = await get();
    expect(response.status).toBe(access === PublicAccess.PRIVATE ? 404 : 200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    expect(response.headers.get("location")).toBeNull();
    if (access !== PublicAccess.PRIVATE) {
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        Buffer.from(image.base64, "base64"),
      );
      cookieAccount = "public-owner";
      for (const authorization of [
        "",
        "Basic synthetic",
        "Bearer malformed",
        "Bearer lxd_revoked_public",
      ]) {
        const denied = await get({
          authorization,
          cookie: "synthetic-valid-session",
        });
        expect(denied.status).toBe(401);
        expect(denied.headers.get("cache-control")).toBe(
          "private, no-store, max-age=0",
        );
      }
      cookieAccount = null;
    }
    expect((await get({}, crypto.randomUUID())).status).toBe(404);
    expect((await get({}, "invalid")).status).toBe(404);
    await db
      .update(schema.entities)
      .set({ deletedAt: new Date() })
      .where(eq(schema.entities.id, entityId));
    expect((await get()).status).toBe(404);
  }
});

for (const revoke of ["privacy", "deletion", "registration"] as const) {
  test(`anonymous in-flight image read rejects ${revoke} changes after awaited storage`, async () => {
    cookieAccount = null;
    const entityId = `inflight-${revoke}`;
    await db.insert(schema.users).values({
      id: entityId,
      name: "Owner",
      email: `${entityId}@images.test`,
    });
    await db.insert(schema.entities).values({
      id: entityId,
      userId: entityId,
      title: "Public",
      entityType: "document",
      publicAccess: PublicAccess.READ,
      elements: "{}",
      appState: "{}",
    });
    const saved = await images.save(entityId, {
      entityId,
      idempotencyKey: entityId,
      image: fixtureImage(),
    });
    let admit: () => void = () => {};
    let release: () => void = () => {};
    const admitted = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    readGate = async () => {
      admit();
      await gate;
    };
    try {
      const pending = GET(new Request(`https://app.test${saved.url}`), {
        params: Promise.resolve({ id: saved.id }),
      });
      expect(
        await Promise.race([
          admitted.then(() => true),
          pending.then(() => false),
        ]),
      ).toBe(true);
      if (revoke === "registration") {
        await client.execute({
          sql: "UPDATE generated_images SET state='abandoned' WHERE id=?",
          args: [saved.id],
        });
      } else {
        await db
          .update(schema.entities)
          .set(
            revoke === "privacy"
              ? { publicAccess: PublicAccess.PRIVATE }
              : { deletedAt: new Date() },
          )
          .where(eq(schema.entities.id, entityId));
      }
      release();
      const response = await pending;
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0",
      );
    } finally {
      release();
      readGate = undefined;
    }
  });
}

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
  await db
    .insert(schema.entities)
    .values({
      id: "document",
      userId: "alice",
      title: "Image",
      entityType: "document",
      publicAccess: PublicAccess.PRIVATE,
      elements: "{}",
      appState: "{}",
    });
  await db
    .insert(schema.apiTokens)
    .values({
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
  expect((await get()).status).toBe(401);
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
  await db
    .insert(schema.sharedEntities)
    .values({
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

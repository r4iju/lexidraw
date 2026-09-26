/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { default: env } = await import("@packages/env");
const HOST = new URL(env.VERCEL_BLOB_STORAGE_HOST).origin;

/** What reached the store, by pathname. */
const stored = new Map<string, { body: Buffer; options: object }>();
// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
mock.module("@vercel/blob", () => ({
  ...realBlob,
  put: async (pathname: string, body: Buffer, options: object) => {
    stored.set(pathname, { body, options });
    return { url: `${HOST}/${pathname}`, pathname };
  },
}));
/** The picture the page being read names as its own. */
let pagePicture: string | undefined;
const realExtractor = await import("~/server/extractors/article");
mock.module("~/server/extractors/article", () => ({
  ...realExtractor,
  extractAndSanitizeArticle: async ({ url }: { url: string }) => ({
    bestImageUrl: pagePicture,
    status: "ready",
    title: `Read from ${url}`,
    contentHtml: `<p>${"A sentence long enough to count as an article. ".repeat(20)}</p>`,
    wordCount: 180,
    updatedAt: "2026-09-26T00:00:00.000Z",
  }),
}));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "eimp_owner";
const READER = "eimp_reader";
const DOC = "eimp_doc";
const LINK = "eimp_link";
const callerOf = (userId: string) =>
  entityRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
const at = new Date("2026-09-01T00:00:00.000Z");
const row = (
  id: string,
  entityType: string,
  title: string,
  elements: string,
) => ({
  id,
  title,
  elements,
  entityType,
  userId: OWNER,
  publicAccess: PublicAccess.PRIVATE,
  createdAt: at,
  updatedAt: at,
});

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "eimp-owner@example.test" },
    { id: READER, name: "Reader", email: "eimp-reader@example.test" },
  ]);
  await db
    .insert(schema.entities)
    .values([
      row(DOC, "document", "Photos", "{}"),
      row(
        LINK,
        "url",
        "New link",
        JSON.stringify({ url: "https://example.com/post" }),
      ),
    ]);
  await db.insert(schema.sharedEntities).values({
    id: `${DOC}-${READER}`,
    entityId: DOC,
    userId: READER,
    accessLevel: AccessLevel.READ,
  });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("an image sent for a document", () => {
  test("is stored among the document's uploads, and answered with its address", async () => {
    const { url } = await callerOf(OWNER).uploadImage({
      id: DOC,
      contentType: "image/png",
      data: PNG.toString("base64"),
    });

    const pathname = decodeURIComponent(new URL(url).pathname.slice(1));
    expect(pathname).toMatch(new RegExp(`^${DOC}-[0-9a-f-]{36}\\.png$`));
    expect(stored.get(pathname)?.body.equals(PNG)).toBe(true);
    expect(stored.get(pathname)?.options).toMatchObject({
      access: "public",
      contentType: "image/png",
    });
    // The hourly cleanup keeps only the blobs a row points at.
    const [upload] = await db
      .select()
      .from(schema.uploadedImages)
      .where(eq(schema.uploadedImages.fileName, pathname));
    expect(upload).toMatchObject({
      entityId: DOC,
      userId: OWNER,
      signedDownloadUrl: url,
    });
  });

  test("is refused to someone who may only read the document", async () => {
    await expect(
      callerOf(READER).uploadImage({
        id: DOC,
        contentType: "image/png",
        data: PNG.toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("over the size a request can carry is refused, saying so", async () => {
    await expect(
      callerOf(OWNER).uploadImage({
        id: DOC,
        contentType: "image/jpeg",
        data: Buffer.alloc(3_000_001).toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });
});

describe("reading a saved link's page", () => {
  test("answers the link, titled from the page", async () => {
    const read = await callerOf(OWNER).distillUrl({ id: LINK });

    expect(read).toMatchObject({
      id: LINK,
      title: "Read from https://example.com/post",
      entityType: "url",
      parentId: null,
    });
  });

  test("keeps no picture the page names at a private address", async () => {
    pagePicture = "http://169.254.169.254/latest/meta-data/";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(PNG)) as unknown as typeof fetch;
    try {
      await callerOf(OWNER).distillUrl({ id: LINK });
    } finally {
      globalThis.fetch = realFetch;
      pagePicture = undefined;
    }

    const [link] = await db
      .select()
      .from(schema.entities)
      .where(eq(schema.entities.id, LINK));
    expect(link?.screenShotLight).toBeFalsy();
    expect([...stored.keys()].filter((key) => key.includes(LINK))).toEqual([]);
  });
});

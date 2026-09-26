/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
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
/** What the store deleted, by address. */
const deleted: string[] = [];
// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
mock.module("@vercel/blob", () => ({
  ...realBlob,
  put: async (pathname: string, body: Buffer, options: object) => {
    stored.set(pathname, { body, options });
    return { url: `${HOST}/${pathname}`, pathname };
  },
  del: async (urls: string | string[]) => {
    deleted.push(...[urls].flat());
  },
}));
/** What each client token was asked to allow. */
const tokensAsked: Record<string, unknown>[] = [];
const realBlobClient = await import("@vercel/blob/client");
mock.module("@vercel/blob/client", () => ({
  ...realBlobClient,
  generateClientTokenFromReadWriteToken: async (
    options: Record<string, unknown>,
  ) => {
    tokensAsked.push(options);
    return "vercel_blob_client_store_token";
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

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

/** The pictures the app sent to the store, answered at their addresses. */
const sent = new Map<string, Buffer>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith(`${HOST}/`)) return realFetch(input, init);
  const body = sent.get(url);
  return body
    ? new Response(new Uint8Array(body), { status: 206 })
    : new Response("Not found", { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

/** A picture the app signed and sent as `bytes`, answering its address. */
async function sentPicture(bytes: Buffer, userId = OWNER) {
  const { url } = await callerOf(userId).signImageUpload({
    contentType: "image/png",
    size: bytes.length,
  });
  sent.set(url, bytes);
  return url;
}

const recordedUploads = (entityId: string) =>
  db
    .select()
    .from(schema.uploadedImages)
    .where(eq(schema.uploadedImages.entityId, entityId));

describe("a picture the app sends", () => {
  test("is signed to go straight to the store, into no file yet", async () => {
    const signed = await callerOf(OWNER).signImageUpload({
      contentType: "image/png",
      size: PNG.length,
    });

    const pathname = decodeURIComponent(new URL(signed.url).pathname.slice(1));
    expect(pathname).toMatch(new RegExp(`^${OWNER}-[0-9a-f-]{36}\\.png$`));
    expect(signed.upload.method).toBe("PUT");
    expect(new URL(signed.upload.url).searchParams.get("pathname")).toBe(
      pathname,
    );
    expect(signed.upload.headers).toMatchObject({
      authorization: expect.stringMatching(/^Bearer vercel_blob_client_/),
      "x-content-type": "image/png",
    });
    // Unrecorded, so the hourly cleanup deletes it unless a file takes it.
    const rows = await db
      .select()
      .from(schema.uploadedImages)
      .where(eq(schema.uploadedImages.fileName, pathname));
    expect(rows).toEqual([]);
  });

  test("may only be that picture: its name, its type, its size, and soon", async () => {
    const signed = await callerOf(OWNER).signImageUpload({
      contentType: "image/webp",
      size: 1234,
    });

    const allowed = tokensAsked.at(-1);
    expect(allowed).toMatchObject({
      pathname: decodeURIComponent(new URL(signed.url).pathname.slice(1)),
      allowedContentTypes: ["image/webp"],
      maximumSizeInBytes: 1234,
      addRandomSuffix: false,
    });
    expect(Number(allowed?.validUntil) - Date.now()).toBeLessThanOrEqual(
      10 * 60_000,
    );
  });

  test("is refused as SVG, which can carry script", async () => {
    await expect(
      callerOf(OWNER).signImageUpload({
        contentType: "image/svg+xml" as never,
        size: SVG.length,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("over the size the web takes is refused, saying so", async () => {
    await expect(
      callerOf(OWNER).signImageUpload({
        contentType: "image/jpeg",
        size: 10 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: expect.stringContaining("10 MB"),
    });
  });
});

describe("a document the app makes", () => {
  test("is made with its markdown in one request", async () => {
    await callerOf(OWNER).create({
      id: "eimp_notes",
      entityType: "document",
      title: "Groceries",
      markdown: "Milk\n\n- eggs",
    });

    const [notes] = await db
      .select()
      .from(schema.entities)
      .where(eq(schema.entities.id, "eimp_notes"));
    expect(notes?.title).toBe("Groceries");
    const blocks = JSON.parse(notes?.elements ?? "{}").root.children;
    expect(blocks.map((block: { type: string }) => block.type)).toEqual([
      "paragraph",
      "list",
    ]);
  });

  test("keeps the pictures the caller sent for it", async () => {
    const url = await sentPicture(PNG);

    await callerOf(OWNER).create({
      id: "eimp_photo",
      entityType: "document",
      title: "Whiteboard",
      markdown: `From the meeting\n\n![](${url})`,
    });

    expect(await recordedUploads("eimp_photo")).toMatchObject([
      {
        userId: OWNER,
        fileName: decodeURIComponent(new URL(url).pathname.slice(1)),
        signedDownloadUrl: url,
      },
    ]);
  });

  test("is refused, and the picture deleted, when what was sent is no raster image", async () => {
    const url = await sentPicture(SVG);

    await expect(
      callerOf(OWNER).create({
        id: "eimp_script",
        entityType: "document",
        markdown: `![](${url})`,
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });

    expect(deleted).toContain(url);
    const made = await db
      .select()
      .from(schema.entities)
      .where(eq(schema.entities.id, "eimp_script"));
    expect(made).toEqual([]);
  });

  test("is refused when a picture it names was never sent", async () => {
    const { url } = await callerOf(OWNER).signImageUpload({
      contentType: "image/png",
      size: PNG.length,
    });

    await expect(
      callerOf(OWNER).create({
        id: "eimp_unsent",
        entityType: "document",
        markdown: `![](${url})`,
      }),
    ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
  });

  test("does not take someone else's picture for its own", async () => {
    const theirs = await sentPicture(PNG, READER);

    await callerOf(OWNER).create({
      id: "eimp_borrowed",
      entityType: "document",
      markdown: `![](${theirs})`,
    });

    expect(await recordedUploads("eimp_borrowed")).toEqual([]);
  });

  test("takes markdown only for a document, and not beside its content", async () => {
    await expect(
      callerOf(OWNER).create({
        id: "eimp_md_drawing",
        entityType: "drawing",
        markdown: "Hi",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      callerOf(OWNER).create({
        id: "eimp_md_both",
        entityType: "document",
        elements: "{}",
        markdown: "Hi",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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

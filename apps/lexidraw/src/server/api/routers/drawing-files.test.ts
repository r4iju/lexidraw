/// <reference types="bun" />
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { hashApiToken } from "~/server/auth/api-token-format";
import { MAX_DRAWING_FILE_BYTES } from "~/lib/drawing-files";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { default: env } = await import("@packages/env");
const HOST = new URL(env.VERCEL_BLOB_STORAGE_HOST).origin;

type Stored = {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  uploadedAt: Date;
};
/** The store, by pathname, and what each `put` asked of it. */
const stored = new Map<string, Stored>();
const puts: { pathname: string; options: Record<string, unknown> }[] = [];
// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
mock.module("@vercel/blob", () => ({
  ...realBlob,
  put: async (
    pathname: string,
    body: Blob | Buffer,
    options: Record<string, unknown>,
  ) => {
    puts.push({ pathname, options });
    stored.set(pathname, {
      bytes: new Uint8Array(
        body instanceof Blob ? await body.arrayBuffer() : body,
      ),
      contentType: String(options.contentType),
      uploadedAt: new Date(),
    });
    return { url: `${HOST}/${pathname}`, pathname };
  },
  list: async ({ prefix = "" }: { prefix?: string } = {}) => ({
    blobs: [...stored]
      .filter(([pathname]) => pathname.startsWith(prefix))
      .map(([pathname, blob]) => ({
        pathname,
        url: `${HOST}/${pathname}`,
        downloadUrl: `${HOST}/${pathname}?download=1`,
        size: blob.bytes.length,
        uploadedAt: blob.uploadedAt,
        etag: pathname,
      })),
    hasMore: false,
  }),
}));
// A public blob is read over plain HTTP, which here reaches the fake store
// and nothing else.
const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== HOST) throw new Error(`No network in tests: ${url}`);
  const blob = stored.get(decodeURIComponent(url.pathname.slice(1)));
  return blob
    ? new Response(blob.bytes, {
        headers: { "content-type": blob.contentType },
      })
    : new Response("not found", { status: 404 });
}) as typeof fetch;

const { drawingRouter } = await import("~/server/api/routers/drawings");
const restRoute = await import("~/app/api/v1/[...trpc]/route");

const OWNER = "dfiles_owner";
const READER = "dfiles_reader";
const STRANGER = "dfiles_stranger";
const DRAWING = "dfiles_drawing";
const OTHER = "dfiles_other";
const TOKEN = "lxd_dfiles_write";
const at = new Date("2026-09-01T00:00:00.000Z");

/** A 1x1 red PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const FILE_ID = "a".repeat(40);

function callerOf(userId: string) {
  return drawingRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: userId } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
}
const owner = callerOf(OWNER);

beforeAll(async () => {
  await db.insert(schema.users).values([
    { id: OWNER, name: "Owner", email: "dfiles-owner@example.test" },
    { id: READER, name: "Reader", email: "dfiles-reader@example.test" },
    { id: STRANGER, name: "Stranger", email: "dfiles-stranger@example.test" },
  ]);
  await db.insert(schema.apiTokens).values({
    userId: OWNER,
    name: "phone",
    scope: "write",
    tokenHash: hashApiToken(TOKEN),
  });
  const image = {
    type: "image",
    id: "picture",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fileId: FILE_ID,
    status: "saved",
    scale: [1, 1],
    crop: null,
  };
  await db.insert(schema.entities).values(
    [DRAWING, OTHER].map((id) => ({
      id,
      title: id,
      elements: JSON.stringify([image]),
      entityType: "drawing",
      userId: OWNER,
      publicAccess: PublicAccess.PRIVATE,
      createdAt: at,
      updatedAt: at,
    })),
  );
  await db.insert(schema.sharedEntities).values({
    id: "dfiles_share",
    entityId: DRAWING,
    userId: READER,
    accessLevel: AccessLevel.READ,
  });
});

beforeEach(() => {
  stored.clear();
  puts.length = 0;
});

describe("a drawing's files", () => {
  test("are stored as their own type under the drawing, leaving the drawing as it was", async () => {
    const before = Date.now();
    const answer = await owner.putFile({
      id: DRAWING,
      fileId: FILE_ID,
      mimeType: "image/png",
      dataURL: PNG_URL,
    });
    expect(answer).toMatchObject({ id: FILE_ID, mimeType: "image/png" });
    expect(answer.created).toBeGreaterThanOrEqual(before);

    expect(puts).toHaveLength(1);
    const [put] = puts;
    expect(put?.pathname).toStartWith(`drawings/${DRAWING}/files/${FILE_ID}`);
    expect(put?.options).toMatchObject({
      access: "public",
      contentType: "image/png",
      addRandomSuffix: false,
    });
    expect(stored.get(put?.pathname ?? "")?.bytes).toEqual(new Uint8Array(PNG));
    const [drawing] = await db
      .select({ updatedAt: schema.entities.updatedAt })
      .from(schema.entities)
      .where(eq(schema.entities.id, DRAWING));
    expect(drawing?.updatedAt).toEqual(at);
  });

  test("are listed with where to fetch each, for that drawing only", async () => {
    for (const id of [DRAWING, OTHER]) {
      await owner.putFile({
        id,
        fileId: FILE_ID,
        mimeType: "image/png",
        dataURL: PNG_URL,
      });
    }
    const { files } = await owner.files({ id: DRAWING });
    expect(files).toEqual([
      {
        id: FILE_ID,
        mimeType: "image/png",
        url: `${HOST}/${puts[0]?.pathname}`,
        created: expect.any(Number),
      },
    ]);
    const fetched = await fetch(files[0]?.url ?? "");
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(
      new Uint8Array(PNG),
    );
  });

  // The id is the hash of the bytes, so a second upload is the same file.
  test("are stored once however often one is sent", async () => {
    const file = {
      id: DRAWING,
      fileId: FILE_ID,
      mimeType: "image/png",
      dataURL: PNG_URL,
    };
    await owner.putFile(file);
    await owner.putFile(file);
    expect(puts.map((put) => put.options.allowOverwrite)).toEqual([true, true]);
    expect((await owner.files({ id: DRAWING })).files).toHaveLength(1);
  });

  const over = Buffer.alloc(MAX_DRAWING_FILE_BYTES + 1).toString("base64");
  test.each([
    ["a type other than it declares", "image/jpeg", PNG_URL, /image\/png/],
    [
      "a type a drawing does not store",
      "image/bmp",
      "data:image/bmp;base64,Qk0=",
      /cannot store image\/bmp/,
    ],
    [
      "more than a drawing stores",
      "image/png",
      `data:image/png;base64,${over}`,
      /over the 3 MB/,
    ],
    [
      "anything but base64",
      "image/svg+xml",
      "data:image/svg+xml,<svg/>",
      /base64/,
    ],
  ])("refuse a file of %s", async (_, mimeType, dataURL, reason) => {
    const refused = owner.putFile({
      id: DRAWING,
      fileId: FILE_ID,
      mimeType,
      dataURL,
    });
    await expect(refused).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(reason),
    });
    expect(puts).toHaveLength(0);
  });

  test("refuse an id that is not a file id", async () => {
    const refused = owner.putFile({
      id: DRAWING,
      fileId: "../../elsewhere",
      mimeType: "image/png",
      dataURL: PNG_URL,
    });
    await expect(refused).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(puts).toHaveLength(0);
  });

  test("are listed to a reader, who cannot add one", async () => {
    const reader = callerOf(READER);
    expect(await reader.files({ id: DRAWING })).toEqual({ files: [] });
    await expect(
      reader.putFile({
        id: DRAWING,
        fileId: FILE_ID,
        mimeType: "image/png",
        dataURL: PNG_URL,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(puts).toHaveLength(0);
  });

  test("are not listed to someone the drawing is not shared with", async () => {
    await expect(
      callerOf(STRANGER).files({ id: DRAWING }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("travel over REST as the app sends and fetches them", async () => {
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    };
    const url = `http://lexidraw.test/api/v1/drawings/${DRAWING}/files`;
    const put = await restRoute.PUT(
      new Request(`${url}/${FILE_ID}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ mimeType: "image/png", dataURL: PNG_URL }),
      }),
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      id: FILE_ID,
      mimeType: "image/png",
    });
    const listed = await restRoute.GET(new Request(url, { headers }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).files).toEqual([
      expect.objectContaining({ id: FILE_ID, mimeType: "image/png" }),
    ]);
  });

  test("are drawn where the drawing's image elements show them", async () => {
    await owner.putFile({
      id: DRAWING,
      fileId: FILE_ID,
      mimeType: "image/png",
      dataURL: PNG_URL,
    });
    const { data } = await owner.render({ id: DRAWING, format: "svg" });
    expect(data).toContain(PNG_URL);
  });
});

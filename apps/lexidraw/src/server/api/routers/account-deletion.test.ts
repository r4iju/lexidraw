/// <reference types="bun" />
import { describe, expect, mock, spyOn, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { AccessLevel, PublicAccess } from "@packages/types";
import { and, eq, inArray } from "drizzle-orm";
import { hashApiToken } from "~/server/auth/api-token-format";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { default: env } = await import("@packages/env");
const HOST = new URL(env.VERCEL_BLOB_STORAGE_HOST).origin;

/** The store's pathnames, and what was asked to go from it. */
const stored = new Set<string>();
const deleted: string[] = [];
let deleteFailure: Error | undefined;
const pathnameOf = (urlOrPathname: string) =>
  urlOrPathname.startsWith("http")
    ? decodeURIComponent(new URL(urlOrPathname).pathname.slice(1))
    : urlOrPathname;
// `.env.test` carries a real store token, so nothing here may reach the store.
const realBlob = await import("@vercel/blob");
mock.module("@vercel/blob", () => ({
  ...realBlob,
  list: async ({ prefix = "" }: { prefix?: string } = {}) => ({
    blobs: [...stored]
      .filter((pathname) => pathname.startsWith(prefix))
      .map((pathname) => ({ pathname, url: `${HOST}/${pathname}` })),
    hasMore: false,
  }),
  del: async (urls: string | string[]) => {
    if (deleteFailure) throw deleteFailure;
    for (const url of [urls].flat()) {
      deleted.push(pathnameOf(url));
      stored.delete(pathnameOf(url));
    }
  },
}));

const { appRouter } = await import("~/server/api/root");
const { POST: rest, GET: restGet } = await import(
  "~/app/api/v1/[...trpc]/route"
);
const { GET: authGet } = await import("~/app/api/auth/[...nextauth]/route");
const { encode } = await import("next-auth/jwt");
const { NextRequest } = await import("next/server");

function callerOf(userId: string | null) {
  return appRouter.createCaller({
    drizzle: db,
    schema,
    session: userId ? { user: { id: userId } } : null,
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
}

const at = new Date("2026-09-01T00:00:00.000Z");

/**
 * An account with something of each kind deletion has to reach, and the
 * people around it: a reader it shared with, and a neighbour who keeps work
 * of their own in its folder. Each test deletes one, so each seeds its own.
 */
async function seed(prefix: string) {
  const ids = {
    user: `${prefix}_user`,
    email: `${prefix}-user@example.test`,
    reader: `${prefix}_reader`,
    neighbour: `${prefix}_neighbour`,
    folder: `${prefix}_folder`,
    doc: `${prefix}_doc`,
    publicDrawing: `${prefix}_public`,
    neighbourNote: `${prefix}_nnote`,
    neighbourDoc: `${prefix}_ndoc`,
    writeToken: `lxd_${prefix}_write`,
    readToken: `lxd_${prefix}_read`,
    githubId: `${prefix}-gh`,
  };
  await db.insert(schema.users).values([
    { id: ids.user, name: "Leaving", email: ids.email },
    { id: ids.reader, name: "Reader", email: `${prefix}-r@example.test` },
    { id: ids.neighbour, name: "Neighbour", email: `${prefix}-n@example.test` },
  ]);
  await db.insert(schema.accounts).values({
    userId: ids.user,
    type: "oauth",
    provider: "github",
    providerAccountId: ids.githubId,
  });
  await db.insert(schema.apiTokens).values([
    {
      userId: ids.user,
      name: "phone",
      scope: "write",
      tokenHash: hashApiToken(ids.writeToken),
    },
    {
      userId: ids.user,
      name: "agent",
      scope: "read",
      tokenHash: hashApiToken(ids.readToken),
    },
  ]);
  const entity = (
    id: string,
    userId: string,
    entityType: string,
    extra: Partial<typeof schema.entities.$inferInsert> = {},
  ) => ({
    id,
    title: id,
    elements: "{}",
    entityType,
    userId,
    publicAccess: PublicAccess.PRIVATE,
    createdAt: at,
    updatedAt: at,
    ...extra,
  });
  await db.insert(schema.entities).values([
    entity(ids.folder, ids.user, "directory"),
    entity(ids.publicDrawing, ids.user, "drawing", {
      publicAccess: PublicAccess.READ,
    }),
  ]);
  await db.insert(schema.entities).values([
    entity(ids.doc, ids.user, "document", {
      parentId: ids.folder,
      screenShotLight: `${HOST}/thumbnails/${ids.doc}/light-1.png`,
      // A thumbnail may point at any picture, such as one the document shows.
      screenShotDark: `${HOST}/${ids.neighbourDoc}-given.png`,
    }),
    entity(ids.neighbourNote, ids.neighbour, "document", {
      parentId: ids.folder,
    }),
    entity(ids.neighbourDoc, ids.neighbour, "document"),
  ]);
  await db.insert(schema.sharedEntities).values({
    id: `${prefix}_share_back`,
    entityId: ids.neighbourDoc,
    userId: ids.user,
    accessLevel: AccessLevel.EDIT,
  });
  await db.insert(schema.uploadedImages).values({
    id: `${prefix}_img_given`,
    userId: ids.user,
    entityId: ids.neighbourDoc,
    fileName: `${ids.neighbourDoc}-given.png`,
    signedDownloadUrl: "",
  });
  await db.insert(schema.uploadedImages).values({
    id: `${prefix}_img_taken`,
    userId: ids.neighbour,
    entityId: ids.doc,
    fileName: `${ids.doc}-taken.png`,
    signedDownloadUrl: "",
  });
  await db.insert(schema.uploadedVideos).values({
    id: `${prefix}_video`,
    userId: ids.user,
    entityId: ids.doc,
    fileName: `${ids.doc}-clip.mp4`,
    signedDownloadUrl: "",
  });
  await db.insert(schema.ttsJobs).values([
    {
      id: `${prefix}_tts_heard`,
      entityId: ids.neighbourDoc,
      userId: ids.user,
      status: "ready",
    },
    {
      id: `${prefix}_tts_own`,
      entityId: ids.doc,
      userId: ids.reader,
      status: "ready",
    },
  ]);
  for (const pathname of [
    `thumbnails/${ids.doc}/light-1.png`,
    `${ids.neighbourDoc}-given.png`,
    `${ids.doc}-taken.png`,
    `${ids.doc}-clip.mp4`,
    `tts/doc/${prefix}_tts_own/manifest.json`,
    `tts/doc/${prefix}_tts_own/full.mp3`,
    `tts/doc/${prefix}_tts_heard/manifest.json`,
    // Audio is stored once per chunk of text, whoever's document it is in.
    `tts/chunks/${prefix}-chunk.mp3`,
  ])
    stored.add(pathname);
  await db.insert(schema.sharedEntities).values([
    {
      id: `${prefix}_share_r`,
      entityId: ids.doc,
      userId: ids.reader,
      accessLevel: AccessLevel.READ,
    },
    {
      id: `${prefix}_share_n`,
      entityId: ids.folder,
      userId: ids.neighbour,
      accessLevel: AccessLevel.EDIT,
    },
  ]);
  return ids;
}

function restAs(token: string, path: string, body?: unknown) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const url = `http://lexidraw.test/api/v1${path}`;
  return body === undefined
    ? restGet(new Request(url, { headers }))
    : rest(
        new Request(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
}

const notFound = { code: "NOT_FOUND" };

describe("deleting your account from Settings", () => {
  test("takes your files from everyone they were shared with", async () => {
    const ids = await seed("delweb");

    await callerOf(ids.user).auth.deleteAccount({ confirmation: ids.email });

    await expect(
      callerOf(ids.reader).entities.load({ id: ids.doc }),
    ).rejects.toMatchObject(notFound);
    await expect(
      callerOf(null).entities.load({ id: ids.publicDrawing }),
    ).rejects.toMatchObject(notFound);
  });

  test("ends every token and linked sign-in, so signing in again starts afresh", async () => {
    const ids = await seed("delfresh");

    await callerOf(ids.user).auth.deleteAccount({ confirmation: ids.email });

    expect((await restAs(ids.writeToken, "/me")).status).toBe(401);
    const linked = await db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.provider, "github"),
          eq(schema.accounts.providerAccountId, ids.githubId),
        ),
      );
    expect(linked).toEqual([]);
    await callerOf(null).auth.signUp({
      name: "Again",
      email: ids.email,
      password: "Correct-Horse-Battery-9!",
    });
  });
});

describe("deleting an account needs it confirmed", () => {
  test("by its email; anything else removes nothing", async () => {
    const ids = await seed("delconfirm");

    for (const confirmation of ["", "someone@example.test"]) {
      await expect(
        callerOf(ids.user).auth.deleteAccount({ confirmation }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }

    await callerOf(ids.reader).entities.load({ id: ids.doc });
    expect((await restAs(ids.writeToken, "/me")).status).toBe(200);
  });
});

describe("deleting an account from the app, over the API", () => {
  test("is refused to a read-only token, which removes nothing", async () => {
    const ids = await seed("delread");

    const response = await restAs(ids.readToken, "/me/delete", {
      confirmation: ids.email,
    });

    expect(response.status).toBe(403);
    await callerOf(ids.reader).entities.load({ id: ids.doc });
    expect((await restAs(ids.writeToken, "/me")).status).toBe(200);
  });

  test("works with a token that may write", async () => {
    const ids = await seed("delwrite");

    const response = await restAs(ids.writeToken, "/me/delete", {
      confirmation: ids.email,
    });

    expect(response.status).toBe(200);
    await expect(
      callerOf(ids.reader).entities.load({ id: ids.doc }),
    ).rejects.toMatchObject(notFound);
    expect((await restAs(ids.writeToken, "/me")).status).toBe(401);
  });
});

describe("deleting an account leaves other people's work alone", () => {
  test("a file someone kept in its folder moves to their top level", async () => {
    const ids = await seed("delkeep");

    await callerOf(ids.user).auth.deleteAccount({ confirmation: ids.email });

    const note = await callerOf(ids.neighbour).entities.getMetadata({
      id: ids.neighbourNote,
    });
    expect(note.parentId).toBeNull();
  });

  test("what it added to someone else's document stays in that document", async () => {
    const ids = await seed("delgiven");

    await callerOf(ids.user).auth.deleteAccount({ confirmation: ids.email });

    const images = await db
      .select({ userId: schema.uploadedImages.userId })
      .from(schema.uploadedImages)
      .where(eq(schema.uploadedImages.entityId, ids.neighbourDoc));
    expect(images).toEqual([{ userId: ids.neighbour }]);
    const audio = await db
      .select({ userId: schema.ttsJobs.userId })
      .from(schema.ttsJobs)
      .where(eq(schema.ttsJobs.entityId, ids.neighbourDoc));
    expect(audio).toEqual([{ userId: ids.neighbour }]);
  });
});

describe("deleting an account empties the store of its files", () => {
  test("of their thumbnails, uploads and audio, and nothing else", async () => {
    const ids = await seed("delblobs");
    deleted.length = 0;

    await callerOf(ids.user).auth.deleteAccount({ confirmation: ids.email });

    expect(deleted.toSorted()).toEqual(
      [
        `${ids.doc}-clip.mp4`,
        `${ids.doc}-taken.png`,
        `thumbnails/${ids.doc}/light-1.png`,
        `tts/doc/delblobs_tts_own/full.mp3`,
        `tts/doc/delblobs_tts_own/manifest.json`,
      ].toSorted(),
    );
  });

  test("and the account is gone even when the store refuses", async () => {
    const ids = await seed("delrefused");
    deleteFailure = new Error("store unavailable");
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await callerOf(ids.user).auth.deleteAccount({ confirmation: ids.email });
    } finally {
      deleteFailure = undefined;
      warn.mockRestore();
    }

    await expect(
      callerOf(ids.reader).entities.load({ id: ids.doc }),
    ).rejects.toMatchObject(notFound);
  });
});

describe("deleting an account signs it out everywhere", () => {
  const COOKIE = "authjs.session-token";

  /** What a browser holding a sign-in to this user is told it is. */
  async function sessionOf(userId: string, email: string) {
    const jwt = await encode({
      token: { sub: userId, email, name: "Leaving" },
      secret: env.NEXTAUTH_SECRET,
      salt: COOKIE,
    });
    const response = await authGet(
      new NextRequest("http://localhost:3025/api/auth/session", {
        headers: { cookie: `${COOKIE}=${jwt}` },
      }),
    );
    return (await response.json()) as { user?: { id?: string } } | null;
  }

  test("so a sign-in it made before is no longer anyone", async () => {
    const ids = await seed("deljwt");
    expect((await sessionOf(ids.user, ids.email))?.user?.id).toBe(ids.user);

    await callerOf(ids.user).auth.deleteAccount({ confirmation: ids.email });

    expect(await sessionOf(ids.user, ids.email)).toBeNull();
  });
});

describe("deleting an account removes the tags it named", () => {
  test("unless someone else still uses them", async () => {
    const ids = await seed("deltags");
    const [own, sharedTag] = ["deltags-own", "deltags-shared"];
    await db.insert(schema.tags).values([
      { id: own, name: own },
      { id: sharedTag, name: sharedTag },
    ]);
    await db.insert(schema.entityTags).values([
      { entityId: ids.doc, tagId: own, userId: ids.user },
      { entityId: ids.neighbourDoc, tagId: own, userId: ids.user },
      { entityId: ids.doc, tagId: sharedTag, userId: ids.user },
      { entityId: ids.neighbourDoc, tagId: sharedTag, userId: ids.neighbour },
    ]);

    await callerOf(ids.user).auth.deleteAccount({ confirmation: ids.email });

    const left = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(inArray(schema.tags.id, [own, sharedTag]));
    expect(left).toEqual([{ id: sharedTag }]);
  });
});

/// <reference types="bun" />
import { expect, setSystemTime, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { entityRouter } = await import("~/server/api/routers/entities");
const OWNER = "thumbr_owner";
const ID = "thumbr_entity";
const CLOCK = 1_800_000_000_000;
const caller = entityRouter.createCaller({
  drizzle: db,
  schema,
  session: { user: { id: OWNER } },
  auth: { kind: "session" },
  headers: new Headers(),
} as never);

test("ordinary and generated thumbnail writes advance one revision under a fixed clock", async () => {
  await db.insert(schema.users).values({
    id: OWNER,
    name: "Owner",
    email: "thumbr@example.test",
  });
  await db.insert(schema.entities).values({
    id: ID,
    title: "Revision fixture",
    elements: "{}",
    entityType: "drawing",
    userId: OWNER,
    publicAccess: PublicAccess.PRIVATE,
    screenShotLight: "https://example.test/original",
    screenShotDark: "https://example.test/original",
    thumbnailUpdatedAt: new Date(CLOCK - 1),
    updatedAt: new Date(CLOCK - 100),
  });
  await db.insert(schema.generatedImages).values({
    id: "22222222-2222-4222-8222-222222222222",
    accountId: OWNER,
    entityId: ID,
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    contentHash: "synthetic-thumbnail",
    size: 1,
    pathname: "synthetic/22222222-2222-4222-8222-222222222222",
    state: "registered",
    expiresAt: CLOCK + 10_000,
    createdAt: CLOCK,
  });
  setSystemTime(new Date(CLOCK));
  try {
    const initial = await caller.generatedThumbnail({ entityId: ID });
    const a = await caller.commitGeneratedThumbnail({
      entityId: ID,
      uploadId: "11111111-1111-4111-8111-111111111111",
      expected: initial,
    });
    await caller.update({
      id: ID,
      screenShotLight: "https://example.test/B",
      screenShotDark: "https://example.test/B",
    });
    const b = await caller.generatedThumbnail({ entityId: ID });
    await caller.update({
      id: ID,
      screenShotLight: a.light,
      screenShotDark: a.dark,
    });
    const restoredA = await caller.generatedThumbnail({ entityId: ID });
    const stale = await caller
      .commitGeneratedThumbnail({
        entityId: ID,
        uploadId: "11111111-1111-4111-8111-111111111111",
        expected: { light: a.light, dark: a.dark, revision: a.revision },
      })
      .then(
        (receipt) => ({ kind: "saved", receipt }),
        (error: { code?: string }) => ({ kind: "refused", code: error.code }),
      );
    const current = await caller.generatedThumbnail({ entityId: ID });
    const advanced = await caller.commitGeneratedThumbnail({
      entityId: ID,
      uploadId: "11111111-1111-4111-8111-111111111111",
      expected: current,
    });
    await caller.update({
      id: ID,
      screenShotLight: "https://example.test/C",
      screenShotDark: "https://example.test/C",
    });
    const ordinary = await caller.generatedThumbnail({ entityId: ID });
    const listed = (await caller.list({})).find((row) => row.id === ID);
    console.log(
      "THUMBNAIL_REVISION_SNAPSHOTS",
      JSON.stringify({
        initial,
        a,
        b,
        restoredA,
        stale,
        current,
        advanced,
        ordinary,
        listed,
      }),
    );
    expect(b.revision).toBeGreaterThan(a.revision);
    expect(restoredA.revision).toBeGreaterThan(b.revision ?? 0);
    expect(restoredA.light).toBe(a.light);
    expect(restoredA.dark).toBe(a.dark);
    expect(stale).toEqual({ kind: "refused", code: "CONFLICT" });
    expect(advanced.revision).toBeGreaterThan(CLOCK);
    expect(ordinary.revision).toBeGreaterThan(advanced.revision);
    expect(listed?.updatedAt.getTime()).toBe(CLOCK);
  } finally {
    setSystemTime();
  }
});

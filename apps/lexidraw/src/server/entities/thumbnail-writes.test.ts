/// <reference types="bun" />
import { beforeAll, describe, expect, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const { entityRouter } = await import("~/server/api/routers/entities");
const { snapshotRouter } = await import("~/server/api/routers/snapshot");

const OWNER = "thumbw_owner";
const BEFORE = new Date("2026-09-01T00:00:00.000Z");
const context = {
  drizzle: db,
  schema,
  session: { user: { id: OWNER } },
  auth: { kind: "session" },
  headers: new Headers(),
} as never;

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: OWNER, name: "Owner", email: "thumbw-owner@example.test" });
  await db.insert(schema.entities).values(
    ["thumbw_icon", "thumbw_svg"].map((id) => ({
      id,
      title: id,
      elements: "{}",
      entityType: "drawing",
      userId: OWNER,
      publicAccess: PublicAccess.PRIVATE,
      createdAt: BEFORE,
      updatedAt: BEFORE,
      thumbnailUpdatedAt: BEFORE,
    })),
  );
});

async function thumbnailUpdatedAt(id: string) {
  const [row] = await db
    .select({ at: schema.entities.thumbnailUpdatedAt })
    .from(schema.entities)
    .where(eq(schema.entities.id, id));
  return row?.at;
}

// Listings cache-bust a thumbnail on `thumbnailUpdatedAt` (see
// `app/dashboard/thumbnail-src.ts`), and some writers reuse the blob path.
describe("every write of a thumbnail says when it was stored", () => {
  test("a custom icon", async () => {
    await entityRouter.createCaller(context).update({
      id: "thumbw_icon",
      screenShotLight: "https://blob.example/icon-light.webp",
      screenShotDark: "https://blob.example/icon-dark.webp",
    });
    expect(
      (await thumbnailUpdatedAt("thumbw_icon"))?.getTime(),
    ).toBeGreaterThan(BEFORE.getTime());
  });

  test("an SVG the drawing editor exported", async () => {
    await snapshotRouter.createCaller(context).saveUploadedUrl({
      entityId: "thumbw_svg",
      theme: "light",
      url: "https://blob.example/thumbw_svg-light.svg",
    });
    expect((await thumbnailUpdatedAt("thumbw_svg"))?.getTime()).toBeGreaterThan(
      BEFORE.getTime(),
    );
  });
});

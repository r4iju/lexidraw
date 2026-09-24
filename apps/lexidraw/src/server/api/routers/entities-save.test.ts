/// <reference types="bun" />
import { beforeAll, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
// A save queues a thumbnail workflow, which needs the Workflow build.
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");

const OWNER = "esave_owner";
const READ_AT = new Date("2026-09-01T00:00:00.000Z");
const caller = entityRouter.createCaller({
  drizzle: db,
  schema,
  session: { user: { id: OWNER } },
  auth: { kind: "session" },
  headers: new Headers(),
} as never);

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: OWNER, name: "Owner", email: "esave-owner@example.test" });
  await db.insert(schema.entities).values({
    id: "esave_doc",
    title: "esave_doc",
    elements: "read",
    entityType: "document",
    userId: OWNER,
    publicAccess: PublicAccess.PRIVATE,
    createdAt: READ_AT,
    updatedAt: READ_AT,
  });
});

async function stored(id: string) {
  const [row] = await db
    .select({ elements: schema.entities.elements })
    .from(schema.entities)
    .where(eq(schema.entities.id, id));
  return row?.elements;
}

describe("a browser save carries the revision it was made over", () => {
  test("a save over a revision that has moved on is refused, and stores nothing", async () => {
    const first = await caller.save({
      id: "esave_doc",
      elements: "written elsewhere",
      ifUnmodifiedSince: READ_AT.toISOString(),
    });
    expect(first.updatedAt.getTime()).toBeGreaterThan(READ_AT.getTime());

    const stale = caller.save({
      id: "esave_doc",
      elements: "typed over the old revision",
      ifUnmodifiedSince: READ_AT.toISOString(),
    });
    await expect(stale).rejects.toBeInstanceOf(TRPCError);
    await expect(stale).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await stored("esave_doc")).toBe("written elsewhere");
  });
});

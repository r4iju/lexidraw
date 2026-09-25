/// <reference types="bun" />
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import * as imageProbe from "~/server/documents/image-probe";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
// A save queues a thumbnail workflow, which needs the Workflow build.
mock.module("workflow/api", () => ({ start: async () => ({}) }));
const { entityRouter } = await import("~/server/api/routers/entities");
const { documentRouter } = await import("~/server/api/routers/documents");

const OWNER = "esave_owner";
const READ_AT = new Date("2026-09-01T00:00:00.000Z");
const context = {
  drizzle: db,
  schema,
  session: { user: { id: OWNER } },
  auth: { kind: "session" },
  headers: new Headers(),
} as never;
const caller = entityRouter.createCaller(context);
const documents = documentRouter.createCaller(context);
const agent = entityRouter.createCaller({
  ...(context as object),
  auth: { kind: "token", tokenId: "esave_token", scope: "write" },
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

describe("a document written without a browser stores its pictures' sizes", () => {
  afterEach(() => {
    (imageProbe.probeImageSize as { mockRestore?: () => void }).mockRestore?.();
  });

  const pictureAt = (src: string) =>
    JSON.stringify({
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "image",
                version: 1,
                src,
                altText: "",
                width: 0,
                height: 0,
              },
            ],
          },
        ],
      },
    });
  const withPicture = pictureAt("https://images.example/cover.jpg");
  const storedSize = async (id: string) =>
    JSON.parse((await stored(id)) ?? "{}").root?.children[0].children[0].$
      ?.natural;

  test("an agent's save, a create and an import each measure an unmeasured outside picture", async () => {
    spyOn(imageProbe, "probeImageSize").mockImplementation(async () => ({
      width: 1080,
      height: 1350,
    }));

    await agent.save({ id: "esave_doc", elements: withPicture });
    await caller.create({
      id: "esave_created",
      title: "Created",
      elements: withPicture,
      entityType: "document",
      parentId: null,
    });
    await documents.create({
      id: "esave_imported",
      title: "Imported",
      elements: withPicture,
    });

    for (const id of ["esave_doc", "esave_created", "esave_imported"])
      expect([id, await storedSize(id)]).toEqual([
        id,
        { width: 1080, height: 1350 },
      ]);
  });

  test("a picture that cannot be measured leaves the save as sent", async () => {
    spyOn(imageProbe, "probeImageSize").mockImplementation(
      async () => undefined,
    );
    await agent.save({ id: "esave_doc", elements: withPicture });
    expect(await stored("esave_doc")).toBe(withPicture);
  });

  test("the browser's save stores what it sent without asking the network", async () => {
    const probe = spyOn(imageProbe, "probeImageSize").mockImplementation(
      async () => ({ width: 1080, height: 1350 }),
    );
    const typed = pictureAt("https://images.example/typed.jpg");
    await caller.save({ id: "esave_doc", elements: typed });
    expect(probe).not.toHaveBeenCalled();
    expect(await stored("esave_doc")).toBe(typed);
  });
});

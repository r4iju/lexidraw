/// <reference types="bun" />
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";

import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();

/** The tags asked for, and what the next `revalidateTag` will throw. */
const asked: string[] = [];
let refusal: unknown;

mock.module("next/cache", () => ({
  revalidateTag: (tag: string) => {
    asked.push(tag);
    if (refusal) throw refusal;
  },
  cacheTag: () => {},
  revalidatePath: () => {},
  updateTag: () => {},
}));

const {
  entityTag,
  revalidateEntities,
  revalidateEntitiesAndParents,
  revalidateEntitiesOutsideRequest,
} = await import("./entity-cache");

/** A Next refusal, as Next raises it: the code is on the error, not in it. */
function nextError(code: string, message: string): Error {
  return Object.defineProperty(new Error(message), "__NEXT_ERROR_CODE", {
    value: code,
    enumerable: false,
  });
}

const OWNER = "cache_owner";

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values([{ id: OWNER, name: "Owner", email: "cache-owner@example.test" }]);
  await db
    .insert(schema.entities)
    .values([
      row("cache_top", null),
      row("cache_mid", "cache_top"),
      row("cache_leaf", "cache_mid"),
    ]);
});

beforeEach(() => {
  asked.length = 0;
  refusal = undefined;
});

function row(id: string, parentId: string | null) {
  return {
    id,
    parentId,
    title: id,
    elements: "{}",
    entityType: "directory",
    userId: OWNER,
    publicAccess: PublicAccess.PRIVATE,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };
}

describe("revalidateEntities", () => {
  test("asks for each id once, and skips the root", () => {
    revalidateEntities("a", "b", "a", null, undefined);
    expect(asked).toEqual([entityTag("a"), entityTag("b")]);
  });

  test("tolerates the refusal a render earns", () => {
    refusal = nextError("E7", 'used "revalidateTag" during render');
    expect(() => revalidateEntities("a")).not.toThrow();
    refusal = nextError("E181", 'used "revalidateTag" inside a "use cache"');
    expect(() => revalidateEntities("a")).not.toThrow();
  });

  test("lets a write that really failed to revalidate surface", () => {
    refusal = nextError("E263", "Invariant: static generation store missing");
    expect(() => revalidateEntities("a")).toThrow("static generation store");
  });

  test("lets anything without a Next code surface", () => {
    refusal = new Error("cache handler unreachable");
    expect(() => revalidateEntities("a")).toThrow("cache handler unreachable");
  });
});

describe("revalidateEntitiesOutsideRequest", () => {
  test("tolerates having no request to carry the revalidation", () => {
    refusal = nextError("E263", "Invariant: static generation store missing");
    expect(() => revalidateEntitiesOutsideRequest("a")).not.toThrow();
  });

  test("still lets a real failure surface", () => {
    refusal = new Error("cache handler unreachable");
    expect(() => revalidateEntitiesOutsideRequest("a")).toThrow(
      "cache handler unreachable",
    );
  });
});

describe("revalidateEntitiesAndParents", () => {
  test("adds the directory above each id it was given", async () => {
    await revalidateEntitiesAndParents(db, "cache_leaf", "cache_mid");
    expect(asked).toEqual([
      entityTag("cache_leaf"),
      entityTag("cache_mid"),
      entityTag("cache_top"),
    ]);
  });

  test("asks for nothing when every id is the root", async () => {
    await revalidateEntitiesAndParents(db, null, undefined);
    expect(asked).toEqual([]);
  });
});

/// <reference types="bun" />
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { PublicAccess } from "@packages/types";
import type { WorkStore } from "next/dist/server/app-render/work-async-storage.external";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { defaultConfig } from "next/dist/server/config-shared";
import type { CacheEntry } from "next/dist/server/lib/cache-handlers/types";
import { executeRevalidates } from "next/dist/server/revalidation-utils";
import {
  getPrivateCacheHandler,
  initializeCacheHandlers,
} from "next/dist/server/use-cache/handlers";
import { revalidateTag as nextRevalidateTag } from "next/dist/server/web/spec-extension/revalidate";

import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();

/** The tags asked for, and what the next `revalidateTag` will throw. */
const asked: string[] = [];
let refusal: unknown;

mock.module("next/cache", () => ({
  // Recorded, and handed on to Next's own only where a test set up the work
  // store a request would have: everywhere else it would throw for the lack of
  // one.
  revalidateTag: (
    tag: string,
    profile: Parameters<typeof nextRevalidateTag>[1],
  ) => {
    asked.push(tag);
    if (refusal) throw refusal;
    if (workAsyncStorage.getStore()) nextRevalidateTag(tag, profile);
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

  test("lets a write made during a render surface: no writer runs in one", () => {
    refusal = nextError("E7", 'used "revalidateTag" during render');
    expect(() => revalidateEntities("a")).toThrow("during render");
    refusal = nextError("E181", 'used "revalidateTag" inside a "use cache"');
    expect(() => revalidateEntities("a")).toThrow('inside a "use cache"');
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

  test("lets a write made during a render surface", () => {
    refusal = nextError("E181", 'used "revalidateTag" inside a "use cache"');
    expect(() => revalidateEntitiesOutsideRequest("a")).toThrow(
      'inside a "use cache"',
    );
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

describe("a write, as Next applies its revalidation", () => {
  /**
   * The dev server keeps a `"use cache: private"` render, the document page's
   * among them, in a built-in in-memory handler, and serves it to the next
   * load of the page. What a write asks for has to take that render out, not
   * mark it for a refresh after it has been served once more.
   */
  test("the next load of the page does not get the render from before it", async () => {
    const dev = process.env.__NEXT_DEV_SERVER;
    process.env.__NEXT_DEV_SERVER = "1";
    try {
      initializeCacheHandlers(50 * 1024 * 1024);
      const handler = getPrivateCacheHandler();
      if (!handler) throw new Error("no private cache handler");
      const render: CacheEntry = {
        value: new Blob(["the document before the write"]).stream(),
        tags: [entityTag("cache_doc")],
        stale: 300,
        timestamp: Date.now() - 1000,
        expire: 3600,
        revalidate: 900,
      };
      await handler.set("document-page", Promise.resolve(render));

      // What the route handler sets up for a request, as far as a
      // revalidation reads it, and what it runs once the procedure is done.
      const request = {
        route: "/api/v1/[...trpc]",
        page: "/api/v1/[...trpc]/route",
        incrementalCache: { revalidateTag: async () => {} },
        cacheLifeProfiles: defaultConfig.cacheLife,
      } as unknown as WorkStore;
      workAsyncStorage.run(request, () => revalidateEntities("cache_doc"));
      await executeRevalidates(request);
      // Next stamps the expiry rounded to the millisecond, so a read within
      // the same one can still find it ahead; the load that matters comes
      // later than that.
      await Bun.sleep(5);

      expect(await handler.get("document-page", [])).toBeUndefined();
    } finally {
      if (dev === undefined) delete process.env.__NEXT_DEV_SERVER;
      else process.env.__NEXT_DEV_SERVER = dev;
    }
  });
});

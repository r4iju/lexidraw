import type { drizzle } from "@packages/drizzle";
import { inArray, schema } from "@packages/drizzle";
import { revalidateTag } from "next/cache";

/**
 * The cache tag a `use cache` render carries for one entity. A page that shows
 * an entity tags that entity; a page that lists a directory tags the
 * directory, so a child appearing, leaving, or changing its title drops the
 * listing too.
 *
 * Every page they cover is `"use cache: private"`. In production Next keeps a
 * private entry only in the Resume Data Cache of the request that made it
 * (see the comment on `isPrivate` in
 * `next/dist/server/use-cache/use-cache-wrapper.js`), so there is nothing
 * across requests to drop. The dev server keeps them in a built-in in-memory
 * handler and serves them to the next load of the page, and a tag drop does
 * reach that handler. The staleness a browser sees beyond that is the client
 * Router cache, which no server-side call can drop at all; that is tracked as
 * a client refresh signal in issue #61.
 *
 * The invariant: a write that never went through the browser holding the
 * render drops it — `cacheTag` in the render, `revalidateEntities` in the
 * write. So every writer of an entity row calls one of these three functions,
 * browser-only or not, and a new writer is a new call.
 */
export function entityTag(id: string): string {
  return `entity:${id}`;
}

/**
 * `revalidateTag` carries the revalidation on the work store the request set
 * up, so it throws where there is no request (`E263`). Only the writers that
 * run outside one tolerate that; anything else is a write that really did
 * fail to revalidate, and is left to surface.
 */
const NO_REQUEST = "E263";

function nextErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE;
  return typeof code === "string" ? code : undefined;
}

function revalidate(
  ids: readonly (string | null | undefined)[],
  tolerated: ReadonlySet<string>,
): void {
  for (const id of new Set(ids)) {
    if (!id) continue;
    try {
      // Expired rather than stale: a profile such as "max" only marks the
      // entry stale, and a stale entry is served once more while a fresh one
      // renders behind it, so the first load after a write would show the
      // entity from before it. `updateTag` expires too, but only in a Server
      // Action, which a REST or MCP write is not.
      revalidateTag(entityTag(id), { expire: 0 });
    } catch (error) {
      const code = nextErrorCode(error);
      if (code === undefined || !tolerated.has(code)) throw error;
    }
  }
}

/**
 * Drops every cached render tagged with one of these entities. Null and
 * undefined ids are skipped, so a caller passes a parent that may be the root
 * without testing for it first.
 *
 * For a writer that runs inside a request — every procedure. A writer that
 * does not, such as a workflow step, says so with
 * {@link revalidateEntitiesOutsideRequest}.
 */
export function revalidateEntities(
  ...ids: readonly (string | null | undefined)[]
): void {
  revalidate(ids, new Set());
}

/**
 * The same, for a writer that runs with no request around it: a workflow step,
 * a cron, a queued job. Next has nothing to carry the revalidation on there,
 * so the tags cannot be dropped and the refusal is not a failure — which is
 * true of these callers alone, and why they name themselves rather than
 * leaving every caller to tolerate it.
 */
export function revalidateEntitiesOutsideRequest(
  ...ids: readonly (string | null | undefined)[]
): void {
  revalidate(ids, new Set([NO_REQUEST]));
}

/**
 * {@link revalidateEntities} for these ids and for the directory each of them
 * sits in, read in one query. A listing renders each child's own child count,
 * so an entity appearing or leaving changes the listing one level further up
 * as well; the writes that change the shape of the tree — create, delete,
 * move — use this, and the rest do not pay for the query.
 */
export async function revalidateEntitiesAndParents(
  db: typeof drizzle,
  ...ids: readonly (string | null | undefined)[]
): Promise<void> {
  const known = [...new Set(ids)].filter((id): id is string => Boolean(id));
  const parents = known.length
    ? await db
        .select({ parentId: schema.entities.parentId })
        .from(schema.entities)
        .where(inArray(schema.entities.id, known))
    : [];
  revalidateEntities(...ids, ...parents.map((row) => row.parentId));
}

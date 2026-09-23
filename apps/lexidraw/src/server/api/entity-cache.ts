import type { drizzle } from "@packages/drizzle";
import { inArray, schema } from "@packages/drizzle";
import { revalidateTag } from "next/cache";

/**
 * The cache tag a `use cache` render carries for one entity. A page that shows
 * an entity tags that entity; a page that lists a directory tags the
 * directory, so a child appearing, leaving, or changing its title drops the
 * listing too.
 *
 * **These tags do not currently invalidate anything.** Every page they cover
 * is `"use cache: private"`, and Next stores a private entry in the Resume
 * Data Cache rather than in a cache handler (see the comment on `isPrivate` in
 * `next/dist/server/use-cache/use-cache-wrapper.js`), where `revalidateTag`
 * cannot reach it. The API that does reach a private entry is `updateTag` or
 * `refresh`, and both are legal only in a Server Action — which a REST or MCP
 * request is not. The staleness a browser actually sees is the client Router
 * cache, which no server-side call can drop at all; that is tracked as a
 * client refresh signal in issue #61.
 *
 * The pair exists anyway — `cacheTag` in the render, `revalidateEntities` in
 * the write — because it is the invariant this app wants: a write that never
 * went through the browser holding the render must drop it. Written down and
 * pinned by tests, it becomes load-bearing the day a page stops being private
 * or Next reaches private entries; left out, the same conclusion has to be
 * rediscovered from scratch. So every writer of an entity row calls one of
 * these three functions, browser-only or not, and a new writer is a new call.
 */
export function entityTag(id: string): string {
  return `entity:${id}`;
}

/**
 * `revalidateTag` carries the revalidation on the work store the request set
 * up, so it throws where there is no request (`E263`) and where the caller is
 * a render or a cached function (`E7`, `E181`). Only the second pair is
 * expected here, and only from the `?new=true` create the editor pages run
 * inside their own `use cache` scope: that render redirects to an entity no
 * cache entry mentions yet, so there is nothing to drop. `E263` means a write
 * really did fail to revalidate and is left to surface.
 */
const RENDER_REFUSALS: ReadonlySet<string> = new Set(["E7", "E181"]);

/** The refusal a writer with no request around it earns; see above. */
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
      // "max" is the longest cache profile, so every entry carrying the tag
      // is stale however long-lived it was.
      revalidateTag(entityTag(id), "max");
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
  revalidate(ids, RENDER_REFUSALS);
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
  revalidate(ids, new Set([...RENDER_REFUSALS, NO_REQUEST]));
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

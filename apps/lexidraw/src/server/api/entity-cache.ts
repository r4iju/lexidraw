import { revalidateTag } from "next/cache";

/**
 * The cache tag a `use cache` render carries for one entity. A page that shows
 * an entity tags that entity; a page that lists a directory tags the
 * directory, so a child appearing, leaving, or changing its title drops the
 * listing too.
 *
 * Without the pair — `cacheTag` in the render, `revalidateEntities` in the
 * write — a write that never went through the browser holding the cached
 * render leaves it in place until the entry expires. That is every write over
 * `/api/v1`, `/api/mcp`, and the CLI, which is what agent access is.
 */
export function entityTag(id: string): string {
  return `entity:${id}`;
}

/**
 * Drops every cached render tagged with one of these entities. Null and
 * undefined ids are skipped, so a caller passes a parent that may be the root
 * without testing for it first.
 *
 * `revalidateTag` is only legal where the request can carry a revalidation.
 * The one mutation this app runs during a render — the `?new=true` create on
 * the editor pages — sits inside their own `use cache` scope, where Next
 * refuses it; that render redirects to an entity no cache entry mentions yet,
 * so there is nothing to drop and the refusal is not a failure.
 */
export function revalidateEntities(
  ...ids: readonly (string | null | undefined)[]
): void {
  for (const id of new Set(ids)) {
    if (!id) continue;
    try {
      // "max" is the longest cache profile, so every entry carrying the tag
      // is stale however long-lived it was. `updateTag` would be the
      // read-your-own-writes version, and it is only legal in a Server Action.
      revalidateTag(entityTag(id), "max");
    } catch {
      // See above: a write during a render has no cache entry to drop.
    }
  }
}

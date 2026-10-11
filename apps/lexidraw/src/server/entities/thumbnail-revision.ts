import { schema, sql } from "@packages/drizzle";

/** Advance against the stored row in the UPDATE so all writers share one revision. */
export function nextThumbnailRevision() {
  return sql`max(${Date.now()}, coalesce(${schema.entities.thumbnailUpdatedAt}, 0) + 1)`;
}

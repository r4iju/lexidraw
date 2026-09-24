import * as schema from "@packages/drizzle/drizzle-schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { replaceOwnTags } from "~/server/entities/tags";
import type { DocumentStore } from "./write";

// The schema module rather than the @packages/drizzle barrel: the barrel
// builds the Turso client, and with it the whole environment, on import.
type Db = LibSQLDatabase<typeof schema>;

/**
 * Every write to an entity strictly increases `updatedAt`. It is the token the
 * compare-and-set in `write` turns on, so two writes landing in the same
 * millisecond must not end up with the same one: the second would silently
 * clobber the first, and a caller could not tell "nobody wrote since my read"
 * from "someone else wrote in that millisecond".
 */
export const nextUpdatedAt = () =>
  sql`max(${schema.entities.updatedAt} + 1, ${Date.now()})`;

/** Every tag on the entity, whoever put it there, as a read shows them. */
async function tagNames(db: Db, id: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.entityTags)
    .innerJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
    .where(eq(schema.entityTags.entityId, id))
    .orderBy(schema.tags.name)
    .execute();
  return [...new Set(rows.map((row) => row.name))];
}

/**
 * The document table as a {@link DocumentStore} for `userId`, whose tags a
 * write replaces. Kept apart from the write itself so the algorithm carries
 * no database with it.
 */
export function drizzleDocumentStore(
  db: Db,
  userId: string,
  afterWrite?: (row: typeof schema.entities.$inferSelect) => Promise<void>,
): DocumentStore {
  return {
    async read(id) {
      const row = await db
        .select({
          id: schema.entities.id,
          title: schema.entities.title,
          elements: schema.entities.elements,
          updatedAt: schema.entities.updatedAt,
          appState: schema.entities.appState,
        })
        .from(schema.entities)
        .where(
          and(eq(schema.entities.id, id), isNull(schema.entities.deletedAt)),
        )
        .get();
      return row ? { ...row, tags: await tagNames(db, id) } : null;
    },
    async write(id, { elements, title, appState, tags }, expectedUpdatedAt) {
      const rows = await db
        .update(schema.entities)
        .set({
          elements,
          ...(title !== undefined ? { title } : {}),
          ...(appState !== undefined ? { appState } : {}),
          updatedAt: nextUpdatedAt(),
        })
        .where(
          and(
            eq(schema.entities.id, id),
            eq(schema.entities.updatedAt, expectedUpdatedAt),
            // A delete only stamps deletedAt, so the compare-and-set on
            // updatedAt alone would write into a deleted document.
            isNull(schema.entities.deletedAt),
          ),
        )
        .returning();
      const row = rows[0];
      if (!row) return null;
      if (tags !== undefined) await replaceOwnTags(db, id, userId, tags);
      await afterWrite?.(row);
      return { id: row.id, updatedAt: row.updatedAt };
    },
  };
}

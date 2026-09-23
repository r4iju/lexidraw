import * as schema from "@packages/drizzle/drizzle-schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { DocumentStore } from "./append";

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

/**
 * The document table as a {@link DocumentStore}. Kept apart from the append
 * itself so the algorithm carries no database with it.
 */
export function drizzleDocumentStore(db: Db): DocumentStore {
  return {
    async read(id) {
      const row = await db
        .select({
          id: schema.entities.id,
          elements: schema.entities.elements,
          updatedAt: schema.entities.updatedAt,
        })
        .from(schema.entities)
        .where(
          and(eq(schema.entities.id, id), isNull(schema.entities.deletedAt)),
        )
        .get();
      return row ?? null;
    },
    async write(id, elements, expectedUpdatedAt) {
      const rows = await db
        .update(schema.entities)
        .set({ elements, updatedAt: nextUpdatedAt() })
        .where(
          and(
            eq(schema.entities.id, id),
            eq(schema.entities.updatedAt, expectedUpdatedAt),
            // A delete only stamps deletedAt, so the compare-and-set on
            // updatedAt alone would write into a deleted document.
            isNull(schema.entities.deletedAt),
          ),
        )
        .returning({
          id: schema.entities.id,
          updatedAt: schema.entities.updatedAt,
        });
      return rows[0] ?? null;
    },
  };
}

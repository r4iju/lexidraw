import { and, type drizzle, eq, isNull, schema } from "@packages/drizzle";
import type { DocumentStore } from "./append";

type Db = typeof drizzle;

/**
 * The document table as a {@link DocumentStore}. Kept apart from the append
 * itself so the algorithm carries no database, and no environment, with it.
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
        .set({ elements, updatedAt: new Date() })
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

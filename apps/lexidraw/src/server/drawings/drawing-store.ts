import * as schema from "@packages/drizzle/document-data-schema";
import { and, eq, isNull } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { nextUpdatedAt } from "../documents/document-store";
import type { DocumentStore } from "../documents/write";
import { ownTagNames, replaceOwnTags } from "../entities/tags";

type Db<TRunResult> = BaseSQLiteDatabase<"async", TRunResult, typeof schema>;

/** Drawing arrays have no Lexical root or document metadata envelope to merge. */
export function drizzleDrawingStore<TRunResult>(
  db: Db<TRunResult>,
  userId: string,
  afterWrite?: (row: typeof schema.entities.$inferSelect) => Promise<void>,
): DocumentStore {
  const liveDrawing = (id: string) =>
    and(
      eq(schema.entities.id, id),
      eq(schema.entities.entityType, "drawing"),
      isNull(schema.entities.deletedAt),
    );
  return {
    async read(id) {
      const row = await db
        .select({
          id: schema.entities.id,
          title: schema.entities.title,
          elements: schema.entities.elements,
          appState: schema.entities.appState,
          updatedAt: schema.entities.updatedAt,
        })
        .from(schema.entities)
        .where(liveDrawing(id))
        .get();
      return row ? { ...row, tags: await ownTagNames(db, id, userId) } : null;
    },
    async write(id, { elements, title, appState, tags }, expectedUpdatedAt) {
      const [row] = await db
        .update(schema.entities)
        .set({
          elements,
          ...(title !== undefined ? { title } : {}),
          ...(appState !== undefined ? { appState } : {}),
          updatedAt: nextUpdatedAt(),
        })
        .where(
          and(
            liveDrawing(id),
            eq(schema.entities.updatedAt, expectedUpdatedAt),
          ),
        )
        .returning();
      if (!row) return null;
      if (tags !== undefined) await replaceOwnTags(db, id, userId, tags);
      await afterWrite?.(row);
      return { id: row.id, updatedAt: row.updatedAt };
    },
  };
}

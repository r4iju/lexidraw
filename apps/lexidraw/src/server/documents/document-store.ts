import * as schema from "@packages/drizzle/document-data-schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import {
  editorRootPayload,
  normalizeDocumentBytes,
  replaceDocumentRoot,
  InvalidDocumentPayloadError,
} from "~/lib/document-payload";
import { ownTagNames, replaceOwnTags } from "~/server/entities/tags";
import type { DocumentStore } from "./write";

// Direct table ownership keeps unrelated schema initialization out of this store.
type Db<TRunResult> = BaseSQLiteDatabase<"async", TRunResult, typeof schema>;

/** A data-only merge base. Never include native TEXT in the first projection. */
export async function readDocumentMergeBase<TRunResult>(
  db: Db<TRunResult>,
  id: string,
) {
  const row = await db
    .select({
      raw: sql<unknown>`CAST(${schema.entities.elements} AS BLOB)`,
      storageType: sql<unknown>`typeof(${schema.entities.elements})`,
      updatedAt: schema.entities.updatedAt,
    })
    .from(schema.entities)
    .where(and(eq(schema.entities.id, id), isNull(schema.entities.deletedAt)))
    .get();
  if (!row) return null;
  const normalized = normalizeDocumentBytes(row.raw, row.storageType);
  const base = { ...normalized, updatedAt: row.updatedAt };
  const textRow = await db
    .select({ elements: schema.entities.elements })
    .from(schema.entities)
    .where(
      and(
        eq(schema.entities.id, id),
        documentMergeBasePredicate(base),
        isNull(schema.entities.deletedAt),
      ),
    )
    .get();
  if (!textRow) return null;
  if (textRow.elements !== base.text) throw new InvalidDocumentPayloadError();
  return base;
}

export function documentMergeBasePredicate(base: {
  bytes: Uint8Array;
  updatedAt: Date;
}) {
  return and(
    eq(schema.entities.updatedAt, base.updatedAt),
    sql`CAST(${schema.entities.elements} AS BLOB) = ${base.bytes}`,
    sql`typeof(${schema.entities.elements}) = 'text'`,
  );
}

export function mergedDocumentElements(
  base: { bytes: Uint8Array },
  elements: string,
): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    replaceDocumentRoot(base.bytes, { kind: "replace-root", elements }),
  );
}

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
 * The document table as a {@link DocumentStore} for `userId`, whose tags a
 * read shows and a write replaces. Kept apart from the write itself so the algorithm carries
 * no database with it.
 */
export function drizzleDocumentStore<TRunResult>(
  db: Db<TRunResult>,
  userId: string,
  afterWrite?: (row: typeof schema.entities.$inferSelect) => Promise<void>,
  options: { prepareRoot?: (elements: string) => Promise<string> } = {},
): DocumentStore {
  const prepareRoot =
    options.prepareRoot ??
    (async (elements: string) =>
      (await import("./measure-images")).measureImages(elements));
  return {
    async read(id) {
      const base = await readDocumentMergeBase(db, id);
      if (!base) return null;
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
          and(
            eq(schema.entities.id, id),
            documentMergeBasePredicate(base),
            isNull(schema.entities.deletedAt),
          ),
        )
        .get();
      return row ? { ...row, tags: await ownTagNames(db, id, userId) } : null;
    },
    async write(id, { elements, title, appState, tags }, expectedUpdatedAt) {
      const base = await readDocumentMergeBase(db, id);
      if (!base || base.updatedAt.getTime() !== expectedUpdatedAt.getTime())
        return null;
      const prepared = await prepareRoot(editorRootPayload(elements));
      const merged = mergedDocumentElements(base, prepared);
      const rows = await db
        .update(schema.entities)
        .set({
          elements: merged,
          ...(title !== undefined ? { title } : {}),
          ...(appState !== undefined ? { appState } : {}),
          updatedAt: nextUpdatedAt(),
        })
        .where(
          and(
            eq(schema.entities.id, id),
            eq(schema.entities.updatedAt, expectedUpdatedAt),
            documentMergeBasePredicate(base),
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

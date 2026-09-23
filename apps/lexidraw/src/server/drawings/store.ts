import type { drizzle } from "@packages/drizzle";
import { StaleDocumentError } from "~/server/documents/conflict";
import {
  type DocumentRevision,
  type DocumentStore,
  DocumentGoneError,
} from "~/server/documents/write";
import {
  findReadableEntity,
  findWritableEntity,
} from "~/server/entities/readable";
import type { CanonicalElement } from "./skeleton-schema";

type Db = typeof drizzle;

type Entity = Awaited<ReturnType<typeof findReadableEntity>>;

/**
 * Drawings and documents are the same table with the same access rules, so
 * the entity lookups are shared; only the type check is ours. A drawing the
 * caller may not reach reads as missing, the way an entity of the wrong type
 * does, so neither answers whether it exists.
 */
const asDrawing = (entity: Entity) =>
  entity?.entityType === "drawing" ? entity : null;

export const findReadableDrawing = async (db: Db, id: string, userId: string) =>
  asDrawing(await findReadableEntity(db, id, userId));

export const findWritableDrawing = async (db: Db, id: string, userId: string) =>
  asDrawing(await findWritableEntity(db, id, userId));

/**
 * Stores `elements` as the drawing's whole element set.
 *
 * The write is a compare-and-set on `updatedAt`, so a save from the editor
 * that lands between the caller's read and this write is never clobbered
 * unnoticed. With `ifUnmodifiedSince` the caller says which revision it is
 * replacing, and losing that race is a conflict. Without one it is asking to
 * replace whatever is current, so the race is retried once against what the
 * other writer left.
 */
export async function replaceDrawingElements(
  store: DocumentStore,
  revision: DocumentRevision,
  elements: readonly CanonicalElement[],
  ifUnmodifiedSince?: string,
): Promise<{ id: string; updatedAt: Date; elementCount: number }> {
  if (
    ifUnmodifiedSince !== undefined &&
    new Date(ifUnmodifiedSince).getTime() !== revision.updatedAt.getTime()
  ) {
    throw new StaleDocumentError(revision.updatedAt);
  }

  const serialized = JSON.stringify(elements);
  let expected = revision.updatedAt;
  for (let attempt = 0; ; attempt++) {
    const written = await store.write(revision.id, serialized, expected);
    if (written) {
      return { ...written, elementCount: elements.length };
    }
    const reread = await store.read(revision.id);
    if (!reread) throw new DocumentGoneError();
    if (attempt > 0 || ifUnmodifiedSince !== undefined) {
      throw new StaleDocumentError(reread.updatedAt);
    }
    expected = reread.updatedAt;
  }
}

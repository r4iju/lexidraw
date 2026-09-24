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
 * unnoticed. `ifUnmodifiedSince` is the revision the caller is replacing, and
 * losing that race is a conflict rather than something to retry: replacing
 * every element of a drawing that has moved on is not a write anyone can
 * merge afterwards.
 */
export async function replaceDrawingElements(
  store: DocumentStore,
  revision: Pick<DocumentRevision, "id" | "updatedAt">,
  elements: readonly CanonicalElement[],
  ifUnmodifiedSince: string,
): Promise<{ id: string; updatedAt: Date; elementCount: number }> {
  if (new Date(ifUnmodifiedSince).getTime() !== revision.updatedAt.getTime()) {
    throw new StaleDocumentError(revision.updatedAt, "Drawing");
  }

  const written = await store.write(
    revision.id,
    { elements: JSON.stringify(elements) },
    revision.updatedAt,
  );
  if (written) return { ...written, elementCount: elements.length };

  const reread = await store.read(revision.id);
  if (!reread) throw new DocumentGoneError();
  throw new StaleDocumentError(reread.updatedAt, "Drawing");
}

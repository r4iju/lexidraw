import * as schema from "@packages/drizzle/drizzle-schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  InvalidDocumentPayloadError,
  normalizeDocumentBytes,
} from "~/lib/document-payload";
import { ownTagNames } from "./tags";
import { drizzleDocumentStore } from "../documents/document-store";

export const saveEntityContentColumns = {
  elements: sql<unknown>`CAST(${schema.entities.elements} AS BLOB)`,
  elementsStorageType: sql<unknown>`typeof(${schema.entities.elements})`,
};

export function decodeSaveEntityContent(row: {
  elements: unknown;
  elementsStorageType: unknown;
  entityType: string;
}): string {
  if (row.entityType === "document")
    return normalizeDocumentBytes(row.elements, row.elementsStorageType).text;
  if (
    row.elementsStorageType !== "text" ||
    !(row.elements instanceof ArrayBuffer || row.elements instanceof Uint8Array)
  )
    throw new InvalidDocumentPayloadError();
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      row.elements,
    );
  } catch {
    throw new InvalidDocumentPayloadError();
  }
}

export async function readEntityConflictContent(
  db: LibSQLDatabase<typeof schema>,
  id: string,
  userId: string,
  entityType: string,
) {
  if (entityType === "document")
    return drizzleDocumentStore(db, userId).read(id);
  const row = await db
    .select({
      id: schema.entities.id,
      title: schema.entities.title,
      elements: schema.entities.elements,
      updatedAt: schema.entities.updatedAt,
      appState: schema.entities.appState,
    })
    .from(schema.entities)
    .where(and(eq(schema.entities.id, id), isNull(schema.entities.deletedAt)))
    .get();
  return row ? { ...row, tags: await ownTagNames(db, id, userId) } : null;
}

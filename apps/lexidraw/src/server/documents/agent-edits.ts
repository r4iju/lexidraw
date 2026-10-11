import {
  editorRootPayload,
  normalizeDocumentBytes,
  replaceDocumentRoot,
} from "~/lib/document-payload";
import type { Transaction } from "@libsql/client";
import { z } from "zod";
import { AccessLevel, PublicAccess } from "@packages/types";
import type { DeviceMutation } from "~/lib/agent/device-core";
import {
  appendBlocks,
  parseEditorState,
  markdownToEditorState,
} from "./markdown";
const EditableDocument = z.object({
  elements: z.string(),
  updatedAt: z.number(),
  parentId: z.string().nullable(),
});
type Executor = Pick<Transaction, "execute">;
type Failure = (message: string) => Error;
export async function readEditableDocument(
  tx: Executor,
  account: string,
  document: string,
  failure: Failure,
) {
  const [row] = (
    await tx.execute({
      sql: "SELECT CAST(e.elements AS BLOB) AS raw,typeof(e.elements) AS storageType,e.updatedAt,e.parentId FROM Entities e WHERE e.id=? AND e.entityType='document' AND e.deletedAt IS NULL AND (e.userId=? OR e.publicAccess=? OR EXISTS (SELECT 1 FROM SharedEntities s WHERE s.entityId=e.id AND s.userId=? AND s.accessLevel=?))",
      args: [document, account, PublicAccess.EDIT, account, AccessLevel.EDIT],
    })
  ).rows;
  if (!row) throw failure("Document not found or edit access revoked");
  const current = normalizeDocumentBytes(row.raw, row.storageType);
  return EditableDocument.parse({
    elements: current.text,
    updatedAt: row.updatedAt,
    parentId: row.parentId,
  });
}
// The caller owns the transaction and stores its mode-specific receipt before commit.
export async function appendDocumentEdit(
  tx: Executor,
  row: z.infer<typeof EditableDocument>,
  document: string,
  revision: number,
  now: number,
  edit: DeviceMutation["edit"],
  image: { url: string; width: number; height: number } | undefined,
  failure: Failure,
) {
  if (row.updatedAt !== revision) throw failure("Document changed");
  if (edit.kind === "image" && !image)
    throw failure("Image storage unavailable");
  const blocks =
    edit.kind === "append"
      ? markdownToEditorState(edit.text).root.children
      : [
          {
            type: "image",
            version: 1,
            src: image?.url,
            altText: "Generated image",
            width: image?.width,
            height: image?.height,
            maxWidth: 1024,
            showCaption: false,
            caption: {
              editorState: {
                root: {
                  type: "root",
                  version: 1,
                  children: [],
                  direction: null,
                  format: "",
                  indent: 0,
                },
              },
            },
          },
        ];
  const [base] = (
    await tx.execute({
      sql: "SELECT CAST(elements AS BLOB) AS raw,typeof(elements) AS storageType,updatedAt FROM Entities WHERE id=? AND deletedAt IS NULL",
      args: [document],
    })
  ).rows;
  if (!base || base.updatedAt !== revision) throw failure("Document changed");
  const current = normalizeDocumentBytes(base.raw, base.storageType);
  const elements = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(
    replaceDocumentRoot(current.bytes, {
      kind: "replace-root",
      elements: editorRootPayload(
        JSON.stringify(appendBlocks(parseEditorState(current.text), blocks)),
      ),
    }),
  );
  const next = Math.max(revision + 1, now);
  const written = await tx.execute({
    sql: "UPDATE Entities SET elements=?,updatedAt=?,thumbnailStatus='pending' WHERE id=? AND updatedAt=? AND CAST(elements AS BLOB)=? AND typeof(elements)='text' AND deletedAt IS NULL",
    args: [elements, next, document, revision, current.bytes],
  });
  if (written.rowsAffected !== 1) throw failure("Document changed");
  return {
    revision: next,
    description: edit.kind === "append" ? edit.text : "Image inserted",
  };
}

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Transaction } from "@libsql/client";
import { PublicAccess, AccessLevel } from "@packages/types";
import {
  appendBlocks,
  parseEditorState,
  editorStateToMarkdown,
  markdownToEditorState,
} from "~/server/documents/markdown";
import { Receipt, Edit, Report } from "~/lib/agent/contracts";
import { ProError, type ProLedger } from "./ledger";
import type { AgentDocuments } from "./agent-operation";
const DocumentRow = z.object({
  elements: z.string(),
  updatedAt: z.number(),
  parentId: z.string().nullable(),
});
export class SqlAgentDocuments implements AgentDocuments {
  constructor(
    readonly ledger: ProLedger,
    readonly images?: {
      save(
        account: string,
        document: string,
        key: string,
        image: Extract<Edit, { kind: "image" }>["image"],
      ): Promise<string>;
    },
    readonly invalidate?: (document: string, parent: string | null) => void,
  ) {}
  private async row(account: string, id: string, tx?: Transaction) {
    const sql =
      "SELECT e.elements,e.updatedAt,e.parentId FROM Entities e WHERE e.id=? AND e.entityType='document' AND e.deletedAt IS NULL AND (e.userId=? OR e.publicAccess=? OR EXISTS (SELECT 1 FROM SharedEntities s WHERE s.entityId=e.id AND s.userId=? AND s.accessLevel=?))";
    const args = [id, account, PublicAccess.EDIT, account, AccessLevel.EDIT];
    const row = (
      tx
        ? (await tx.execute({ sql, args })).rows
        : await this.ledger.query(sql, args)
    )[0];
    if (!row) throw new ProError("Document not found or edit access revoked");
    return DocumentRow.parse(row);
  }
  async read(account: string, id: string) {
    const row = await this.row(account, id);
    return {
      revision: row.updatedAt,
      text: editorStateToMarkdown(parseEditorState(row.elements)),
    };
  }
  async apply(
    account: string,
    id: string,
    key: string,
    revision: number,
    value: Edit,
  ) {
    const edit = Edit.parse(value);
    const operation = key.split(":")[0] ?? "";
    const job = await this.ledger.agentJob(account, operation);
    if (job.input.documentId !== id)
      throw new ProError("Parent document scope mismatch");
    const hash = createHash("sha256")
      .update(JSON.stringify({ revision, edit }))
      .digest("hex");
    await this.row(account, id);
    const prior = (
      await this.ledger.query(
        "SELECT input_hash,receipt FROM pro_agent_edits WHERE operation_id=? AND step_key=?",
        [operation, key],
      )
    )[0];
    if (prior) {
      if (prior.input_hash !== hash)
        throw new ProError("Edit identity conflicts");
      return Receipt.parse(JSON.parse(String(prior.receipt)));
    }
    let imageUrl: string | undefined;
    if (edit.kind === "image") {
      if (!this.images) throw new ProError("Image tool unavailable");
      imageUrl = await this.images.save(account, id, key, edit.image);
    }
    const tx = await this.ledger.client.transaction("write");
    let parent: string | null = null;
    try {
      const row = await this.row(account, id, tx);
      parent = row.parentId;
      const existing = (
        await tx.execute({
          sql: "SELECT input_hash,receipt FROM pro_agent_edits WHERE operation_id=? AND step_key=?",
          args: [operation, key],
        })
      ).rows[0];
      if (existing) {
        if (existing.input_hash !== hash)
          throw new ProError("Edit identity conflicts");
        await tx.commit();
        return Receipt.parse(JSON.parse(String(existing.receipt)));
      }
      const op = (
        await tx.execute({
          sql: "SELECT o.state,o.cancel_requested,e.active FROM pro_operations o JOIN pro_eligibility e ON e.account_id=o.account_id WHERE o.id=? AND o.account_id=?",
          args: [operation, account],
        })
      ).rows[0];
      if (op?.state !== "running" || op.cancel_requested || op.active !== 1)
        throw new ProError("Document actions stopped");
      if (row.updatedAt !== revision) throw new ProError("Document changed");
      const state = parseEditorState(row.elements);
      const blocks =
        edit.kind === "append"
          ? markdownToEditorState(edit.text).root.children
          : [
              {
                type: "image",
                version: 1,
                src: imageUrl,
                altText: "Generated image",
                width: edit.image.width,
                height: edit.image.height,
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
      const elements = JSON.stringify(appendBlocks(state, blocks));
      const next = Math.max(revision + 1, this.ledger.config.now());
      const written = await tx.execute({
        sql: "UPDATE Entities SET elements=?,updatedAt=?,thumbnailStatus='pending' WHERE id=? AND updatedAt=? AND deletedAt IS NULL",
        args: [elements, next, id, revision],
      });
      if (written.rowsAffected !== 1) throw new ProError("Document changed");
      const receipt = {
        revision: next,
        description: edit.kind === "append" ? edit.text : "Image inserted",
      };
      await tx.execute({
        sql: "INSERT INTO pro_agent_edits VALUES (?,?,?,?)",
        args: [operation, key, hash, JSON.stringify(receipt)],
      });
      const stored = (
        await tx.execute({
          sql: "SELECT report FROM pro_agent_jobs WHERE operation_id=?",
          args: [operation],
        })
      ).rows[0];
      const report = Report.parse(JSON.parse(String(stored?.report)));
      report.completed.push(receipt);
      await tx.execute({
        sql: "UPDATE pro_agent_jobs SET report=? WHERE operation_id=?",
        args: [JSON.stringify(report), operation],
      });
      await tx.commit();
      this.invalidate?.(id, parent);
      return receipt;
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
}

import { createHash } from "node:crypto";
import type { Transaction } from "@libsql/client";
import {
  parseEditorState,
  editorStateToMarkdown,
} from "~/server/documents/markdown";
import { Receipt, Edit, Report } from "~/lib/agent/contracts";
import { ProError, type ProLedger } from "./ledger";
import type { AgentDocuments } from "./agent-operation";
import {
  readEditableDocument,
  appendDocumentEdit,
} from "~/server/documents/agent-edits";
const failure = (message: string) => new ProError(message);
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
    return readEditableDocument(tx ?? this.ledger.client, account, id, failure);
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
      const receipt = await appendDocumentEdit(
        tx,
        row,
        id,
        revision,
        this.ledger.config.now(),
        edit,
        imageUrl && edit.kind === "image"
          ? {
              url: imageUrl,
              width: edit.image.width,
              height: edit.image.height,
            }
          : undefined,
        failure,
      );
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

import { createHash } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { DeviceMutation, DeviceReceipt } from "~/lib/agent/device-core";
import { createByokSession } from "~/lib/byok/session";
import { parseEditorState, editorStateToMarkdown } from "../documents/markdown";
import {
  readEditableDocument,
  appendDocumentEdit,
} from "../documents/agent-edits";
const failure = (message: string) => new Error(message);
const guard = createByokSession(async () => {
  throw new Error("No provider transport");
}, "https://invalid.local");
export class DeviceAgentDocuments {
  constructor(
    readonly client: Client,
    readonly now = Date.now,
    readonly images?: (
      account: string,
      input: DeviceMutation,
    ) => Promise<string>,
    readonly invalidate?: (document: string, parent: string | null) => void,
  ) {}
  private async row(
    account: string,
    document: string,
    tx: Pick<Transaction, "execute"> = this.client,
  ) {
    return readEditableDocument(tx, account, document, failure);
  }
  async read(account: string, document: string) {
    const row = await this.row(account, document);
    const result = {
      revision: row.updatedAt,
      text: editorStateToMarkdown(parseEditorState(row.elements)),
    };
    guard.assertEgress(JSON.stringify(result));
    return result;
  }
  async apply(account: string, value: unknown) {
    const input = DeviceMutation.parse(value);
    if (input.accountId !== account) throw new Error("Account scope mismatch");
    guard.assertEgress(JSON.stringify(input));
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const accessible = await this.row(account, input.documentId);
    const existing = async (tx: Pick<Transaction, "execute">) => {
      const [prior] = (
        await tx.execute({
          sql: "SELECT document_id,input_hash,receipt FROM device_agent_edits WHERE account_id=? AND step_key=?",
          args: [account, input.idempotencyKey],
        })
      ).rows;
      if (!prior) return;
      if (prior.document_id !== input.documentId || prior.input_hash !== hash)
        throw new Error("Edit identity conflicts");
      return DeviceReceipt.parse(JSON.parse(String(prior.receipt)));
    };
    const prior = await existing(this.client);
    if (prior) {
      this.invalidate?.(input.documentId, accessible.parentId);
      return prior;
    }
    let url: string | undefined;
    if (input.edit.kind === "image") {
      if (!this.images) throw new Error("Image storage unavailable");
      url = await this.images(account, input);
      guard.assertSafe(url);
      if (!/^https:\/\//.test(url)) throw new Error("Invalid image URL");
    }
    const tx = await this.client.transaction("write");
    let committed = false;
    try {
      const row = await this.row(account, input.documentId, tx);
      const duplicate = await existing(tx);
      if (duplicate) {
        await tx.commit();
        committed = true;
        this.invalidate?.(input.documentId, row.parentId);
        return duplicate;
      }
      const [count] = (
        await tx.execute({
          sql: "SELECT COUNT(*) AS n FROM device_agent_edits WHERE account_id=?",
          args: [account],
        })
      ).rows;
      if (Number(count?.n) >= 5000)
        throw new Error("Document receipt quota reached");
      const receipt = await appendDocumentEdit(
        tx,
        row,
        input.documentId,
        input.revision,
        this.now(),
        input.edit,
        url ? { url, width: 1024, height: 1024 } : undefined,
        failure,
      );
      await tx.execute({
        sql: "INSERT INTO device_agent_edits VALUES (?,?,?,?,?,?)",
        args: [
          account,
          input.documentId,
          input.idempotencyKey,
          hash,
          JSON.stringify(receipt),
          this.now(),
        ],
      });
      await tx.commit();
      committed = true;
      this.invalidate?.(input.documentId, row.parentId);
      return receipt;
    } catch (error) {
      if (!committed) await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
}

export function createDeviceAgentImageUpload(
  images: import("./generated-images").GeneratedImages,
) {
  return async (account: string, input: DeviceMutation) => {
    if (input.edit.kind !== "image") throw new Error("Image tool required");
    guard.assertEgress(JSON.stringify(input));
    await images.cleanup();
    return (
      await images.save(
        account,
        {
          entityId: input.documentId,
          idempotencyKey: input.idempotencyKey,
          image: input.edit.image,
        },
        guard.assertSafe,
      )
    ).url;
  };
}

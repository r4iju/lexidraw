import { createHash } from "node:crypto";
import type { Client, Transaction } from "@libsql/client";
import { z } from "zod";
import {
  SaveRecording,
  validateRecording,
} from "~/lib/narration/device-contracts";
import { createByokSession } from "~/lib/byok/session";
const guard = createByokSession(async () => {
  throw new Error("No provider transport");
}, "https://invalid.test");
export const RecordingGrant = z.strictObject({
  kind: z.literal("recording_upload"),
  id: z.string().min(1).max(100),
});
export class GeneratedRecordings {
  constructor(
    readonly client: Client,
    readonly deps: {
      now: () => number;
      canEdit: (account: string, document: string) => Promise<boolean>;
      canRead: (account: string, document: string) => Promise<boolean>;
    },
  ) {}
  validate(value: unknown, check: (text: string) => void = guard.assertEgress) {
    const input = SaveRecording.parse(value);
    check(JSON.stringify(input));
    validateRecording(input.recording, check);
    const data = JSON.stringify(input.recording),
      size = Buffer.byteLength(data);
    if (size > 62_000_000) throw new Error("Recording exceeds bounds");
    return {
      ...input,
      data,
      size,
      hash: createHash("sha256").update(data).digest("hex"),
    };
  }
  private async write<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
    let tx: Transaction | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        tx = await this.client.transaction("write");
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/SQLITE_BUSY|SQLITE_LOCKED|TRANSACTION_ACTIVE|within a transaction/.test(
            error.message,
          ) ||
          attempt === 19
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    if (!tx) throw new Error("Recording storage busy");
    try {
      const result = await run(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
  async authorize(
    account: string,
    value: unknown,
    check: (text: string) => void = guard.assertEgress,
  ) {
    const input = this.validate(value, check);
    if (!(await this.deps.canEdit(account, input.documentId)))
      throw new Error("Edit access required");
    return this.write(async (tx) => {
      const prior = (
        await tx.execute({
          sql: "SELECT * FROM generated_recordings WHERE account_id=? AND idempotency_key=?",
          args: [account, input.idempotencyKey],
        })
      ).rows[0];
      if (prior) {
        if (
          prior.document_id !== input.documentId ||
          prior.content_hash !== input.hash
        )
          throw new Error("Idempotency conflict");
        if (
          prior.state !== "registered" &&
          (prior.state === "abandoned" ||
            Number(prior.expires_at) <= this.deps.now())
        )
          throw new Error("Upload expired");
        return RecordingGrant.parse({ kind: "recording_upload", id: prior.id });
      }
      const quota = (
        await tx.execute({
          sql: "SELECT COUNT(*) count,COALESCE(SUM(size),0) size FROM generated_recordings WHERE account_id=? AND state IN ('pending','registered')",
          args: [account],
        })
      ).rows[0];
      if (
        Number(quota?.count) >= 10 ||
        Number(quota?.size) + input.size > 100 * 1024 * 1024
      )
        throw new Error("Recording quota reached");
      const id = crypto.randomUUID();
      await tx.execute({
        sql: "INSERT INTO generated_recordings(id,account_id,document_id,idempotency_key,content_hash,size,state,expires_at,created_at) VALUES(?,?,?,?,?,?,'pending',?,?)",
        args: [
          id,
          account,
          input.documentId,
          input.idempotencyKey,
          input.hash,
          input.size,
          this.deps.now() + 600_000,
          this.deps.now(),
        ],
      });
      return RecordingGrant.parse({ kind: "recording_upload", id });
    });
  }
  async finalize(
    account: string,
    grantValue: unknown,
    recording: unknown,
    check: (text: string) => void = guard.assertEgress,
  ) {
    const grant = RecordingGrant.parse(grantValue);
    const parsed = validateRecording(recording, check),
      data = JSON.stringify(parsed),
      hash = createHash("sha256").update(data).digest("hex");
    return this.write(async (tx) => {
      const current = (
        await tx.execute({
          sql: "SELECT * FROM generated_recordings WHERE id=? AND account_id=?",
          args: [grant.id, account],
        })
      ).rows[0];
      if (
        !current ||
        !(await this.deps.canEdit(account, String(current.document_id)))
      )
        throw new Error("Edit access required");
      if (
        current.content_hash !== hash ||
        Number(current.size) !== Buffer.byteLength(data)
      )
        throw new Error("Idempotency conflict");
      if (current.state === "registered") return { id: grant.id };
      if (
        current.state !== "pending" ||
        Number(current.expires_at) <= this.deps.now()
      )
        throw new Error("Upload expired");
      check(data);
      await tx.execute({
        sql: "UPDATE generated_recordings SET state='registered',recording=? WHERE id=? AND account_id=? AND state='pending'",
        args: [data, grant.id, account],
      });
      return { id: grant.id };
    });
  }
  async save(
    account: string,
    value: unknown,
    check: (text: string) => void = guard.assertEgress,
  ) {
    const input = this.validate(value, check);
    const grant = await this.authorize(
      account,
      inputWithoutInternals(input),
      check,
    );
    return this.finalize(account, grant, input.recording, check);
  }
  async saved(account: string, document: string) {
    if (!(await this.deps.canRead(account, document)))
      throw new Error("Read access required");
    const row = (
      await this.client.execute({
        sql: "SELECT id,recording FROM generated_recordings WHERE account_id=? AND document_id=? AND state='registered' ORDER BY created_at DESC,rowid DESC LIMIT 1",
        args: [account, document],
      })
    ).rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      recording: validateRecording(
        JSON.parse(String(row.recording)),
        guard.assertEgress,
      ),
    };
  }
  async cleanup() {
    const result = await this.client.execute({
      sql: "UPDATE generated_recordings SET state='abandoned',recording=NULL WHERE state='pending' AND expires_at<=?",
      args: [this.deps.now()],
    });
    return result.rowsAffected;
  }
}
function inputWithoutInternals(input: z.infer<typeof SaveRecording>) {
  return {
    documentId: input.documentId,
    idempotencyKey: input.idempotencyKey,
    recording: input.recording,
  };
}

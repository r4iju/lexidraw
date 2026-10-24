import type { SupplierContract } from "./supplier-contract";
import { narrationTexts } from "~/lib/narration/portable";
import { speakableParts } from "~/lib/narration/speakable";
import { audioSeconds } from "./narration-audio";
import { createHash } from "node:crypto";
import {
  NARRATION_BOOK,
  NARRATION_POLICY,
  NarrationBook,
  narrationMaximum,
  type NarrationPart,
  NarrationPlan,
  NarrationSnapshot,
} from "~/lib/narration/contracts";
import { ProError, type ProLedger } from "./ledger";
export type NarrationOutcome =
  | { kind: "completed"; completion: NarrationPart }
  | { kind: "failed"; actualCostNanoUsd?: number }
  | { kind: "unknown" };
export type NarrationTransport = (
  text: string,
  signal: AbortSignal,
  context: {
    operationId: string;
    attemptId: string;
    chunkHash: string;
    periodId: string;
    accountId: string;
    supplier: SupplierContract;
  },
) => Promise<NarrationOutcome>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function narrationIdentity(
  text: string,
  book: NarrationBook = NarrationBook.parse(NARRATION_BOOK),
) {
  if (!text.trim() || Buffer.byteLength(text) > book.maxDocumentBytes)
    throw new ProError("Document exceeds narration bounds");
  const chunks: NarrationPlan = [];
  // v1 bounds keep their original fixed 500-character split so old plans re-derive the same hashes.
  const texts =
    book.maxChunks === 8 ? narrationTexts(text) : speakableParts(text);
  if (!texts.length || texts.length > book.maxChunks)
    throw new ProError("Document exceeds narration bounds");
  for (const text of texts) {
    chunks.push({
      text,
      hash: hash(
        JSON.stringify({
          text,
          model: book.model,
          voice: book.voice,
          style: book.style,
        }),
      ),
    });
  }
  return { hash: hash(text), plan: NarrationPlan.parse(chunks) };
}
export type NarrationDelivery = "inline" | "url";
export type NarrationProgress = {
  state: NarrationSnapshot["state"];
  more: boolean;
};
export class ProNarration {
  constructor(
    readonly ledger: ProLedger,
    readonly transport: NarrationTransport,
  ) {}
  async quote(account: string, text: string) {
    const period = await this.ledger.periodRates(account);
    const book = period?.rates.narration ?? NarrationBook.parse(NARRATION_BOOK);
    const identity = narrationIdentity(text, book);
    const plan: NarrationPlan = await Promise.all(
      identity.plan.map(async (p) => {
        const a = await this.ledger.narrationCache(account, p.hash);
        return a ? { ...p, cachedAttempt: String(a.id) } : p;
      }),
    );
    const missing = new Set(
      plan.filter((p) => !p.cachedAttempt).map((p) => p.hash),
    ).size;
    const status = await this.ledger.status(account);
    if (missing && !status.entitled)
      throw new ProError("Private entitlement required");
    if (missing && status.entitlementPeriodId !== period?.id)
      throw new ProError("Entitlement period changed. Review a new quote.");
    return {
      periodId: period?.id ?? null,
      maximum: missing * narrationMaximum(book),
      missing,
      cached: plan.length - missing,
      maxSeconds: plan.length * 120,
      revision: identity.hash,
      version: book.version,
      policy: NARRATION_POLICY,
      book,
      plan,
      hash: identity.hash,
    };
  }
  async prepare(
    account: string,
    documentId: string,
    text: string,
    key: string,
    maximum: number,
    acceptedRevision: string,
    acceptedPeriod: string | null,
    delivery: NarrationDelivery = "inline",
  ) {
    const identity = narrationIdentity(text);
    if (identity.hash !== acceptedRevision)
      throw new ProError("Document revision changed. Review a new quote.");
    const existing = (
      await this.ledger.query(
        "SELECT id FROM pro_operations WHERE account_id=? AND idempotency_key=?",
        [account, key],
      )
    )[0];
    if (existing) {
      const old = await this.ledger.narrationPlan(account, String(existing.id));
      if (
        old.operation.input_hash !== identity.hash ||
        old.documentId !== documentId
      )
        throw new ProError("Idempotency key conflicts with prior input");
      if (acceptedPeriod !== old.operation.period_id)
        throw new ProError("Entitlement period conflicts with prior action");
      if (maximum !== old.operation.quote)
        throw new ProError("Accept the maximum narration quote");
      return this.snapshot(account, old.operation.id, delivery);
    }
    const q = await this.quote(account, text);
    if (maximum !== q.maximum)
      throw new ProError("Accept the maximum narration quote");
    if (!q.missing) return this.savedPlan(account, q.plan, delivery);
    if (acceptedPeriod !== q.periodId || !q.periodId)
      throw new ProError("Entitlement period changed. Review a new quote.");
    const op = await this.ledger.reserve(
      account,
      key,
      identity.hash,
      "narration",
      {
        book: q.book,
        quote: q.maximum,
        documentId,
        periodId: q.periodId,
        plan: q.plan,
      },
    );
    return this.snapshot(account, op.id, delivery);
  }
  async execute(account: string, id: string): Promise<NarrationSnapshot> {
    await this.run(account, id, Number.POSITIVE_INFINITY);
    return this.snapshot(account, id);
  }
  /** Dispatches at most `budget` parts so each durable step stays short; `more` asks for another step. */
  async step(
    account: string,
    id: string,
    budget: number,
  ): Promise<NarrationProgress> {
    const more = await this.run(account, id, budget);
    return { state: (await this.ledger.operation(account, id)).state, more };
  }
  private async run(account: string, id: string, budget: number) {
    let { operation: op, plan } = await this.ledger.narrationPlan(account, id);
    if (["settled", "refunded", "cancelled", "unknown"].includes(op.state))
      return false;
    let dispatched = 0;
    const book = NarrationBook.parse(JSON.parse(op.pricebook));
    // A resumed step reads committed parts; the next paid request is fenced atomically.
    await this.ledger.claim(id);
    for (const chunk of plan) {
      if (chunk.cachedAttempt) continue;
      const attempts = await this.ledger.attempts(account, id);
      const prior = attempts.find((a) => a.chunk_hash === chunk.hash);
      if (prior?.state === "completed") continue;
      if (dispatched >= budget) return true;
      if (prior) {
        await this.recover(account, id);
        return false;
      }
      op = await this.ledger.operation(account, id);
      if (op.cancel_requested) {
        await this.ledger.settle(id, { kind: "cancelled" });
        return false;
      }
      let attempt: string;
      try {
        attempt = await this.ledger.startAttempt(id, chunk.hash);
      } catch {
        // Another executor may own the fence. Never refund its completed or pending work.
        const now = await this.ledger.attempts(account, id);
        if (
          !now.some((a) => a.state === "started" || a.state === "unknown") &&
          !now.some((a) => a.chunk_hash === chunk.hash)
        )
          await this.ledger.settle(id, { kind: "technical_failure" });
        await this.recover(account, id);
        return false;
      }
      dispatched++;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<NarrationOutcome>((resolve) => {
        timer = setTimeout(
          () => {
            controller.abort();
            resolve({ kind: "unknown" });
          },
          Math.max(
            1,
            Math.min(
              180_000,
              book.maxElapsedMs - (this.ledger.config.now() - op.created_at),
            ),
          ),
        );
      });
      let outcome: NarrationOutcome;
      try {
        outcome = await Promise.race([
          this.transport(chunk.text, controller.signal, {
            operationId: id,
            attemptId: attempt,
            chunkHash: chunk.hash,
            periodId: op.period_id,
            accountId: account,
            supplier: await this.ledger.supplierContract(account, id, attempt),
          }),
          timeout,
        ]);
        if (outcome.kind === "completed") audioSeconds(outcome.completion);
      } catch {
        outcome = { kind: "unknown" };
      } finally {
        clearTimeout(timer);
      }
      try {
        await this.ledger.finishAttempt(attempt, outcome);
      } catch {
        await this.ledger.finishAttempt(attempt, { kind: "unknown" });
        await this.recover(account, id);
        return false;
      }
      if (outcome.kind !== "completed") {
        await this.recover(account, id);
        return false;
      }
    }
    await this.ledger.settle(id, { kind: "narration_completed" });
    return false;
  }
  async recover(
    account: string,
    id: string,
    delivery: NarrationDelivery = "inline",
  ) {
    const op = await this.ledger.operation(account, id);
    if (["reserved", "running", "unknown"].includes(op.state)) {
      let attempts = await this.ledger.attempts(account, id);
      for (const attempt of attempts)
        if (
          attempt.state === "started" &&
          this.ledger.config.now() - Number(attempt.created_at) >= 180_000
        )
          await this.ledger.finishAttempt(String(attempt.id), {
            kind: "unknown",
          });
      attempts = await this.ledger.attempts(account, id);
      if (attempts.some((a) => a.state === "failed"))
        await this.ledger.settle(id, { kind: "technical_failure" });
      else if (
        op.cancel_requested &&
        !attempts.some((a) => a.state === "started" || a.state === "unknown")
      )
        await this.ledger.settle(id, { kind: "cancelled" });
      else {
        // Settlement checks every planned part under its write lock, including cached identities.
        try {
          await this.ledger.settle(id, { kind: "narration_completed" });
        } catch (error) {
          if (
            !(error instanceof ProError) ||
            error.message !== "Incomplete narration cannot settle"
          )
            throw error;
        }
      }
    }
    return this.snapshot(account, id, delivery);
  }
  snapshot(
    account: string,
    id: string,
    delivery: NarrationDelivery = "inline",
  ) {
    return new SavedNarrationReader(this.ledger).snapshot(
      account,
      id,
      delivery,
    );
  }
  savedPlan(
    account: string,
    plan: NarrationPlan,
    delivery: NarrationDelivery = "inline",
  ) {
    return new SavedNarrationReader(this.ledger).savedPlan(
      account,
      plan,
      delivery,
    );
  }
}

/** Account-owned persisted audio only. This reader cannot generate, recover or debit. */
export class SavedNarrationReader {
  constructor(
    readonly ledger: Pick<
      ProLedger,
      | "query"
      | "narrationPlan"
      | "attempts"
      | "narrationPart"
      | "narrationPartSeconds"
      | "narrationCache"
    >,
  ) {}
  async latest(account: string, documentId: string) {
    const row = (
      await this.ledger.query(
        "SELECT o.id FROM pro_operations o JOIN pro_narration_jobs j ON j.operation_id=o.id WHERE o.account_id=? AND j.document_id=? ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1",
        [account, documentId],
      )
    )[0];
    return row ? { id: String(row.id) } : null;
  }
  async saved(
    account: string,
    documentId: string,
    text: string,
    delivery: NarrationDelivery = "inline",
  ) {
    // Prefer a complete current recording, then preserve the latest historical job/parts.
    let identity: ReturnType<typeof narrationIdentity> | undefined;
    try {
      identity = narrationIdentity(text);
    } catch (error) {
      if (!(error instanceof ProError)) throw error;
      // Generation bounds do not limit access to historical saved content.
    }
    if (identity) {
      const plan = await Promise.all(
        identity.plan.map(async (p) => {
          const cached = await this.ledger.narrationCache(account, p.hash);
          return cached ? { ...p, cachedAttempt: String(cached.id) } : p;
        }),
      );
      if (plan.every((p) => p.cachedAttempt))
        return this.savedPlan(account, plan, delivery);
    }
    const [saved] = await this.ledger.query(
      "SELECT o.id FROM pro_operations o JOIN pro_narration_jobs j ON j.operation_id=o.id WHERE o.account_id=? AND j.document_id=? AND (EXISTS (SELECT 1 FROM pro_attempts a WHERE a.operation_id=o.id AND a.state='completed') OR EXISTS (SELECT 1 FROM json_each(j.plan) p WHERE json_extract(p.value,'$.cachedAttempt') IS NOT NULL)) ORDER BY o.created_at DESC,o.rowid DESC LIMIT 1",
      [account, documentId],
    );
    if (!saved) throw new ProError("No saved narration for this document");
    return this.snapshot(account, String(saved.id), delivery);
  }
  /** Inline audio, or a URL plus the duration read from the stored audio's length. */
  private async part(
    account: string,
    attempt: string,
    delivery: NarrationDelivery,
  ) {
    if (delivery === "url")
      return {
        url: `/api/narration/parts/${encodeURIComponent(attempt)}`,
        seconds: await this.ledger.narrationPartSeconds(account, attempt),
      };
    const part = await this.ledger.narrationPart(account, attempt);
    return { audio: part.audio, seconds: audioSeconds(part) };
  }
  async snapshot(
    account: string,
    id: string,
    delivery: NarrationDelivery = "inline",
  ) {
    const [{ operation: op, plan }, attempts] = await Promise.all([
      this.ledger.narrationPlan(account, id),
      this.ledger.attempts(account, id),
    ]);
    const selected = plan.flatMap((p) => {
      const attempt =
        p.cachedAttempt ??
        attempts.find((a) => a.chunk_hash === p.hash && a.state === "completed")
          ?.id;
      return attempt ? [{ plan: p, attempt }] : [];
    });
    const parts: NarrationSnapshot["parts"] = [];
    for (let offset = 0; offset < selected.length; offset += 8) {
      const batch = await Promise.all(
        selected
          .slice(offset, offset + 8)
          .map(async ({ plan: p, attempt }, index) => ({
            id: `${p.hash}:${offset + index}`,
            text: p.text,
            ...(await this.part(account, String(attempt), delivery)),
          })),
      );
      parts.push(...batch);
    }
    return NarrationSnapshot.parse({
      id,
      state: op.state,
      charged: op.charged,
      quote: op.quote,
      made: parts.length,
      planned: plan.length,
      parts,
      policy: NARRATION_POLICY,
    });
  }
  async savedPlan(
    account: string,
    plan: NarrationPlan,
    delivery: NarrationDelivery = "inline",
  ) {
    const parts = await Promise.all(
      plan.map(async (p, index) => {
        if (!p.cachedAttempt)
          throw new ProError("No saved narration for this revision");
        return {
          id: `${p.hash}:${index}`,
          text: p.text,
          ...(await this.part(account, p.cachedAttempt, delivery)),
        };
      }),
    );
    return NarrationSnapshot.parse({
      id: null,
      state: "saved",
      charged: 0,
      quote: 0,
      made: parts.length,
      planned: plan.length,
      parts,
      policy: NARRATION_POLICY,
    });
  }
}

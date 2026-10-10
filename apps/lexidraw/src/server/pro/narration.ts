import { narrationTexts } from "~/lib/narration/portable";
import { audioSeconds } from "./narration-audio";
import { createHash } from "node:crypto";
import {
  NARRATION_BOOK,
  NARRATION_POLICY,
  CHUNK_MAXIMUM,
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
  },
) => Promise<NarrationOutcome>;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export function narrationIdentity(text: string) {
  if (!text.trim() || Buffer.byteLength(text) > NARRATION_BOOK.maxDocumentBytes)
    throw new ProError("Document exceeds narration bounds");
  const chunks: NarrationPlan = [];
  const texts = narrationTexts(text);
  for (const text of texts) {
    chunks.push({
      text,
      hash: hash(
        JSON.stringify({
          text,
          model: NARRATION_BOOK.model,
          voice: NARRATION_BOOK.voice,
          style: NARRATION_BOOK.style,
        }),
      ),
    });
  }
  return { hash: hash(text), plan: NarrationPlan.parse(chunks) };
}
export class ProNarration {
  constructor(
    readonly ledger: ProLedger,
    readonly transport: NarrationTransport,
  ) {}
  async quote(account: string, text: string) {
    const identity = narrationIdentity(text);
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
    return {
      periodId: status.entitlementPeriodId,
      maximum: missing * CHUNK_MAXIMUM,
      missing,
      cached: plan.length - missing,
      maxSeconds: plan.length * 120,
      revision: identity.hash,
      version: NARRATION_BOOK.version,
      policy: NARRATION_POLICY,
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
      return this.snapshot(account, old.operation.id);
    }
    const q = await this.quote(account, text);
    if (maximum !== q.maximum)
      throw new ProError("Accept the maximum narration quote");
    if (!q.missing) return this.savedPlan(account, q.plan);
    if (acceptedPeriod !== q.periodId || !q.periodId)
      throw new ProError("Entitlement period changed. Review a new quote.");
    const op = await this.ledger.reserve(
      account,
      key,
      identity.hash,
      "narration",
      {
        book: NARRATION_BOOK,
        quote: q.maximum,
        documentId,
        periodId: q.periodId,
        plan: q.plan,
      },
    );
    return this.snapshot(account, op.id);
  }
  async execute(account: string, id: string): Promise<NarrationSnapshot> {
    let { operation: op, plan } = await this.ledger.narrationPlan(account, id);
    if (["settled", "refunded", "cancelled", "unknown"].includes(op.state))
      return this.snapshot(account, id);
    // A resumed step reads committed parts; the next paid request is fenced atomically.
    await this.ledger.claim(id);
    for (const chunk of plan) {
      if (chunk.cachedAttempt) continue;
      const attempts = await this.ledger.attempts(account, id);
      const prior = attempts.find((a) => a.chunk_hash === chunk.hash);
      if (prior?.state === "completed") continue;
      if (prior) return this.recover(account, id);
      op = await this.ledger.operation(account, id);
      if (op.cancel_requested) {
        await this.ledger.settle(id, { kind: "cancelled" });
        return this.snapshot(account, id);
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
        return this.recover(account, id);
      }
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
              NARRATION_BOOK.maxElapsedMs -
                (this.ledger.config.now() - op.created_at),
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
          }),
          timeout,
        ]);
        if (outcome.kind === "completed") audioSeconds(outcome.completion);
      } catch {
        outcome = { kind: "unknown" };
      } finally {
        clearTimeout(timer);
      }
      await this.ledger.finishAttempt(attempt, outcome);
      if (outcome.kind !== "completed") return this.recover(account, id);
    }
    await this.ledger.settle(id, { kind: "narration_completed" });
    return this.snapshot(account, id);
  }
  async recover(account: string, id: string) {
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
    return this.snapshot(account, id);
  }
  async snapshot(account: string, id: string) {
    const { operation: op, plan } = await this.ledger.narrationPlan(
      account,
      id,
    );
    const attempts = await this.ledger.attempts(account, id);
    const parts: NarrationSnapshot["parts"] = [];
    for (const p of plan) {
      const attempt =
        p.cachedAttempt ??
        attempts.find((a) => a.chunk_hash === p.hash && a.state === "completed")
          ?.id;
      if (!attempt) break;
      const part = await this.ledger.narrationPart(account, String(attempt));
      parts.push({
        id: `${p.hash}:${parts.length}`,
        text: p.text,
        audio: part.audio,
        seconds: audioSeconds(part),
      });
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
  async savedPlan(account: string, plan: NarrationPlan) {
    const parts = await Promise.all(
      plan.map(async (p, index) => {
        if (!p.cachedAttempt)
          throw new ProError("No saved narration for this revision");
        const part = await this.ledger.narrationPart(account, p.cachedAttempt);
        return {
          id: `${p.hash}:${index}`,
          text: p.text,
          audio: part.audio,
          seconds: audioSeconds(part),
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

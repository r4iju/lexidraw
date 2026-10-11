import type { SupplierContract } from "./supplier-contract";
import { createHash } from "node:crypto";
import {
  AutocompleteInput,
  Completion,
  PRICEBOOK,
  TextBook,
  TextInput,
  type Operation,
} from "./contracts";
import { ProError, type ProLedger } from "./ledger";

export type ProviderOutcome =
  | { kind: "completed"; completion: Completion }
  | { kind: "failed"; retryable: boolean; actualCostNanoUsd?: number }
  | { kind: "unknown" };
export type ProTransport = (
  text: string,
  signal: AbortSignal,
  context: {
    accountId: string;
    attemptId: string;
    operationId: string;
    feature?: string;
    onText?: (text: string) => void;
    supplier?: SupplierContract;
  },
) => Promise<ProviderOutcome>;
export function inputIdentity(input: unknown) {
  const parsed = TextInput.parse(input);
  if (new TextEncoder().encode(parsed.text).length > PRICEBOOK.maxInputBytes)
    throw new ProError("Text exceeds bounded input");
  return {
    ...parsed,
    hash: createHash("sha256").update(parsed.text).digest("hex"),
  };
}

export function autocompleteIdentity(
  input: import("zod").infer<typeof AutocompleteInput>,
) {
  return inputIdentity({
    idempotencyKey: input.idempotencyKey,
    text: JSON.stringify({
      title: input.title,
      before: input.before,
      after: input.after,
    }),
  });
}

/** Persisted attempts fence paid work; replay never repeats an uncertain request. */
export class ProTextOperation {
  constructor(
    readonly ledger: ProLedger,
    readonly transport: ProTransport,
  ) {}
  async execute(
    account: string,
    id: string,
    text: string,
    onText?: (text: string) => void,
  ): Promise<Operation> {
    const op = await this.ledger.operation(account, id);
    const book = TextBook.parse(JSON.parse(op.pricebook));
    if (!(await this.ledger.claim(id))) return this.recover(account, id);
    for (
      let index = 0;
      index < (op.feature === "autocomplete" ? 1 : book.maxAttempts);
      index++
    ) {
      let attempt: string;
      try {
        attempt = await this.ledger.startAttempt(id);
      } catch {
        const current = await this.ledger.operation(account, id);
        return this.ledger.settle(id, {
          kind: current.cancel_requested ? "cancelled" : "technical_failure",
        });
      }
      const controller = new AbortController();
      const remainingMs = Math.max(
        1,
        book.maxElapsedMs - (this.ledger.config.now() - op.created_at),
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = new Promise<ProviderOutcome>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ kind: "unknown" });
        }, remainingMs);
      });
      const monitor = setInterval(() => {
        void this.ledger
          .operation(account, id)
          .then((current) => {
            if (current.cancel_requested) controller.abort();
          })
          .catch(() => controller.abort());
      }, 250);
      let outcome: ProviderOutcome;
      try {
        outcome = await Promise.race([
          this.transport(text, controller.signal, {
            accountId: account,
            attemptId: attempt,
            operationId: id,
            feature: op.feature,
            onText,
            supplier: await this.ledger.supplierContract(account, id, attempt),
          }),
          stop,
        ]);
      } catch {
        outcome = { kind: "unknown" };
      } finally {
        clearTimeout(timer);
        clearInterval(monitor);
      }
      if (outcome.kind === "completed") {
        const completion = Completion.safeParse(outcome.completion);
        if (
          !completion.success ||
          (op.feature === "autocomplete" && completion.data.usage.output > 64)
        ) {
          await this.ledger.finishAttempt(attempt, { kind: "unknown" });
          return this.ledger.operation(account, id);
        }
        try {
          await this.ledger.finishAttempt(attempt, {
            kind: "completed",
            completion: completion.data,
          });
        } catch {
          await this.ledger.finishAttempt(attempt, { kind: "unknown" });
          return this.ledger.operation(account, id);
        }
        return this.ledger.settle(id, {
          kind: "completed",
          text: completion.data.text,
          usage: completion.data.usage,
        });
      }
      try {
        await this.ledger.finishAttempt(attempt, outcome);
      } catch {
        await this.ledger.finishAttempt(attempt, { kind: "unknown" });
        return this.ledger.operation(account, id);
      }
      if (outcome.kind === "unknown") return this.ledger.operation(account, id);
      const current = await this.ledger.operation(account, id);
      if (
        !outcome.retryable ||
        current.cancel_requested ||
        index + 1 === (op.feature === "autocomplete" ? 1 : book.maxAttempts)
      )
        return this.ledger.settle(id, {
          kind: current.cancel_requested ? "cancelled" : "technical_failure",
        });
    }
    return this.ledger.operation(account, id);
  }
  async recover(account: string, id: string) {
    const op = await this.ledger.operation(account, id);
    if (!["reserved", "running", "unknown"].includes(op.state)) return op;
    const attempts = await this.ledger.attempts(account, id);
    if (op.cancel_requested && !attempts.length)
      return this.ledger.settle(id, { kind: "cancelled" });
    const last = attempts.at(-1);
    if (
      last?.state === "completed" &&
      typeof last.result === "string" &&
      typeof last.usage === "string"
    ) {
      await this.ledger.supplierContract(account, id, String(last.id));
      const completion = Completion.parse(JSON.parse(last.result));
      return this.ledger.settle(id, {
        kind: "completed",
        text: completion.text,
        usage: completion.usage,
      });
    }
    if (last?.state === "failed")
      return this.ledger.settle(id, {
        kind: op.cancel_requested ? "cancelled" : "technical_failure",
      });
    // A running process can still own a started attempt; never release on expiry or client disconnect.
    return op;
  }
}

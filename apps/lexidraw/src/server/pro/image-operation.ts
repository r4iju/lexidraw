import { createHash } from "node:crypto";
import {
  ImageCompletion,
  ImageInput,
  ImagePricebook,
  validateImage,
  type ImageArtifact,
} from "~/lib/images/contracts";
import type { Operation } from "./contracts";
import { ProError, type ProLedger } from "./ledger";
export type ImageOutcome =
  | { kind: "completed"; completion: ImageCompletion }
  | { kind: "failed"; actualCostNanoUsd?: number }
  | { kind: "unknown" };
export type ImageTransport = (
  prompt: string,
  signal: AbortSignal,
  context: { operationId: string; attemptId: string },
) => Promise<ImageOutcome>;
export class ProImageOperation {
  readonly book: ReturnType<typeof ImagePricebook.parse>;
  constructor(
    readonly ledger: ProLedger,
    snapshot: unknown,
    readonly transport: ImageTransport,
  ) {
    this.book = ImagePricebook.parse(snapshot);
  }
  async start(account: string, value: unknown): Promise<Operation> {
    const input = ImageInput.parse(value);
    if (input.acceptedMaximum !== this.book.quote)
      throw new ProError("Accept the maximum image quote before generation");
    const hash = createHash("sha256")
      .update(
        JSON.stringify({ prompt: input.prompt, version: this.book.version }),
      )
      .digest("hex");
    const op = await this.ledger.reserve(
      account,
      input.idempotencyKey,
      hash,
      "image",
      this.book,
    );
    if (!(await this.ledger.claim(op.id))) return this.recover(account, op.id);
    let attempt: string;
    try {
      attempt = await this.ledger.startAttempt(op.id);
    } catch {
      return this.ledger.settle(op.id, { kind: "technical_failure" });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.book.maxElapsedMs);
    const monitor = setInterval(() => {
      void this.ledger
        .operation(account, op.id)
        .then((x) => {
          if (x.cancel_requested) controller.abort();
        })
        .catch(() => controller.abort());
    }, 250);
    let outcome: ImageOutcome;
    try {
      outcome = await Promise.race([
        this.transport(input.prompt, controller.signal, {
          operationId: op.id,
          attemptId: attempt,
        }),
        new Promise<ImageOutcome>((resolve) =>
          controller.signal.addEventListener(
            "abort",
            () => resolve({ kind: "unknown" }),
            { once: true },
          ),
        ),
      ]);
      if (outcome.kind === "completed") {
        ImageCompletion.parse(outcome.completion);
        validateImage(outcome.completion.image);
      }
    } catch {
      outcome = { kind: "unknown" };
    } finally {
      clearTimeout(timer);
      clearInterval(monitor);
    }
    await this.ledger.finishAttempt(attempt, outcome);
    return this.recover(account, op.id);
  }
  async recover(account: string, id: string): Promise<Operation> {
    const op = await this.ledger.operation(account, id);
    if (op.feature !== "image") throw new ProError("Image operation required");
    if (!["reserved", "running", "unknown"].includes(op.state)) return op;
    const attempts = await this.ledger.attempts(account, id);
    const last = attempts.at(-1);
    if (last?.state === "completed")
      return this.ledger.settle(id, {
        kind: "image_completed",
        completion: ImageCompletion.parse(JSON.parse(String(last.result))),
      });
    if (last?.state === "failed" || (op.cancel_requested && !attempts.length))
      return this.ledger.settle(id, {
        kind: op.cancel_requested ? "cancelled" : "technical_failure",
      });
    return op;
  }
  result(op: Operation): ImageArtifact | undefined {
    return op.state === "settled" && op.result
      ? validateImage(JSON.parse(op.result)).image
      : undefined;
  }
}

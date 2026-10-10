import { createHash } from "node:crypto";
import {
  AgentBook,
  AgentAttemptDescriptor,
  AgentInput,
  AgentCompletion,
  Plan,
  Decision,
  Generation,
  Search,
  Receipt,
  type Edit,
  type Phase,
  type Report,
} from "~/lib/agent/contracts";
import { ImageCompletion } from "~/lib/images/contracts";
import { ProError, type ProLedger } from "./ledger";
export interface AgentDocuments {
  read(
    account: string,
    document: string,
  ): Promise<{ revision: number; text: string }>;
  apply(
    account: string,
    document: string,
    key: string,
    revision: number,
    edit: Edit,
  ): Promise<ReturnType<typeof Receipt.parse>>;
}
export type AgentRequest = {
  phase: Phase;
  prompt: string;
  context: string;
  query?: string;
  progress?: { planned: string[]; completed: number };
};
export type AgentTransport = (
  request: AgentRequest,
  signal: AbortSignal,
  scope: { accountId: string; operationId: string; attemptId: string },
) => Promise<
  | { kind: "completed"; completion: AgentCompletion }
  | { kind: "failed"; actualCostNanoUsd?: number }
  | { kind: "unknown" }
>;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
class Stop extends Error {
  constructor(
    readonly status: Report["status"],
    message: string,
  ) {
    super(message);
  }
}
export class ProAgentOperation {
  readonly book: AgentBook;
  constructor(
    readonly ledger: ProLedger,
    book: unknown,
    readonly documents: AgentDocuments,
    readonly transport: AgentTransport,
  ) {
    this.book = AgentBook.parse(book);
  }
  async reserve(account: string, value: unknown) {
    const input = AgentInput.parse(value);
    if (input.acceptedMaximum !== this.book.quote)
      throw new ProError("Accept the complete action maximum");
    // Replays must still prove document access, but their original revision can have advanced through their own edits.
    const document = await this.documents.read(account, input.documentId);
    const prior = (
      await this.ledger.query(
        "SELECT id,input_hash FROM pro_operations WHERE account_id=? AND idempotency_key=?",
        [account, input.idempotencyKey],
      )
    )[0];
    if (!prior && document.revision !== input.revision)
      throw new ProError("Document changed. Read it again before accepting.");
    return this.ledger.reserve(
      account,
      input.idempotencyKey,
      hash(input),
      "agent",
      { book: this.book, input },
    );
  }
  async view(account: string, id: string) {
    const job = await this.ledger.agentJob(account, id);
    await this.documents.read(account, job.input.documentId);
    await this.ledger.recoverAgent(account, id);
    const recovered = await this.ledger.agentJob(account, id);
    return { operation: recovered.operation, report: recovered.report };
  }
  async execute(account: string, id: string) {
    const job = await this.ledger.agentJob(account, id);
    if (
      !["reserved", "running"].includes(job.operation.state) ||
      !(await this.ledger.agentLease(account, id))
    )
      return this.view(account, id);
    await this.ledger.claim(id);
    const initialDescription = job.input.prompt.slice(0, 200);
    const report: Report = {
      status: "pending",
      completed: [],
      incomplete: [initialDescription],
    };
    let planned: string[] = [initialDescription];
    let revision = job.input.revision;
    let tools = 0;
    const before = async () => {
      const op = await this.ledger.operation(account, id);
      if (op.cancel_requested)
        throw new Stop("cancelled", "Cancelled. Saved edits remain.");
      if (this.ledger.config.now() - op.created_at >= this.book.maxElapsedMs)
        throw new Stop("cap_exhausted", "Action time limit reached.");
      const doc = await this.documents.read(account, job.input.documentId);
      if (doc.revision !== revision)
        throw new Stop("partial", "Document changed. Further edits stopped.");
      if (new TextEncoder().encode(doc.text).length > 1500)
        throw new Stop(
          "cap_exhausted",
          "Document exceeds the action context bound.",
        );
      return doc;
    };
    const paid = async (
      key: string,
      phase: Phase,
      context: string,
      query?: string,
    ) => {
      const request: AgentRequest = {
        phase,
        prompt: job.input.prompt,
        context,
        ...(query ? { query } : {}),
        ...(phase === "decision" || phase === "generation"
          ? { progress: { planned, completed: report.completed.length } }
          : {}),
      };
      if (
        new TextEncoder().encode(JSON.stringify(request)).length + 1024 >
        this.book.maxInputTokens
      )
        throw new Stop("cap_exhausted", "Paid input limit reached.");
      const descriptor = JSON.stringify({ key, phase, hash: hash(request) });
      const attempts = await this.ledger.attempts(account, id);
      const prior = attempts.find(
        (a) =>
          AgentAttemptDescriptor.parse(JSON.parse(String(a.chunk_hash))).key ===
          key,
      );
      if (prior) {
        if (prior.chunk_hash !== descriptor)
          throw new Stop("reconciling", "Repeated step input differs.");
        if (prior.state === "completed")
          return AgentCompletion.parse(JSON.parse(String(prior.result))).output;
        throw new Stop(
          prior.state === "failed" ? "failed" : "reconciling",
          "Previous paid outcome must be reconciled before continuing.",
        );
      }
      await before();
      let attempt: string;
      try {
        attempt = await this.ledger.startAttempt(id, descriptor);
      } catch {
        throw new Stop(
          "cap_exhausted",
          "Paid action cap or spend limit reached.",
        );
      }
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const remaining = Math.max(
        1,
        this.book.maxElapsedMs -
          (this.ledger.config.now() - job.operation.created_at),
      );
      const stop = new Promise<{ kind: "unknown" }>((resolve) => {
        timeout = setTimeout(
          () => {
            controller.abort();
            resolve({ kind: "unknown" });
          },
          Math.min(30000, remaining),
        );
      });
      const monitor = setInterval(() => {
        void this.ledger
          .operation(account, id)
          .then((op) => {
            if (op.cancel_requested) controller.abort();
          })
          .catch(() => controller.abort());
      }, 100);
      let outcome: Awaited<ReturnType<AgentTransport>>;
      try {
        outcome = await Promise.race([
          this.transport(request, controller.signal, {
            accountId: account,
            operationId: id,
            attemptId: attempt,
          }),
          stop,
        ]);
        if (outcome.kind === "completed")
          AgentCompletion.parse(outcome.completion);
      } catch {
        outcome = { kind: "unknown" };
      } finally {
        clearTimeout(timeout);
        clearInterval(monitor);
      }
      try {
        await this.ledger.finishAttempt(attempt, outcome);
      } catch {
        await this.ledger.finishAttempt(attempt, { kind: "unknown" });
        throw new Stop(
          "reconciling",
          "Unverified paid outcome remains reserved.",
        );
      }
      if (outcome.kind !== "completed")
        throw new Stop(
          outcome.kind === "unknown" ? "reconciling" : "failed",
          "Paid step did not complete. Saved edits remain.",
        );
      return outcome.completion.output;
    };
    const mutate = async (key: string, edit: Edit) => {
      // The document adapter atomically checks permission/revision and stores the idempotent receipt with the edit.
      const receipt = Receipt.parse(
        await this.documents.apply(
          account,
          job.input.documentId,
          `${id}:${key}`,
          revision,
          edit,
        ),
      );
      revision = receipt.revision;
      report.completed.push(receipt);
      report.incomplete = planned.slice(report.completed.length);
      await this.ledger.agentReport(account, id, report);
    };
    try {
      const doc = await before();
      planned = Plan.parse(await paid("plan", "plan", doc.text)).edits;
      report.incomplete = planned;
      let context = doc.text;
      for (let cycle = 0; cycle < this.book.maxCycles; cycle++) {
        const decision = Decision.parse(
          await paid(`decision:${cycle}`, "decision", context),
        );
        if (decision.kind === "done") {
          if (report.completed.length < planned.length)
            throw new Stop(
              "partial",
              "Agent stopped before all planned edits completed.",
            );
          report.status = "complete";
          report.incomplete = [];
          await this.ledger.agentReport(account, id, report);
          await this.ledger.settle(id, { kind: "agent_completed" });
          return this.view(account, id);
        }
        if (++tools > this.book.maxTools)
          throw new Stop("cap_exhausted", "Tool cap reached.");
        if (decision.kind === "search") {
          const result = Search.parse(
            await paid(`search:${cycle}`, "search", context, decision.query),
          );
          context = JSON.stringify(result);
          continue;
        }
        if (decision.kind === "image") {
          if (!this.book.image)
            throw new Stop(
              "partial",
              "Image tool is unavailable. No image was generated.",
            );
          const image = ImageCompletion.parse(
            await paid(`image:${cycle}`, "image", context, decision.query),
          );
          await before();
          await mutate(`edit:${cycle}`, { kind: "image", image: image.image });
        } else {
          const generated = Generation.parse(
            await paid(`generation:${cycle}`, "generation", context),
          );
          await before();
          await mutate(`edit:${cycle}`, {
            kind: "append",
            text: generated.text,
          });
        }
        context = (await this.documents.read(account, job.input.documentId))
          .text;
      }
      throw new Stop(
        "cap_exhausted",
        "Agent cycle cap reached. Saved edits remain.",
      );
    } catch (error) {
      report.status = error instanceof Stop ? error.status : "failed";
      report.reason =
        error instanceof Stop
          ? error.message
          : "Document action stopped. Saved edits remain.";
      report.incomplete = planned.slice(report.completed.length);
      await this.ledger.agentReport(account, id, report);
      await this.ledger.settle(id, {
        kind: report.status === "cancelled" ? "cancelled" : "technical_failure",
      });
      return this.view(account, id);
    }
  }
}

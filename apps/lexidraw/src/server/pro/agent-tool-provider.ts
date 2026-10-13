import "server-only";
import { z } from "zod";
import {
  AgentBook,
  SandboxBook,
  SandboxTask,
  Generation,
} from "~/lib/agent/contracts";
import type { AgentTransport } from "./agent-operation";
import { authorizeAgentAttempt } from "./agent-provider";
import type { ProLedger } from "./ledger";

// This serialized job has no authority, credential, code, URL, environment or arbitrary command slot.
export const SandboxJob = z.strictObject({
  version: z.literal("typed-task-v1"),
  receiptId: z.string().uuid(),
  task: SandboxTask,
  limits: SandboxBook.pick({
    maxDurationMs: true,
    maxInputBytes: true,
    maxOutputBytes: true,
    network: true,
    secrets: true,
  }),
});
const TaskOutcome = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("completed"),
    text: Generation.shape.text,
    actualCostNanoUsd: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    actualCostNanoUsd: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
export interface SandboxTaskPort {
  readonly provider: string;
  readonly endpoint: "typed-task-v1";
  /** Pure local preparation only. Provisioning and every billable effect belong in dispatch. */
  prepare(
    job: z.infer<typeof SandboxJob>,
    signal: AbortSignal,
  ): Promise<{
    dispatch(): Promise<z.infer<typeof TaskOutcome>>;
  }>;
}
/** Trusted host adapter; no caller-supplied keys, standalone grants or delegated provider callbacks enter a sandbox job. */
export function createAgentToolProvider(deps: {
  ledger: ProLedger;
  model: AgentTransport;
  sandbox?: SandboxTaskPort;
}): AgentTransport {
  const authorize = authorizeAgentAttempt(deps.ledger);
  return async (request, signal, scope) => {
    const contract = await authorize(scope, request);
    await deps.ledger.claimAgentDispatch(
      scope.accountId,
      scope.operationId,
      scope.attemptId,
    );
    if (request.phase !== "sandbox") {
      await authorize(scope, request);
      return deps.model(request, signal, scope);
    }
    const book = SandboxBook.parse(AgentBook.parse(contract.book).sandbox);
    if (
      !deps.sandbox ||
      deps.sandbox.provider !== book.provider ||
      deps.sandbox.endpoint !== book.endpoint
    )
      return { kind: "failed", actualCostNanoUsd: 0 };
    const sandbox = deps.sandbox;
    const job = SandboxJob.parse({
      version: book.endpoint,
      receiptId: scope.attemptId,
      task: request.task,
      limits: {
        maxDurationMs: book.maxDurationMs,
        maxInputBytes: book.maxInputBytes,
        maxOutputBytes: book.maxOutputBytes,
        network: book.network,
        secrets: book.secrets,
      },
    });
    if (
      new TextEncoder().encode(JSON.stringify(job)).length > book.maxInputBytes
    )
      return { kind: "failed", actualCostNanoUsd: 0 };
    const abort = AbortSignal.any([
      signal,
      AbortSignal.timeout(book.maxDurationMs),
    ]);
    let dispatched = false;
    let onAbort: () => void = () => {};
    const stopped = new Promise<Awaited<ReturnType<AgentTransport>>>(
      (resolve) => {
        onAbort = () =>
          resolve(
            dispatched
              ? { kind: "unknown" }
              : { kind: "failed", actualCostNanoUsd: 0 },
          );
        abort.addEventListener("abort", onAbort, { once: true });
        if (abort.aborted) onAbort();
      },
    );
    const run = async (): Promise<Awaited<ReturnType<AgentTransport>>> => {
      let prepared: Awaited<ReturnType<SandboxTaskPort["prepare"]>>;
      try {
        prepared = await sandbox.prepare(job, abort);
        await authorize(scope, request);
      } catch {
        return { kind: "failed", actualCostNanoUsd: 0 };
      }
      if (abort.aborted) return { kind: "failed", actualCostNanoUsd: 0 };
      try {
        dispatched = true;
        const raw = await prepared.dispatch();
        const failed = z
          .strictObject({
            kind: z.literal("failed"),
            actualCostNanoUsd: z.unknown().optional(),
          })
          .safeParse(raw);
        if (failed.success) {
          const invoice = z
            .number()
            .int()
            .nonnegative()
            .max(contract.maximumNanoUsd)
            .safeParse(failed.data.actualCostNanoUsd);
          return {
            kind: "failed",
            ...(invoice.success ? { actualCostNanoUsd: invoice.data } : {}),
          };
        }
        const outcome = TaskOutcome.parse(raw);
        if (outcome.kind !== "completed") return outcome;
        if (
          new TextEncoder().encode(JSON.stringify(outcome)).length >
          book.maxOutputBytes
        )
          return { kind: "unknown" };
        return {
          kind: "completed",
          completion: {
            kind: "agent",
            phase: "sandbox",
            output: { text: outcome.text },
            usage: { input: 0, cachedInput: 0, output: 0 },
            actualCostNanoUsd: outcome.actualCostNanoUsd,
            estimatedCostNanoUsd: contract.maximumNanoUsd,
          },
        };
      } catch {
        return { kind: "unknown" };
      }
    };
    try {
      return await Promise.race([run(), stopped]);
    } finally {
      abort.removeEventListener("abort", onAbort);
    }
  };
}

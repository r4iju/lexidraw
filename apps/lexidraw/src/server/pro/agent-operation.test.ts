import { expect, test, mock } from "bun:test";
import { createClient } from "@libsql/client";
import { ProLedger } from "./ledger";
import { installServerRuntime } from "~/test/server-runtime";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { createAgentRouter } = await import("../api/routers/pro-agent");
const { ProAgentOperation } = await import("./agent-operation");
const { AGENT_BOOK } = await import("~/lib/agent/contracts");
export async function fixture(
  transport?: ConstructorParameters<typeof ProAgentOperation>[3],
) {
  const client = createClient({ url: ":memory:" });
  for (const name of [
    "0015_private_pro",
    "0016_pro_billing_events",
    "0029_sandbox_billing",
    "0025_pro_narration",
    "0027_pro_agent",
  ])
    await client.executeMultiple(
      (
        await Bun.file(`../../packages/drizzle/drizzle/${name}.sql`).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    now: () => 1000,
  });
  const document = { revision: 1, text: "Original" };
  const edits = new Map<string, { revision: number; description: string }>();
  const documents = {
    read: async (account: string, id: string) => {
      if (account !== "alice" || id !== "doc")
        throw new Error("Document not found");
      return { revision: document.revision, text: document.text };
    },
    apply: async (
      account: string,
      id: string,
      key: string,
      revision: number,
      edit: { kind: string; text?: string },
    ) => {
      await documents.read(account, id);
      const prior = edits.get(key);
      if (prior) return prior;
      if (revision !== document.revision) throw new Error("Document changed");
      document.text += `\n${edit.text}`;
      const receipt = {
        revision: ++document.revision,
        description: edit.text ?? "Image inserted",
      };
      edits.set(key, receipt);
      return receipt;
    },
  };
  let paid = 0;
  const executor = new ProAgentOperation(
    ledger,
    AGENT_BOOK,
    documents,
    transport ??
      (async (request) => {
        paid++;
        if (request.phase === "decision")
          expect(request).toMatchObject({
            progress: {
              planned: ["Add sourced paragraph"],
              completed: paid === 6 ? 1 : 0,
            },
          });
        expect((await ledger.status("alice")).reservedSubcredits).toBe(
          26_629_334,
        );
        const output =
          request.phase === "plan"
            ? { edits: ["Add sourced paragraph"] }
            : request.phase === "decision"
              ? {
                  kind: paid === 2 ? "search" : paid === 4 ? "append" : "done",
                  query: "trees",
                }
              : request.phase === "search"
                ? {
                    results: [
                      {
                        title: "Trees",
                        url: "https://example.test",
                        snippet: "Trees grow",
                      },
                    ],
                  }
                : { text: "Trees grow." };
        return {
          kind: "completed",
          completion: {
            kind: "agent",
            phase: request.phase,
            output,
            usage: { input: 100, cachedInput: 0, output: 10 },
            actualCostNanoUsd: request.phase === "search" ? 5_000_000 : 120_000,
          },
        };
      }),
  );
  const router = createAgentRouter({
    ledger: () => ledger,
    executor: () => executor,
    selected: async () => true,
    dispatch: async (account, id) => executor.execute(account, id),
  });
  const caller = (account: string) =>
    router.createCaller({
      drizzle: db,
      headers: new Headers(),
      session: { user: { id: account, role: "admin" }, expires: "2099-01-01" },
    } as never);
  return { client, ledger, document, executor, caller, calls: () => paid };
}
export const input = {
  documentId: "doc",
  revision: 1,
  prompt: "Add a sourced paragraph",
  idempotencyKey: "one",
  acceptedMaximum: 26_629_334,
};
export async function grant(f: Awaited<ReturnType<typeof fixture>>) {
  await f.ledger.grantEligibility("owner", "alice", "approved fixture");
  await f.ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "trial",
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 1_000_000_000,
    reason: "fixture",
    environment: "test",
  });
}
test("authenticated whole document action reserves before planner/search/generation, mutates and settles once with no admin or operation-id bypass", async () => {
  const f = await fixture();
  try {
    await expect(f.caller("alice").start(input)).rejects.toThrow();
    expect(f.calls()).toBe(0);
    await f.ledger.grantEligibility("owner", "alice", "approved fixture");
    await expect(f.caller("alice").start(input)).rejects.toThrow();
    await grant(f);
    await expect(
      f.caller("alice").start({ ...input, acceptedMaximum: 0 }),
    ).rejects.toThrow();
    const result = await f.caller("alice").start(input);
    expect(result.operation).toMatchObject({
      state: "settled",
      feature: "agent",
      charged: 1_866_667,
    });
    expect(result.report).toMatchObject({
      status: "complete",
      completed: [{ description: "Trees grow." }],
      incomplete: [],
    });
    expect(f.document.text).toBe("Original\nTrees grow.");
    expect(f.calls()).toBe(6);
    expect(await f.caller("alice").start(input)).toEqual(result);
    expect(f.calls()).toBe(6);
    expect((await f.ledger.status("alice")).providerCosts.knownNanoUsd).toBe(
      5_600_000,
    );
    await expect(
      f.caller("bob").operation({ id: result.operation.id }),
    ).rejects.toThrow();
    expect(
      await f.ledger.settle(result.operation.id, { kind: "technical_failure" }),
    ).toMatchObject({ state: "settled" });
  } finally {
    f.client.close();
  }
});

test("interrupted action retains per-edit receipts, refunds customer credits and keeps paid supplier costs", async () => {
  let step = 0;
  const f = await fixture(async (request) => {
    step++;
    if (step === 5) return { kind: "failed", actualCostNanoUsd: 1000 };
    const output =
      request.phase === "plan"
        ? { edits: ["first", "second"] }
        : request.phase === "decision"
          ? { kind: "append" }
          : { text: "First saved edit" };
    return {
      kind: "completed",
      completion: {
        kind: "agent",
        phase: request.phase,
        output,
        usage: { input: 100, cachedInput: 0, output: 10 },
        actualCostNanoUsd: 120000,
      },
    };
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(input);
    expect(result.operation.state).toBe("refunded");
    expect(result.report).toMatchObject({
      status: "failed",
      completed: [{ description: "First saved edit" }],
      incomplete: ["second"],
    });
    expect(f.document.text).toBe("Original\nFirst saved edit");
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 1_000_000_000,
      providerCosts: { knownNanoUsd: 481000, absorbedNanoUsd: 481000 },
    });
    expect(await f.caller("alice").start(input)).toEqual(result);
    expect(step).toBe(5);
  } finally {
    f.client.close();
  }
});
test("unknown paid result holds the reservation and duplicate workflow delivery never retries supplier work", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { kind: "unknown" };
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(input);
    expect(result.operation.state).toBe("unknown");
    expect(result.report.status).toBe("reconciling");
    expect(await f.executor.execute("alice", result.operation.id)).toEqual(
      result,
    );
    expect(calls).toBe(1);
    expect(await f.ledger.status("alice")).toMatchObject({
      reservedSubcredits: 26_629_334,
      providerCosts: { unknownExposureNanoUsd: 5_376_000 },
    });
    await expect(
      f.caller("alice").start({ ...input, idempotencyKey: "other" }),
    ).rejects.toThrow("still running");
  } finally {
    f.client.close();
  }
});
test("cancel before next mutation never claims unsaved edits; completion committed before losing cancellation still wins", async () => {
  let calls = 0;
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(async (request, _signal, scope) => {
    calls++;
    if (calls === 3) await f.ledger.cancel("alice", scope.operationId);
    const output =
      request.phase === "plan"
        ? { edits: ["first"] }
        : request.phase === "decision"
          ? { kind: "append" }
          : { text: "Must not save" };
    return {
      kind: "completed",
      completion: {
        kind: "agent",
        phase: request.phase,
        output,
        usage: { input: 100, cachedInput: 0, output: 10 },
        actualCostNanoUsd: 120000,
      },
    };
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(input);
    expect(result.operation.state).toBe("cancelled");
    expect(result.report).toMatchObject({
      status: "cancelled",
      completed: [],
      incomplete: ["first"],
    });
    expect(f.document.text).toBe("Original");
    expect(calls).toBe(3);
  } finally {
    f.client.close();
  }
});
test("concurrent edit stops mutation and refunds without overwriting; unsupported tool never becomes a partial advertised success", async () => {
  let calls = 0;
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(async (request) => {
    calls++;
    if (calls === 3) {
      f.document.revision = 2;
      f.document.text = "Human edit";
    }
    const output =
      request.phase === "plan"
        ? { edits: ["first"] }
        : request.phase === "decision"
          ? { kind: "append" }
          : { text: "AI edit" };
    return {
      kind: "completed",
      completion: {
        kind: "agent",
        phase: request.phase,
        output,
        usage: { input: 100, cachedInput: 0, output: 10 },
        actualCostNanoUsd: 120000,
      },
    };
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(input);
    expect(result.operation.state).toBe("refunded");
    expect(result.report).toMatchObject({
      status: "partial",
      completed: [],
      incomplete: ["first"],
    });
    expect(f.document.text).toBe("Human edit");
  } finally {
    f.client.close();
  }
});
test("whole action completion persisted before settlement outranks a losing failure under the settlement lock", async () => {
  const f = await fixture();
  try {
    await grant(f);
    const op = await f.executor.reserve("alice", input);
    await f.ledger.agentReport("alice", op.id, {
      status: "complete",
      completed: [{ revision: 2, description: "saved" }],
      incomplete: [],
    });
    await expect(
      f.ledger.settle(op.id, { kind: "technical_failure" }),
    ).rejects.toThrow("evidence");
  } finally {
    f.client.close();
  }
});

test("durable final decision and all saved edit receipts settle after lost report write, before a stale failure can refund", async () => {
  const f = await fixture();
  try {
    await grant(f);
    const op = await f.executor.reserve("alice", input);
    await f.ledger.claim(op.id);
    const descriptor = (key: string, phase: string) =>
      JSON.stringify({ key, phase, hash: "a".repeat(64) });
    const plan = await f.ledger.startAttempt(op.id, descriptor("plan", "plan"));
    await f.ledger.finishAttempt(plan, {
      kind: "completed",
      completion: {
        kind: "agent",
        phase: "plan",
        output: { edits: ["saved"] },
        usage: { input: 100, cachedInput: 0, output: 10 },
        actualCostNanoUsd: 120000,
      },
    });
    await f.ledger.agentReport("alice", op.id, {
      status: "pending",
      completed: [{ revision: 2, description: "Saved" }],
      incomplete: [],
    });
    const done = await f.ledger.startAttempt(
      op.id,
      descriptor("decision:1", "decision"),
    );
    await f.ledger.finishAttempt(done, {
      kind: "completed",
      completion: {
        kind: "agent",
        phase: "decision",
        output: { kind: "done" },
        usage: { input: 100, cachedInput: 0, output: 10 },
        actualCostNanoUsd: 120000,
      },
    });
    expect(
      await f.ledger.settle(op.id, { kind: "technical_failure" }),
    ).toMatchObject({ state: "settled", charged: 80000 });
    expect(
      (await f.caller("alice").operation({ id: op.id })).report.status,
    ).toBe("complete");
  } finally {
    f.client.close();
  }
});

test("a crashed paid fence becomes explicit reconciliation after the action lease, never free expiry or paid replay", async () => {
  const f = await fixture();
  try {
    await grant(f);
    const op = await f.executor.reserve("alice", input);
    await f.ledger.agentLease("alice", op.id);
    await f.ledger.claim(op.id);
    await f.ledger.startAttempt(
      op.id,
      JSON.stringify({ key: "plan", phase: "plan", hash: "a".repeat(64) }),
    );
    f.ledger.config.now = () => 127000;
    const recovered = await f.caller("alice").operation({ id: op.id });
    expect(recovered.operation.state).toBe("unknown");
    expect(recovered.report.status).toBe("reconciling");
    expect(f.calls()).toBe(0);
    expect(
      (await f.ledger.status("alice")).previousPeriodReservedSubcredits,
    ).toBe(26_629_334);
  } finally {
    f.client.close();
  }
});

test("an interrupted planner preserves reconciliation for a maximum length prompt", async () => {
  const f = await fixture(async () => ({ kind: "unknown" }));
  try {
    await grant(f);
    const result = await f
      .caller("alice")
      .start({ ...input, prompt: "a".repeat(1500) });
    expect(result.operation.state).toBe("unknown");
    expect(result.report.incomplete[0]?.length).toBeLessThanOrEqual(200);
  } finally {
    f.client.close();
  }
});

test("refunded whole-action failures cannot reopen the account supplier failure allowance", async () => {
  let paid = 0;
  const f = await fixture(async () => {
    paid++;
    return { kind: "failed", actualCostNanoUsd: 5_376_000 };
  });
  try {
    await grant(f);
    await f.client.execute("UPDATE pro_periods SET ends_at=1000000000");
    for (let i = 0; i < 187; i++) {
      f.ledger.config.now = () => 1000 + i * 61000;
      const result = await f
        .caller("alice")
        .start({ ...input, idempotencyKey: `failure-${i}` });
      expect(result.operation.charged).toBe(0);
      expect(result.operation.state).toBe("refunded");
    }
    expect(paid).toBe(186);
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 1_000_000_000,
      providerCosts: {
        knownNanoUsd: 999_936_000,
        absorbedNanoUsd: 999_936_000,
      },
    });
  } finally {
    f.client.close();
  }
});

test("reopening a document discovers its account-scoped durable action without trusting a client operation ID", async () => {
  const f = await fixture(async () => ({ kind: "unknown" }));
  try {
    await grant(f);
    const result = await f.caller("alice").start(input);
    expect(await f.caller("alice").current({ documentId: "doc" })).toEqual(
      result,
    );
    await expect(
      f.caller("bob").current({ documentId: "doc" }),
    ).rejects.toThrow();
    expect(f.calls()).toBe(0);
  } finally {
    f.client.close();
  }
});

import { supplierFixture } from "~/test/supplier-fixture";
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
    "0030_apple_sandbox",
    "0025_pro_narration",
    "0027_pro_agent",
  ])
    await client.executeMultiple(
      (
        await Bun.file(`../../packages/drizzle/drizzle/${name}.sql`).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  let now = 1000;
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    agentBook: () => AGENT_BOOK,
    now: () => now,
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
  return {
    client,
    ledger,
    document,
    executor,
    caller,
    calls: () => paid,
    setNow: (value: number) => {
      now = value;
    },
  };
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
    await f.ledger.recoverAgent("alice", op.id);
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

test("revocation between paid fence and actual agent dispatch prevents resolving a system key", async () => {
  const { authorizeAgentAttempt, createAgentProvider } = await import(
    "./agent-provider"
  );
  const { createHash } = await import("node:crypto");
  const f = await fixture();
  try {
    await grant(f);
    const op = await f.executor.reserve("alice", input);
    await f.ledger.claim(op.id);
    const request = { phase: "plan" as const, prompt: "write", context: "doc" };
    const attempt = await f.ledger.startAttempt(
      op.id,
      JSON.stringify({
        key: "plan",
        phase: "plan",
        hash: createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
      }),
    );
    // A completed eligibility mutation must win even if cancellation metadata has
    // not propagated to this operation (for example a restored durable row).
    await f.ledger.query(
      "UPDATE pro_eligibility SET active=0 WHERE account_id=?",
      ["alice"],
    );
    let keys = 0;
    const transport = createAgentProvider({
      authorize: authorizeAgentAttempt(f.ledger),
      resolveKey: () => {
        keys++;
        return "fixture-only";
      },
      resolveSearchEngine: () => "fixture",
      fetch: Object.assign(
        async () => {
          throw Error("Unexpected external request");
        },
        { preconnect() {} },
      ),
    });
    await expect(
      transport(request, new AbortController().signal, {
        accountId: "alice",
        operationId: op.id,
        attemptId: attempt,
      }),
    ).rejects.toThrow("authorization");
    expect(keys).toBe(0);
  } finally {
    f.client.close();
  }
});

test("corrupt persisted action descriptors fail closed before another paid step or settlement", async () => {
  for (const corrupt of [
    { key: "plan", phase: "other", hash: "a".repeat(64) },
    { key: "plan", phase: "plan", hash: "z".repeat(64) },
    { key: "plan", phase: "plan" },
    { key: "plan", phase: "plan", hash: "a".repeat(64), extra: true },
  ]) {
    const f = await fixture();
    try {
      await grant(f);
      const op = await f.executor.reserve("alice", input);
      await f.ledger.claim(op.id);
      const attempt = await f.ledger.startAttempt(
        op.id,
        JSON.stringify({ key: "plan", phase: "plan", hash: "a".repeat(64) }),
      );
      await f.ledger.finishAttempt(attempt, {
        kind: "completed",
        completion: {
          kind: "agent",
          phase: "plan",
          output: { edits: ["Add paragraph"] },
          usage: { input: 100, cachedInput: 0, output: 10 },
          actualCostNanoUsd: 120000,
        },
      });
      await f.client.execute({
        sql: "UPDATE pro_attempts SET chunk_hash=? WHERE id=?",
        args: [JSON.stringify(corrupt), attempt],
      });
      await expect(
        f.ledger.startAttempt(
          op.id,
          JSON.stringify({
            key: "decision:0",
            phase: "decision",
            hash: "b".repeat(64),
          }),
        ),
      ).rejects.toThrow();
      await expect(f.ledger.attempts("alice", op.id)).rejects.toThrow();
      await expect(
        f.ledger.settle(op.id, { kind: "technical_failure" }),
      ).rejects.toThrow();
      expect((await f.ledger.operation("alice", op.id)).state).toBe("running");
      expect(f.calls()).toBe(0);
    } finally {
      f.client.close();
    }
  }
});

test("agent adapter updates retain the first accepted period book and original durable input", async () => {
  const f = await fixture(async () => ({
    kind: "failed",
    actualCostNanoUsd: 7,
  }));
  try {
    await grant(f);
    const first = await f.caller("alice").start(input);
    const updated = new ProAgentOperation(
      f.ledger,
      { ...AGENT_BOOK, version: "agent-fixture-v2" },
      f.executor.documents,
      f.executor.transport,
    );
    expect(
      await updated.reserve("alice", {
        ...input,
        idempotencyKey: "after-update",
      }),
    ).toMatchObject({ quote: 26_629_334 });
    expect((await updated.reserve("alice", input)).id).toBe(first.operation.id);
  } finally {
    f.client.close();
  }
});

test("agent renewal uses its new credit conversion while original period operations retain historical charges", async () => {
  const f = await fixture(async () => ({
    kind: "failed",
    actualCostNanoUsd: 7,
  }));
  try {
    await grant(f);
    await f.caller("alice").start(input);
    let decisions = 0;
    const updated = new ProAgentOperation(
      f.ledger,
      {
        ...AGENT_BOOK,
        version: "agent-rate-v2",
        creditNanoUsd: 1_500_000,
        quote: 53_258_667,
      },
      f.executor.documents,
      async (request) => ({
        kind: "completed",
        completion: {
          kind: "agent",
          phase: request.phase,
          output:
            request.phase === "plan"
              ? { edits: ["Add text"] }
              : request.phase === "decision"
                ? { kind: ++decisions === 1 ? "append" : "done" }
                : { text: "New text" },
          usage: { input: 100, cachedInput: 0, output: 10 },
          actualCostNanoUsd: 120_000,
        },
      }),
    );
    expect((await updated.periodBook("alice")).quote).toBe(26_629_334);
    f.ledger.config.agentBook = () => updated.book;
    f.setNow(2000);
    await f.ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "renewal",
      startsAt: 2000,
      endsAt: 3000,
      subcredits: 1_000_000_000,
      reason: "fixture renewal",
      environment: "test",
    });
    const op = await updated.reserve("alice", {
      ...input,
      idempotencyKey: "renewed-action",
      acceptedMaximum: 53_258_667,
    });
    const done = await updated.execute("alice", op.id);
    expect(done.operation).toMatchObject({
      quote: 53_258_667,
      charged: 320_000,
      state: "settled",
    });
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 999_680_000,
      providerCosts: { knownNanoUsd: 480_007 },
    });
  } finally {
    f.client.close();
  }
});

test("authenticated action pins configured customer rates before its first quote and unavailable periods stay unavailable", async () => {
  const f = await fixture(async () => ({ kind: "unknown" }));
  try {
    await grant(f);
    f.ledger.config.agentBook = () => ({
      ...AGENT_BOOK,
      version: "new-customer-rate",
      creditNanoUsd: 1500000,
      quote: 53258667,
    });
    // The adapter introduced after period creation must see the original complete schedule.
    const updated = new ProAgentOperation(
      f.ledger,
      f.ledger.config.agentBook(),
      f.executor.documents,
      f.executor.transport,
    );
    const router = createAgentRouter({
      ledger: () => f.ledger,
      executor: () => updated,
      selected: async () => true,
      dispatch: async () => {},
    });
    const caller = router.createCaller({
      drizzle: db,
      headers: new Headers(),
      session: { user: { id: "alice" } },
    } as never);
    expect(
      (await caller.quote({ documentId: "doc", prompt: "Add text" })).maximum,
    ).toBe(26629334);
    f.setNow(2000);
    await f.ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "renewed",
      startsAt: 2000,
      endsAt: 3000,
      subcredits: 1000000000,
      reason: "renewal",
      environment: "test",
    });
    expect(
      (await caller.quote({ documentId: "doc", prompt: "Add text" })).maximum,
    ).toBe(53258667);
    f.setNow(3000);
    f.ledger.config.agentBook = undefined;
    await f.ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "unavailable",
      startsAt: 3000,
      endsAt: 4000,
      subcredits: 1000000000,
      reason: "unavailable",
      environment: "test",
    });
    f.ledger.config.agentBook = () => AGENT_BOOK;
    await expect(
      caller.quote({ documentId: "doc", prompt: "Add text" }),
    ).rejects.toThrow("unavailable for this period");
  } finally {
    f.client.close();
  }
});

test("authenticated agent dispatch selects the supplier model with raised bounds while its customer action keeps original rates", async () => {
  const { createAgentProvider, authorizeAgentAttempt } = await import(
    "./agent-provider"
  );
  let provider: ReturnType<typeof createAgentProvider>;
  const f = await fixture((request, signal, scope) =>
    provider(request, signal, scope),
  );
  let calls = 0;
  provider = createAgentProvider({
    authorize: authorizeAgentAttempt(f.ledger),
    resolveKey: () => "synthetic-agent-key",
    resolveSearchEngine: () => "synthetic-engine",
    fetch: Object.assign(
      async (_url: RequestInfo | URL, options?: RequestInit) => {
        const body = JSON.parse(String(options?.body));
        expect(body.model).toBe("synthetic-agent-v2");
        const output =
          ++calls === 1
            ? { edits: ["Add text"] }
            : calls === 2
              ? { kind: "append" }
              : calls === 3
                ? { text: "New text" }
                : { kind: "done" };
        return Response.json({
          id: `agent-${calls}`,
          object: "response",
          created_at: 1000,
          model: body.model,
          status: "completed",
          output: [
            {
              id: "message",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(output),
                  annotations: [],
                },
              ],
            },
          ],
          usage: {
            input_tokens: 4096,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 512,
            total_tokens: 4608,
          },
        });
      },
      { preconnect() {} },
    ),
  });
  try {
    await grant(f);
    f.ledger.config.supplierBooks = () => ({
      ...supplierFixture(),
      agent: {
        ...AGENT_BOOK,
        version: "supplier-agent-v2",
        model: "synthetic-agent-v2",
        inputNanoUsd: 1500,
        cachedInputNanoUsd: 150,
        outputNanoUsd: 9000,
        textMaximumNanoUsd: 10752000,
        maximumNanoUsd: 149776000,
        quote: 49925334,
      },
    });
    const result = await f.caller("alice").start(input);
    expect(result.operation).toMatchObject({
      state: "settled",
      charged: 7168000,
    });
    expect(result.report.status).toBe("complete");
    expect(calls).toBe(4);
    expect((await f.ledger.status("alice")).providerCosts).toMatchObject({
      knownNanoUsd: 0,
      unknownExposureNanoUsd: 43008000,
    });
  } finally {
    f.client.close();
  }
});

test("legacy periods recover accepted action prices and do not introduce a configured feature without historical evidence", async () => {
  const { PRICEBOOK } = await import("./contracts");
  const f = await fixture(async () => ({ kind: "unknown" }));
  try {
    await grant(f);
    const accepted = await f.caller("alice").start(input);
    await f.client.execute({
      sql: "UPDATE pro_periods SET pricebook=?",
      args: [JSON.stringify(PRICEBOOK)],
    });
    f.ledger.config.agentBook = () => ({
      ...AGENT_BOOK,
      version: "later",
      creditNanoUsd: 1500000,
      quote: 53258667,
    });
    expect((await f.executor.periodBook("alice")).quote).toBe(26629334);
    expect(
      (await f.caller("alice").operation({ id: accepted.operation.id }))
        .operation.state,
    ).toBe("unknown");
    f.setNow(2000);
    await f.ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "legacy-empty",
      startsAt: 2000,
      endsAt: 3000,
      subcredits: 1000000000,
      reason: "legacy",
      environment: "test",
    });
    await f.client.execute({
      sql: "UPDATE pro_periods SET pricebook=? WHERE starts_at=2000",
      args: [
        JSON.stringify({
          version: "period-rates-v1",
          text: PRICEBOOK,
          narration: supplierFixture().narration,
          image: null,
          agent: null,
        }),
      ],
    });
    await expect(
      f.caller("alice").quote({ documentId: "doc", prompt: "Add text" }),
    ).rejects.toThrow("unavailable for this period");
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      1000000000,
    );
  } finally {
    f.client.close();
  }
});

test("owned action reads and cancellation survive removed executor without paid recovery or leaked documents", async () => {
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
    let revoked = false;
    const router = createAgentRouter({
      ledger: () => f.ledger,
      executor: () => undefined,
      documents: () => ({
        read: async (account: string, document: string) => {
          if (revoked) throw new Error("Document not found");
          return f.executor.documents.read(account, document);
        },
      }),
      selected: async () => false,
      dispatch: async () => {
        throw new Error("Must not dispatch");
      },
    });
    const caller = (account: string) =>
      router.createCaller({
        drizzle: db,
        headers: new Headers(),
        session: { user: { id: account } },
      } as never);
    const before = await f.ledger.operation("alice", op.id);
    expect(
      (await caller("alice").current({ documentId: "doc" }))?.operation.id,
    ).toBe(op.id);
    expect((await caller("alice").operation({ id: op.id })).operation).toEqual(
      before,
    );
    expect(await f.ledger.operation("alice", op.id)).toEqual(before);
    const stopped = await caller("alice").cancel({ id: op.id });
    expect(stopped.operation.cancel_requested).toBe(1);
    expect(stopped.operation.state).toBe("running");
    expect(stopped.operation.charged).toBe(0);
    expect(stopped.operation.quote).toBe(before.quote);
    expect(f.calls()).toBe(0);
    await expect(caller("bob").operation({ id: op.id })).rejects.toThrow();
    revoked = true;
    await expect(
      caller("alice").current({ documentId: "doc" }),
    ).rejects.toThrow();
    await expect(caller("alice").operation({ id: op.id })).rejects.toThrow();
    await expect(caller("alice").cancel({ id: op.id })).rejects.toThrow();
  } finally {
    f.client.close();
  }
});

test("owned action recovery reads the requested key even when another action is current, independent of admission", async () => {
  const awaitSchema = await import("@packages/drizzle/drizzle-schema");
  const f = await fixture();
  try {
    await grant(f);
    const original = await f.executor.reserve("alice", {
      ...input,
      idempotencyKey: "original-pending",
    });
    await f.ledger.cancel("alice", original.id);
    await f.executor.reserve("alice", {
      ...input,
      idempotencyKey: "newer-action",
    });
    const router = createAgentRouter({
      ledger: () => f.ledger,
      executor: () => undefined,
      documents: () => f.executor.documents,
      selected: async () => false,
      dispatch: async () => {
        throw Error("Recovery cannot dispatch");
      },
    });
    const caller = (account: string) =>
      router.createCaller({
        drizzle: db,
        schema: awaitSchema,
        auth: { kind: "session" },
        headers: new Headers(),
        session: { user: { id: account }, expires: "2099-01-01" },
      });
    expect(
      (
        await caller("alice").current({
          documentId: "doc",
          idempotencyKey: "original-pending",
        })
      )?.operation.id,
    ).toBe(original.id);
    expect(
      await caller("alice").current({
        documentId: "doc",
        idempotencyKey: "not-inserted-yet",
      }),
    ).toBeNull();
    await expect(
      caller("bob").current({
        documentId: "doc",
        idempotencyKey: "original-pending",
      }),
    ).rejects.toThrow();
    await expect(
      caller("alice").current({
        documentId: "other-doc",
        idempotencyKey: "original-pending",
      }),
    ).rejects.toThrow();
    expect(f.calls()).toBe(0);
  } finally {
    f.client.close();
  }
});

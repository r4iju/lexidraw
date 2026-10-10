import { expect, test } from "bun:test";
import { fixture, grant, input } from "./agent-operation.test";
import { AGENT_BOOK } from "~/lib/agent/contracts";
import type { AgentTransport } from "./agent-operation";
import { supplierFixture } from "~/test/supplier-fixture";
export const TOOL_BOOK = {
  ...AGENT_BOOK,
  version: "synthetic-typed-tools-v1",
  provenance: "deterministic-whole-action-fixture",
  sandbox: {
    provider: "synthetic-isolated-task",
    endpoint: "typed-task-v1",
    maximumNanoUsd: 1000000,
    maxSteps: 2,
    maxDurationMs: 6000,
    maxInputBytes: 4096,
    maxOutputBytes: 1500,
    network: "none",
    secrets: "none",
  },
  delegation: { maxDepth: 1, maxCalls: 1, maxCycles: 2 },
  maxAttempts: 17,
  maximumNanoUsd: 81888000,
  quote: 27296000,
};
async function toolsFixture(transport: AgentTransport) {
  const f = await fixture(transport);
  f.ledger.config.agentBook = () => TOOL_BOOK;
  f.ledger.config.supplierBooks = () => ({
    ...supplierFixture(),
    agent: TOOL_BOOK,
  });
  return f;
}
const task = { kind: "summarize_numbers" as const, values: [2, 4, 6] };
const accepted = { ...input, acceptedMaximum: 27296000 };
const complete = (request: Parameters<AgentTransport>[0], output: unknown) => ({
  kind: "completed" as const,
  completion: {
    kind: "agent" as const,
    phase: request.phase,
    output,
    usage: { input: 100, cachedInput: 0, output: 10 },
    actualCostNanoUsd: request.phase === "sandbox" ? 1000000 : 120000,
  },
});
test("authenticated sandbox action includes tool cost and saved mutation in one parent charge", async () => {
  let calls = 0;
  const f = await toolsFixture(async (request) => {
    calls++;
    return complete(
      request,
      request.phase === "plan"
        ? { edits: ["Save summary"] }
        : request.phase === "decision"
          ? {
              kind: calls === 2 ? "sandbox" : "done",
              ...(calls === 2 ? { task } : {}),
            }
          : { text: "Count 3, sum 12, mean 4" },
    );
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(result.operation).toMatchObject({
      state: "settled",
      charged: 453334,
    });
    expect(result.report.status).toBe("complete");
    expect(f.document.text).toBe("Original\nCount 3, sum 12, mean 4");
    expect((await f.ledger.status("alice")).providerCosts.knownNanoUsd).toBe(
      1360000,
    );
    expect(await f.caller("alice").start(accepted)).toEqual(result);
    expect(calls).toBe(4);
  } finally {
    f.client.close();
  }
});
test("delegated planning, sandbox and model synthesis share parent budget and save one receipt", async () => {
  const phases: string[] = [];
  const f = await toolsFixture(async (request) => {
    phases.push(request.phase);
    if (request.phase.startsWith("delegate_"))
      expect(request.delegation).toEqual({
        depth: 1,
        objective: "Summarize numbers",
      });
    return complete(
      request,
      request.phase === "plan"
        ? { edits: ["Summary"] }
        : request.phase === "decision"
          ? {
              kind: phases.length === 2 ? "delegate" : "done",
              ...(phases.length === 2
                ? { objective: "Summarize numbers" }
                : {}),
            }
          : request.phase === "delegate_plan"
            ? { kind: "sandbox", task }
            : {
                text:
                  request.phase === "sandbox"
                    ? "Sum 12"
                    : "Delegated sum is 12.",
              },
    );
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(result.operation).toMatchObject({
      state: "settled",
      charged: 533334,
    });
    expect(result.report.completed).toEqual([
      { revision: 2, description: "Delegated sum is 12." },
    ]);
    expect(phases).toEqual([
      "plan",
      "decision",
      "delegate_plan",
      "sandbox",
      "delegate_generation",
      "decision",
    ]);
    expect((await f.ledger.status("alice")).providerCosts.knownNanoUsd).toBe(
      1600000,
    );
  } finally {
    f.client.close();
  }
});
test("trusted operation tool adapter executes key-free typed jobs and inherited delegated SDK calls", async () => {
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  const { createAgentProvider, authorizeAgentAttempt } = await import(
    "./agent-provider"
  );
  let adapter: AgentTransport;
  const serialized: string[] = [];
  let modelCalls = 0;
  const f = await toolsFixture((request, signal, scope) =>
    adapter(request, signal, scope),
  );
  adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: createAgentProvider({
      authorize: authorizeAgentAttempt(f.ledger),
      resolveKey: () => "synthetic-system-key",
      resolveSearchEngine: () => undefined,
      fetch: Object.assign(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          expect(String(_url)).toBe("https://api.openai.com/v1/responses");
          const body = JSON.parse(String(init?.body));
          expect(JSON.stringify(body)).not.toContain("synthetic-system-key");
          modelCalls++;
          if (modelCalls === 4)
            expect(JSON.stringify(body)).toContain("Sum 12");
          const output =
            modelCalls === 1
              ? { edits: ["summary"] }
              : modelCalls === 2
                ? { kind: "delegate", objective: "Summarize numbers" }
                : modelCalls === 3
                  ? { kind: "sandbox", task }
                  : modelCalls === 4
                    ? { text: "Delegated summary." }
                    : { kind: "done" };
          return Response.json({
            id: `model-${modelCalls}`,
            object: "response",
            created_at: 1000,
            model: body.model,
            status: "completed",
            output: [
              {
                id: "msg",
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
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 10,
              total_tokens: 110,
            },
          });
        },
        { preconnect() {} },
      ),
    }),
    sandbox: {
      provider: "synthetic-isolated-task",
      endpoint: "typed-task-v1",
      prepare: async (job) => {
        serialized.push(JSON.stringify(job));
        return {
          dispatch: async () => ({
            kind: "completed",
            text: `Sum ${job.task.values.reduce((sum, value) => sum + value, 0)}`,
            actualCostNanoUsd: 1000000,
          }),
        };
      },
    },
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(result.report.status).toBe("complete");
    expect(f.document.text).toBe("Original\nDelegated summary.");
    expect(modelCalls).toBe(5);
    expect(serialized).toHaveLength(1);
    expect(serialized.join()).not.toMatch(
      /synthetic-system-key|Authorization|apiKey|accountId|operationId|prompt|context/,
    );
    expect(serialized[0]).toContain('"network":"none"');
  } finally {
    f.client.close();
  }
});
async function sandboxAttempt(
  f: Awaited<ReturnType<typeof toolsFixture>>,
  request = {
    phase: "sandbox" as const,
    prompt: input.prompt,
    context: "Original",
    task,
  },
) {
  const { createHash } = await import("node:crypto");
  const op = await f.executor.reserve("alice", accepted);
  await f.ledger.claim(op.id);
  const attemptId = await f.ledger.startAttempt(
    op.id,
    JSON.stringify({
      key: "sandbox:0",
      phase: request.phase,
      hash: createHash("sha256").update(JSON.stringify(request)).digest("hex"),
    }),
  );
  return {
    request,
    scope: { accountId: "alice", operationId: op.id, attemptId },
  };
}
test("concurrent redelivery after a paid fence never dispatches a second sandbox job, including a fresh adapter", async () => {
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  const f = await toolsFixture(async () => ({ kind: "unknown" }));
  let dispatched = 0;
  const makeAdapter = () =>
    createAgentToolProvider({
      ledger: f.ledger,
      model: async () => ({ kind: "unknown" }),
      sandbox: {
        provider: "synthetic-isolated-task",
        endpoint: "typed-task-v1",
        prepare: async () => ({
          dispatch: async () => {
            dispatched++;
            return { kind: "unknown" };
          },
        }),
      },
    });
  try {
    await grant(f);
    const { request, scope } = await sandboxAttempt(f);
    const results = await Promise.allSettled([
      makeAdapter()(request, new AbortController().signal, scope),
      makeAdapter()(request, new AbortController().signal, scope),
    ]);
    expect(results).toHaveLength(2);
    expect(dispatched).toBe(1);
    await makeAdapter()(request, new AbortController().signal, scope).catch(
      () => {},
    );
    expect(dispatched).toBe(1);
  } finally {
    f.client.close();
  }
});
test("cancellation between durable tool fence and dispatch stops spend and releases the unsent action", async () => {
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  let adapter: AgentTransport;
  let dispatched = 0;
  let n = 0;
  const f = await toolsFixture((request, signal, scope) =>
    adapter(request, signal, scope),
  );
  adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: async (request) =>
      complete(
        request,
        request.phase === "plan"
          ? { edits: ["summary"] }
          : { kind: ++n === 1 ? "sandbox" : "done", task },
      ),
    sandbox: {
      provider: "synthetic-isolated-task",
      endpoint: "typed-task-v1",
      prepare: async (job) => {
        const attempts = await f.ledger.query(
          "SELECT operation_id FROM pro_attempts WHERE id=?",
          [job.receiptId],
        );
        await f.ledger.cancel("alice", String(attempts[0]?.operation_id));
        return {
          dispatch: async () => {
            dispatched++;
            return {
              kind: "completed",
              text: "Not saved",
              actualCostNanoUsd: 1000000,
            };
          },
        };
      },
    },
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(dispatched).toBe(0);
    expect(result.operation.state).toBe("cancelled");
    expect(result.report.status).toBe("cancelled");
    expect(result.report.completed).toEqual([]);
    expect((await f.ledger.status("alice")).reservedSubcredits).toBe(0);
  } finally {
    f.client.close();
  }
});
test("expired parent attempt cannot spend under a renewed entitlement; forged account, parent and revoked grant never reach tools", async () => {
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  const f = await toolsFixture(async () => ({ kind: "unknown" }));
  let dispatched = 0;
  const adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: async () => ({ kind: "unknown" }),
    sandbox: {
      provider: "synthetic-isolated-task",
      endpoint: "typed-task-v1",
      prepare: async () => ({
        dispatch: async () => {
          dispatched++;
          return { kind: "unknown" };
        },
      }),
    },
  });
  try {
    await expect(f.caller("alice").start(accepted)).rejects.toThrow();
    await grant(f);
    const { request, scope } = await sandboxAttempt(f);
    await expect(
      adapter(request, new AbortController().signal, {
        ...scope,
        accountId: "bob",
      }),
    ).rejects.toThrow();
    await expect(
      adapter(request, new AbortController().signal, {
        ...scope,
        operationId: "forged-parent",
      }),
    ).rejects.toThrow();
    f.setNow(2000);
    await f.ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "renewal-tools",
      startsAt: 2000,
      endsAt: 200000,
      subcredits: 1000000000,
      reason: "fixture",
      environment: "test",
    });
    f.setNow(121000);
    await expect(
      adapter(request, new AbortController().signal, scope),
    ).rejects.toThrow();
    await f.ledger.revoke("owner", "alice", "revoked fixture");
    await expect(
      adapter(request, new AbortController().signal, scope),
    ).rejects.toThrow();
    expect(dispatched).toBe(0);
  } finally {
    f.client.close();
  }
});
test("forged delegated depth are rejected before nested provider calls", async () => {
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  const { createHash } = await import("node:crypto");
  const f = await toolsFixture(async () => ({ kind: "unknown" }));
  let called = 0;
  const adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: async (request) => {
      called++;
      return complete(request, { kind: "generate" });
    },
  });
  try {
    await grant(f);
    const op = await f.executor.reserve("alice", accepted);
    await f.ledger.claim(op.id);
    const request = JSON.parse(
      JSON.stringify({
        phase: "delegate_plan",
        prompt: input.prompt,
        context: "Original",
        delegation: { depth: 2, objective: "Escape" },
      }),
    );
    const attemptId = await f.ledger.startAttempt(
      op.id,
      JSON.stringify({
        key: "delegate:0:plan",
        phase: "delegate_plan",
        hash: createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
      }),
    );
    await expect(
      adapter(request, new AbortController().signal, {
        accountId: "alice",
        operationId: op.id,
        attemptId,
      }),
    ).rejects.toThrow();
    expect(called).toBe(0);
  } finally {
    f.client.close();
  }
});
test("durable delegated call cap prevents a second worker after restart before supplier admission", async () => {
  const { createHash } = await import("node:crypto");
  const f = await toolsFixture(async () => ({ kind: "unknown" }));
  try {
    await grant(f);
    const op = await f.executor.reserve("alice", accepted);
    await f.ledger.claim(op.id);
    const request = {
      phase: "delegate_plan" as const,
      prompt: input.prompt,
      context: "Original",
      delegation: { depth: 1 as const, objective: "Summarize" },
    };
    const descriptor = (key: string) =>
      JSON.stringify({
        key,
        phase: "delegate_plan",
        hash: createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
      });
    const first = await f.ledger.startAttempt(
      op.id,
      descriptor("delegate:0:plan"),
    );
    await f.ledger.finishAttempt(
      first,
      complete(request, { kind: "generate" }),
    );
    await expect(
      f.ledger.startAttempt(op.id, descriptor("delegate:1:plan")),
    ).rejects.toThrow();
    expect(await f.ledger.attempts("alice", op.id)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});
test("oversized UTF-8 delegated model output stays uncertain without saving a claimed edit", async () => {
  let calls = 0;
  const f = await toolsFixture(async (request) => {
    calls++;
    return complete(
      request,
      request.phase === "plan"
        ? { edits: ["summary"] }
        : request.phase === "decision"
          ? { kind: calls === 2 ? "delegate" : "done", objective: "Summarize" }
          : request.phase === "delegate_plan"
            ? { kind: "generate" }
            : { text: "界".repeat(600) },
    );
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(result.operation.state).toBe("unknown");
    expect(result.report.completed).toEqual([]);
    expect(f.document.text).toBe("Original");
    expect(calls).toBe(4);
    expect(await f.executor.execute("alice", result.operation.id)).toEqual(
      result,
    );
    expect(calls).toBe(4);
  } finally {
    f.client.close();
  }
});
test("sandbox duration cap holds unknown paid outcome when a port ignores cancellation", async () => {
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  const f = await toolsFixture(async () => ({ kind: "unknown" }));
  let dispatched = 0;
  const adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: async () => ({ kind: "unknown" }),
    sandbox: {
      provider: "synthetic-isolated-task",
      endpoint: "typed-task-v1",
      prepare: async () => ({
        dispatch: async () => {
          dispatched++;
          return new Promise(() => {});
        },
      }),
    },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await grant(f);
    const { request, scope } = await sandboxAttempt(f);
    const outcome = await Promise.race([
      adapter(request, new AbortController().signal, scope),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("deadline-not-enforced"), 6200);
      }),
    ]);
    expect(outcome).toEqual({ kind: "unknown" });
    expect(dispatched).toBe(1);
  } finally {
    clearTimeout(timer);
    f.client.close();
  }
}, 10000);
test("cancelled final SDK authorization confirms no paid model dispatch and preserves earlier saved edits", async () => {
  const { createAgentProvider, authorizeAgentAttempt } = await import(
    "./agent-provider"
  );
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  let adapter: AgentTransport;
  let decisions = 0;
  let dispatched = 0;
  let checks = 0;
  const f = await toolsFixture((request, signal, scope) =>
    adapter(request, signal, scope),
  );
  const model = createAgentProvider({
    authorize: async (scope, request) => {
      if (++checks === 2) await f.ledger.cancel("alice", scope.operationId);
      return authorizeAgentAttempt(f.ledger)(scope, request);
    },
    resolveKey: () => "synthetic-system-key",
    resolveSearchEngine: () => undefined,
    fetch: Object.assign(
      async () => {
        dispatched++;
        throw new Error("must not dispatch");
      },
      { preconnect() {} },
    ),
  });
  adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: async (request, signal, scope) =>
      request.phase === "delegate_plan"
        ? model(request, signal, scope)
        : complete(
            request,
            request.phase === "plan"
              ? { edits: ["first", "second"] }
              : request.phase === "decision"
                ? ++decisions === 1
                  ? { kind: "append" }
                  : { kind: "delegate", objective: "second" }
                : { text: "Saved first" },
          ),
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(dispatched).toBe(0);
    expect(result.operation.state).toBe("cancelled");
    expect(result.report.completed).toEqual([
      { revision: 2, description: "Saved first" },
    ]);
    expect(result.report.incomplete).toEqual(["second"]);
    expect((await f.ledger.status("alice")).providerCosts.knownNanoUsd).toBe(
      480000,
    );
  } finally {
    f.client.close();
  }
});
test("oversized SDK wire responses are held before parsing ignored provider fields", async () => {
  const { createAgentProvider, authorizeAgentAttempt } = await import(
    "./agent-provider"
  );
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  let adapter: AgentTransport;
  let calls = 0;
  const f = await toolsFixture((request, signal, scope) =>
    adapter(request, signal, scope),
  );
  adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: createAgentProvider({
      authorize: authorizeAgentAttempt(f.ledger),
      resolveKey: () => "synthetic-system-key",
      resolveSearchEngine: () => undefined,
      fetch: Object.assign(
        async () => {
          calls++;
          return Response.json({
            id: "wire",
            object: "response",
            created_at: 1000,
            model: "gpt-5.4-mini",
            status: "completed",
            metadata: { ignored: "x".repeat(20000) },
            output: [
              {
                id: "msg",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify(
                      calls === 1 ? { edits: ["summary"] } : { kind: "done" },
                    ),
                    annotations: [],
                  },
                ],
              },
            ],
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 10,
              total_tokens: 110,
            },
          });
        },
        { preconnect() {} },
      ),
    }),
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(result.operation.state).toBe("unknown");
    expect(calls).toBe(1);
    expect(result.report.completed).toEqual([]);
  } finally {
    f.client.close();
  }
});
test("nested planning cycles consume the parent cycle allowance before any extra paid worker call", async () => {
  let decisions = 0;
  let nested = 0;
  const f = await toolsFixture(async (request) => {
    if (request.phase.startsWith("delegate_")) nested++;
    return complete(
      request,
      request.phase === "plan"
        ? { edits: ["one", "two", "three", "four", "five", "six"] }
        : request.phase === "decision"
          ? ++decisions < 6
            ? { kind: "append" }
            : { kind: "delegate", objective: "six" }
          : request.phase === "delegate_plan"
            ? { kind: "generate" }
            : { text: "Saved" },
    );
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(nested).toBe(0);
    expect(result.operation.state).toBe("refunded");
    expect(result.report.status).toBe("cap_exhausted");
    expect(result.report.completed).toHaveLength(5);
    expect(result.report.incomplete).toEqual(["six"]);
    expect((await f.ledger.status("alice")).providerCosts.knownNanoUsd).toBe(
      1440000,
    );
    expect(await f.caller("alice").start(accepted)).toEqual(result);
    expect(nested).toBe(0);
  } finally {
    f.client.close();
  }
});
test("confirmed sandbox failure refunds the entire action, retains saved edits and holds invalid supplier invoice separately without replay", async () => {
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  let adapter: AgentTransport;
  let decisions = 0;
  let tools = 0;
  const f = await toolsFixture((request, signal, scope) =>
    adapter(request, signal, scope),
  );
  adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: async (request) =>
      complete(
        request,
        request.phase === "plan"
          ? { edits: ["first", "second"] }
          : request.phase === "decision"
            ? ++decisions === 1
              ? { kind: "append" }
              : { kind: "sandbox", task }
            : { text: "First saved" },
      ),
    sandbox: {
      provider: "synthetic-isolated-task",
      endpoint: "typed-task-v1",
      prepare: async () => ({
        dispatch: async () => {
          tools++;
          return { kind: "failed", actualCostNanoUsd: -1 };
        },
      }),
    },
  });
  try {
    await grant(f);
    const result = await f.caller("alice").start(accepted);
    expect(result.operation.state).toBe("refunded");
    expect(result.report).toMatchObject({
      status: "failed",
      completed: [{ revision: 2, description: "First saved" }],
      incomplete: ["second"],
    });
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 1000000000,
      providerCosts: {
        knownNanoUsd: 480000,
        absorbedNanoUsd: 480000,
        unknownExposureNanoUsd: 1000000,
      },
    });
    expect(await f.caller("alice").start(accepted)).toEqual(result);
    expect(tools).toBe(1);
  } finally {
    f.client.close();
  }
});
test("delegated recovery without its durable supplier contract never invents archived dispatch authority", async () => {
  const { createHash } = await import("node:crypto");
  const { createAgentToolProvider } = await import("./agent-tool-provider");
  const f = await toolsFixture(async () => ({ kind: "unknown" }));
  let calls = 0;
  const adapter = createAgentToolProvider({
    ledger: f.ledger,
    model: async (request) => {
      calls++;
      return complete(request, { kind: "generate" });
    },
  });
  try {
    await grant(f);
    const op = await f.executor.reserve("alice", accepted);
    await f.ledger.claim(op.id);
    const request = {
      phase: "delegate_plan" as const,
      prompt: input.prompt,
      context: "Original",
      delegation: { depth: 1 as const, objective: "Summarize" },
    };
    const attemptId = crypto.randomUUID();
    await f.client.execute({
      sql: "INSERT INTO pro_attempts(id,operation_id,number,state,exposure_nano_usd,created_at,chunk_hash) VALUES (?,?,1,'started',5376000,1000,?)",
      args: [
        attemptId,
        op.id,
        JSON.stringify({
          key: "delegate:0:plan",
          phase: "delegate_plan",
          hash: createHash("sha256")
            .update(JSON.stringify(request))
            .digest("hex"),
        }),
      ],
    });
    await expect(
      adapter(request, new AbortController().signal, {
        accountId: "alice",
        operationId: op.id,
        attemptId,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  } finally {
    f.client.close();
  }
});
test("aggregate durable tool count cannot escape the parent limit through distinct step keys", async () => {
  const { createHash } = await import("node:crypto");
  const f = await toolsFixture(async () => ({ kind: "unknown" }));
  try {
    await grant(f);
    const op = await f.executor.reserve("alice", accepted);
    await f.ledger.claim(op.id);
    const request = {
      phase: "generation" as const,
      prompt: input.prompt,
      context: "Original",
    };
    const descriptor = (key: string) =>
      JSON.stringify({
        key,
        phase: request.phase,
        hash: createHash("sha256")
          .update(JSON.stringify(request))
          .digest("hex"),
      });
    for (let step = 0; step < 8; step++) {
      const attempt = await f.ledger.startAttempt(
        op.id,
        descriptor(`generation:${step}`),
      );
      await f.ledger.finishAttempt(
        attempt,
        complete(request, { text: "Bounded" }),
      );
    }
    await expect(
      f.ledger.startAttempt(op.id, descriptor("generation:8")),
    ).rejects.toThrow();
    expect(await f.ledger.attempts("alice", op.id)).toHaveLength(8);
  } finally {
    f.client.close();
  }
});

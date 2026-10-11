import { supplierFixture } from "~/test/supplier-fixture";
import { expect, mock, test } from "bun:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import * as schema from "@packages/drizzle/drizzle-schema";
import { installServerRuntime } from "~/test/server-runtime";
import { ProLedger } from "./ledger";
import { ProTextOperation, type ProTransport } from "./operation";
import { ProChat } from "./chat";
import { PRICEBOOK } from "./contracts";
import { createChatStreamRoute } from "./chat-route";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { createProRouter } = await import("../api/routers/pro");
async function fixture(
  transport: ProTransport,
  enabled = true,
  initialBook: unknown = PRICEBOOK,
) {
  const client = createClient({ url: ":memory:" });
  for (const migration of [
    "0015_private_pro.sql",
    "0016_pro_billing_events.sql",
    "0029_sandbox_billing.sql",
    "0030_apple_sandbox.sql",
  ])
    await client.executeMultiple(
      (
        await Bun.file(
          new URL(
            `../../../../../packages/drizzle/drizzle/${migration}`,
            import.meta.url,
          ),
        ).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  let now = 1000;
  let book: unknown = initialBook;
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: () => now,
    textBook: () => book,
  });
  await ledger.grantEligibility("owner", "alice", "tester");
  await ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "trial",
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 10000000,
    reason: "trial",
    environment: "test",
  });
  const chat = new ProChat(ledger, new ProTextOperation(ledger, transport));
  const router = createProRouter({
    ledger: () => ledger,
    chat: enabled ? () => chat : undefined,
    dispatch: async () => {},
  });
  await db
    .insert(schema.users)
    .values({
      id: "alice",
      name: "Alice",
      email: "chat-alice@example.test",
      config: { aiPower: { mode: "pro" } },
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { config: { aiPower: { mode: "pro" } } },
    });
  const caller = router.createCaller({
    drizzle: db,
    schema: {},
    session: { user: { id: "alice" } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  const anonymous = router.createCaller({
    drizzle: db,
    schema: {},
    session: null,
    auth: { kind: "none" },
    headers: new Headers(),
  } as never);
  return {
    client,
    ledger,
    chat,
    caller,
    anonymous,
    clock: (value: number) => {
      now = value;
    },
    rates: (value: unknown) => {
      book = value;
    },
  };
}
test("authenticated chat enforces selected Pro, entitlement and unchanged input, period and rates at acceptance", async () => {
  const f = await fixture(async () => ({ kind: "unknown" }));
  try {
    await expect(f.anonymous.chatQuote({ prompt: "Hello" })).rejects.toThrow();
    await db
      .update(schema.users)
      .set({ config: { aiPower: { mode: "byok", provider: "openrouter" } } })
      .where(eq(schema.users.id, "alice"));
    await expect(f.caller.chatQuote({ prompt: "Hello" })).rejects.toThrow(
      "Select Pro",
    );
    await db
      .update(schema.users)
      .set({ config: { aiPower: { mode: "pro" } } })
      .where(eq(schema.users.id, "alice"));
    const quote = await f.caller.chatQuote({ prompt: "Hello" });
    await expect(
      f.caller.chatAccept({
        idempotencyKey: "changed",
        input: { prompt: "Different" },
        quote,
      }),
    ).rejects.toThrow("input changed");
    await expect(
      f.caller.chatAccept({
        idempotencyKey: "changed",
        input: { prompt: "Hello" },
        quote: { ...quote, maximum: 1 },
      }),
    ).rejects.toThrow("rates changed");
    f.rates({ ...PRICEBOOK, version: "v2", creditNanoUsd: 1500000 });
    expect((await f.caller.chatQuote({ prompt: "Hello" })).maximum).toBe(
      1792000,
    );
    f.clock(2001);
    await f.ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "renewal",
      startsAt: 2000,
      endsAt: 3000,
      subcredits: 10000000,
      reason: "renewal",
      environment: "test",
    });
    await expect(
      f.caller.chatAccept({
        idempotencyKey: "old",
        input: { prompt: "Hello" },
        quote,
      }),
    ).rejects.toThrow("period");
    expect((await f.caller.chatQuote({ prompt: "Hello" })).maximum).toBe(
      3584000,
    );
    await f.ledger.revoke("owner", "alice", "revoked");
    await expect(f.caller.chatQuote({ prompt: "Hello" })).rejects.toThrow(
      "entitlement",
    );
  } finally {
    f.client.close();
  }
});
test("uncertain cancelled chat remains reserved and replay never repeats paid dispatch", async () => {
  let calls = 0;
  const f = await fixture(async (_text, _signal, context) => {
    calls++;
    context.onText?.("Partial ");
    return { kind: "unknown" };
  });
  try {
    const input = { prompt: "Hello" };
    const quote = await f.caller.chatQuote(input);
    const op = await f.caller.chatAccept({
      idempotencyKey: "turn",
      input,
      quote,
    });
    const route = createChatStreamRoute({
      authorize: async () => "alice",
      chat: () => f.chat,
      retain: () => {},
    });
    const response = await route(
      new Request("https://app.test/api/chat/stream", {
        method: "POST",
        body: JSON.stringify({ id: op.id, input }),
      }),
    );
    const body = await response.text();
    expect(body).toContain('"text":"Partial "');
    expect(body).toContain('"state":"unknown"');
    await f.caller.cancel({ id: op.id });
    await f.chat.stream("alice", op.id, input, () => {});
    expect(calls).toBe(1);
    expect((await f.ledger.status("alice")).reservedSubcredits).toBe(1792000);
    const denied = createChatStreamRoute({
      authorize: async () => null,
      chat: () => f.chat,
      retain: () => {},
    });
    expect(
      (
        await denied(
          new Request("https://app.test/api/chat/stream", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
  } finally {
    f.client.close();
  }
});
test("completed cancellation charges once, retries are our cost and old-period settlement stays on its accepted period", async () => {
  let calls = 0;
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(async (_text, _signal, context) => {
    calls++;
    if (calls === 1)
      return { kind: "failed", retryable: true, actualCostNanoUsd: 50 };
    await f.ledger.cancel("alice", context.operationId);
    f.clock(2001);
    return {
      kind: "completed",
      completion: {
        text: "Completed.",
        usage: { input: 100, cachedInput: 0, output: 4 },
        actualCostNanoUsd: 93000,
      },
    };
  });
  try {
    const input = { prompt: "Hi" };
    const quote = await f.caller.chatQuote(input);
    const op = await f.caller.chatAccept({
      idempotencyKey: "once",
      input,
      quote,
    });
    expect(await f.chat.stream("alice", op.id, input, () => {})).toMatchObject({
      state: "settled",
      charged: 31000,
      period_id: quote.periodId,
    });
    await f.chat.stream("alice", op.id, input, () => {});
    expect(calls).toBe(2);
    expect((await f.ledger.status("alice")).providerCosts.knownNanoUsd).toBe(
      93050,
    );
  } finally {
    f.client.close();
  }
});
test("closed production capability cannot reserve or dispatch chat", async () => {
  const f = await fixture(async () => {
    throw new Error("must not dispatch");
  }, false);
  try {
    expect((await f.caller.chatCapability()).available).toBe(false);
    await expect(f.caller.chatQuote({ prompt: "Hi" })).rejects.toThrow(
      "Coming soon",
    );
    expect((await f.ledger.status("alice")).reservedSubcredits).toBe(0);
  } finally {
    f.client.close();
  }
});

test("authenticated accepted chat keeps customer rates while a raised supplier contract selects and bounds dispatch", async () => {
  const { createProChatTransport } = await import("./chat-provider");
  let selected = "";
  const transport = createProChatTransport({
    authorize: async (scope) =>
      f.ledger.authorizeDispatch(
        scope.operationId,
        scope.attemptId,
        scope.accountId,
      ),
    resolveServerKey: () => "synthetic-only",
    fetch: async (request) => {
      selected = (await request.json()).model;
      return new Response(
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Done" })}\n\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "supplier-v2", status: "completed", usage: { input_tokens: 4096, input_tokens_details: { cached_tokens: 0 }, output_tokens: 512 } } })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const f = await fixture(transport);
  try {
    const quote = await f.caller.chatQuote({ prompt: "Hello" });
    const accepted = await f.caller.chatAccept({
      idempotencyKey: "supplier-raised",
      input: { prompt: "Hello" },
      quote,
    });
    Object.assign(f.ledger.config, {
      supplierBooks: () => ({
        verification: "test-injection",
        text: {
          ...PRICEBOOK,
          version: "supplier-v2",
          model: "synthetic-model-v2",
          inputNanoUsd: 1500,
          cachedInputNanoUsd: 150,
          outputNanoUsd: 9000,
        },
      }),
    });
    const op = await f.chat.stream(
      "alice",
      accepted.id,
      { prompt: "Hello" },
      () => {},
    );
    expect(op.state).toBe("settled");
    expect(op.charged).toBe(1792000);
    expect(selected).toBe("synthetic-model-v2");
    expect((await f.ledger.attempts("alice", op.id))[0]).toMatchObject({
      exposure_nano_usd: 10752000,
      cost_nano_usd: 10752000,
    });
  } finally {
    f.client.close();
  }
});

test("missing supplier invoice on a confirmed failure refunds credits and the failure circuit admits only bounded exposure", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { kind: "failed", retryable: false };
  });
  try {
    f.ledger.config.supplierBooks = () => ({
      verification: "test-injection",
      text: {
        ...PRICEBOOK,
        version: "costly-test",
        inputNanoUsd: 100000,
        cachedInputNanoUsd: 10000,
        outputNanoUsd: 100000,
      },
    });
    for (let i = 0; i < 3; i++) {
      const input = { prompt: "Hello" };
      const quote = await f.caller.chatQuote(input);
      const op = await f.caller.chatAccept({
        idempotencyKey: `failure-${i}`,
        input,
        quote,
      });
      expect((await f.chat.stream("alice", op.id, input, () => {})).state).toBe(
        "refunded",
      );
    }
    expect(calls).toBe(2);
    const status = await f.ledger.status("alice");
    expect(status.providerCosts).toMatchObject({
      knownNanoUsd: 0,
      unknownExposureNanoUsd: 921600000,
    });
    expect(status.availableSubcredits).toBe(10000000);
  } finally {
    f.client.close();
  }
});

test("a completed authenticated chat without an invoice retains supplier exposure while lower supplier rates leave customer billing unchanged", async () => {
  const f = await fixture(async (_text, _signal, scope) => {
    expect(scope.supplier?.maximumNanoUsd).toBe(2688000);
    return {
      kind: "completed",
      completion: {
        text: "Done",
        usage: { input: 4096, cachedInput: 0, output: 512 },
      },
    };
  });
  try {
    f.ledger.config.supplierBooks = () => ({
      verification: "test-injection",
      text: {
        ...PRICEBOOK,
        version: "lower",
        inputNanoUsd: 375,
        cachedInputNanoUsd: 37,
        outputNanoUsd: 2250,
      },
    });
    const input = { prompt: "Hello" };
    const quote = await f.caller.chatQuote(input);
    const op = await f.caller.chatAccept({
      idempotencyKey: "lower",
      input,
      quote,
    });
    expect(await f.chat.stream("alice", op.id, input, () => {})).toMatchObject({
      state: "settled",
      charged: 1792000,
    });
    expect((await f.ledger.status("alice")).providerCosts).toMatchObject({
      unknownExposureNanoUsd: 2688000,
    });
  } finally {
    f.client.close();
  }
});

test("a confirmed technical failure refunds even if its invoice evidence exceeds the admitted contract", async () => {
  const f = await fixture(async () => ({
    kind: "failed",
    retryable: false,
    actualCostNanoUsd: 100000000,
  }));
  try {
    const input = { prompt: "Hello" };
    const quote = await f.caller.chatQuote(input);
    const op = await f.caller.chatAccept({
      idempotencyKey: "invalid-invoice-failure",
      input,
      quote,
    });
    expect((await f.chat.stream("alice", op.id, input, () => {})).state).toBe(
      "refunded",
    );
    expect((await f.ledger.status("alice")).providerCosts).toMatchObject({
      knownNanoUsd: 0,
      unknownExposureNanoUsd: 5376000,
    });
  } finally {
    f.client.close();
  }
});

test("durable completion recovers its original supplier contract after the server supplier schedule changes", async () => {
  const f = await fixture(async () => {
    throw new Error("Recovery must not dispatch");
  });
  try {
    const input = { prompt: "Hello" };
    const quote = await f.caller.chatQuote(input);
    const op = await f.caller.chatAccept({
      idempotencyKey: "durable-contract",
      input,
      quote,
    });
    f.ledger.config.supplierBooks = () => ({
      verification: "test-injection",
      text: {
        ...PRICEBOOK,
        version: "supplier-v2",
        inputNanoUsd: 1500,
        cachedInputNanoUsd: 150,
        outputNanoUsd: 9000,
      },
    });
    await f.ledger.claim(op.id);
    const attempt = await f.ledger.startAttempt(op.id);
    await f.ledger.finishAttempt(attempt, {
      kind: "completed",
      completion: {
        text: "Done",
        usage: { input: 4096, cachedInput: 0, output: 512 },
        actualCostNanoUsd: 10752000,
      },
    });
    f.ledger.config.supplierBooks = supplierFixture;
    const reopened = new ProLedger(f.client, f.ledger.config);
    const recovered = await new ProTextOperation(reopened, async () => {
      throw new Error("No paid replay");
    }).recover("alice", op.id);
    expect(recovered).toMatchObject({ state: "settled", charged: 1792000 });
    expect(
      (await reopened.supplierContract("alice", op.id, attempt)).maximumNanoUsd,
    ).toBe(10752000);
  } finally {
    f.client.close();
  }
});

test("archived text attempt evidence remains recoverable without adopting the current supplier schedule", async () => {
  const f = await fixture(async () => {
    throw new Error("No paid replay");
  });
  try {
    const input = { prompt: "Hello" };
    const quote = await f.caller.chatQuote(input);
    const op = await f.caller.chatAccept({
      idempotencyKey: "archived",
      input,
      quote,
    });
    await f.ledger.claim(op.id);
    const completion = {
      text: "Done",
      usage: { input: 4096, cachedInput: 0, output: 512 },
      actualCostNanoUsd: 5376000,
    };
    await f.client.execute({
      sql: "INSERT INTO pro_attempts(id,operation_id,number,state,exposure_nano_usd,cost_nano_usd,usage,result,created_at) VALUES (?, ?,1,'completed',5376000,5376000,?,?,1000)",
      args: [
        "archived-attempt",
        op.id,
        JSON.stringify(completion.usage),
        JSON.stringify(completion),
      ],
    });
    f.ledger.config.supplierBooks = () => ({
      verification: "test-injection",
      text: {
        ...PRICEBOOK,
        version: "supplier-v2",
        inputNanoUsd: 1500,
        outputNanoUsd: 9000,
      },
    });
    expect(await f.chat.executor.recover("alice", op.id)).toMatchObject({
      state: "settled",
      charged: 1792000,
    });
    expect(
      (await f.ledger.supplierContract("alice", op.id, "archived-attempt"))
        .verification,
    ).toBe("archived-v1");
  } finally {
    f.client.close();
  }
});

test("legacy higher-rate chat recovery reconstructs its known dispatch bound instead of retaining the compiled v1 ceiling", async () => {
  const book = {
    ...PRICEBOOK,
    version: "legacy-higher",
    inputNanoUsd: 1500,
    cachedInputNanoUsd: 150,
    outputNanoUsd: 9000,
  };
  const f = await fixture(
    async () => {
      throw new Error("No paid replay");
    },
    true,
    book,
  );
  try {
    const input = { prompt: "Hello" };
    const quote = await f.caller.chatQuote(input);
    const op = await f.caller.chatAccept({
      idempotencyKey: "legacy-higher",
      input,
      quote,
    });
    await f.ledger.claim(op.id);
    const completion = {
      text: "Done",
      usage: { input: 4096, cachedInput: 0, output: 512 },
      actualCostNanoUsd: 10752000,
    };
    await f.client.execute({
      sql: "INSERT INTO pro_attempts(id,operation_id,number,state,exposure_nano_usd,cost_nano_usd,usage,result,created_at) VALUES (?, ?,1,'completed',5376000,10752000,?,?,1000)",
      args: [
        "legacy-higher-attempt",
        op.id,
        JSON.stringify(completion.usage),
        JSON.stringify(completion),
      ],
    });
    expect(await f.chat.executor.recover("alice", op.id)).toMatchObject({
      state: "settled",
      charged: 3584000,
    });
    await f.ledger.reconcileAttemptCost(
      "owner",
      "legacy-higher-attempt",
      10752000,
      "Verified synthetic historical invoice",
    );
    expect(
      (await f.ledger.attempts("alice", op.id))[0]?.exposure_nano_usd,
    ).toBe(10752000);
  } finally {
    f.client.close();
  }
});

function deferredProvider() {
  const encoder = new TextEncoder();
  let upstream: ReadableStreamDefaultController<Uint8Array> | undefined;
  let observed: AbortSignal | undefined;
  let requests = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      upstream = controller;
    },
  });
  return {
    requests: () => requests,
    aborted: () => observed?.aborted,
    send(event: unknown) {
      try {
        upstream?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      } catch {
        // The transport already cancelled its reader.
      }
    },
    end() {
      try {
        upstream?.close();
      } catch {
        // The transport already cancelled its reader.
      }
    },
    fetch: async (request: Request) => {
      requests++;
      observed = request.signal;
      return new Response(body, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  };
}
const delta = (text: string) => ({
  type: "response.output_text.delta",
  delta: text,
});
const completed = {
  type: "response.completed",
  response: {
    id: "detached",
    status: "completed",
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 4,
    },
  },
};
async function detachedStream() {
  const provider = deferredProvider();
  const retained: Promise<unknown>[] = [];
  const unhandled: unknown[] = [];
  const track = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", track);
  const { createProChatTransport } = await import("./chat-provider");
  let f: Awaited<ReturnType<typeof fixture>>;
  f = await fixture(
    createProChatTransport({
      authorize: async (scope) =>
        f.ledger.authorizeDispatch(
          scope.operationId,
          scope.attemptId,
          scope.accountId,
        ),
      resolveServerKey: () => "synthetic-only",
      fetch: provider.fetch,
    }),
  );
  const input = { prompt: "Hello" };
  const op = await f.caller.chatAccept({
    idempotencyKey: "detached",
    input,
    quote: await f.caller.chatQuote(input),
  });
  const route = createChatStreamRoute({
    authorize: async () => "alice",
    chat: () => f.chat,
    retain: (work) => {
      retained.push(work);
    },
  });
  const post = (signal?: AbortSignal) =>
    route(
      new Request("https://app.test/api/chat/stream", {
        method: "POST",
        signal,
        body: JSON.stringify({ id: op.id, input }),
      }),
    );
  const disconnect = new AbortController();
  const body = (await post(disconnect.signal)).body;
  if (!body) throw new Error("Stream response has no body");
  const subscriber = body.getReader();
  provider.send(delta("Hello "));
  expect(new TextDecoder().decode((await subscriber.read()).value)).toContain(
    '"text":"Hello "',
  );
  return {
    f,
    op,
    provider,
    post,
    async settled() {
      await Promise.all(retained);
      // The in-memory ledger has one connection, so poll through a busy transaction.
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const { state } = await f.ledger.operation("alice", op.id);
          if (state !== "reserved" && state !== "running") return;
        } catch {
          // Retry after the in-flight transaction ends.
        }
        await Bun.sleep(50);
      }
    },
    unhandled,
    async detach() {
      disconnect.abort();
      await subscriber.cancel();
    },
    finish() {
      process.off("unhandledRejection", track);
      f.client.close();
    },
  };
}
test("a subscriber that disconnects mid-stream is detached, not cancelled, so the provider completion settles and charges", async () => {
  const run = await detachedStream();
  try {
    await run.detach();
    run.provider.send(delta("world"));
    run.provider.send(completed);
    run.provider.end();
    await run.settled();
    expect(await run.f.ledger.operation("alice", run.op.id)).toMatchObject({
      state: "settled",
      cancel_requested: 0,
      result: "Hello world",
    });
    expect((await run.f.ledger.status("alice")).reservedSubcredits).toBe(0);
    expect(run.provider.aborted()).toBe(false);
    expect(run.unhandled).toEqual([]);
  } finally {
    run.finish();
  }
});
test("only the explicit cancel endpoint stops provider work after the subscriber detached", async () => {
  const run = await detachedStream();
  try {
    await run.detach();
    await Bun.sleep(400);
    expect(run.provider.aborted()).toBe(false);
    await run.f.caller.cancel({ id: run.op.id });
    await run.settled();
    expect(run.provider.aborted()).toBe(true);
    expect(await run.f.ledger.operation("alice", run.op.id)).toMatchObject({
      state: "unknown",
      cancel_requested: 1,
    });
  } finally {
    run.finish();
  }
});
test("a repeated stream request while a detached run is active never dispatches the provider again", async () => {
  const run = await detachedStream();
  try {
    await run.detach();
    const repeated = await (await run.post()).text();
    expect(repeated).toContain('"state":"running"');
    run.provider.send(delta("world"));
    run.provider.send(completed);
    run.provider.end();
    await run.settled();
    expect(run.provider.requests()).toBe(1);
    expect((await run.f.ledger.operation("alice", run.op.id)).state).toBe(
      "settled",
    );
  } finally {
    run.finish();
  }
});
test("a detached run whose provider outcome is uncertain stays reserved without an explicit cancellation", async () => {
  const run = await detachedStream();
  try {
    await run.detach();
    run.provider.end();
    await run.settled();
    expect(await run.f.ledger.operation("alice", run.op.id)).toMatchObject({
      state: "unknown",
      cancel_requested: 0,
    });
    expect((await run.f.ledger.status("alice")).reservedSubcredits).toBe(
      1792000,
    );
    await (await run.post()).text();
    expect(run.provider.requests()).toBe(1);
  } finally {
    run.finish();
  }
});

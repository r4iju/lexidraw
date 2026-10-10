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
async function fixture(transport: ProTransport, enabled = true) {
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
  let book: unknown = PRICEBOOK;
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
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

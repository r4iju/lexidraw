import { supplierFixture } from "~/test/supplier-fixture";
import { expect, mock, test } from "bun:test";
import { createClient } from "@libsql/client";
import { installServerRuntime } from "~/test/server-runtime";
import * as schema from "@packages/drizzle/drizzle-schema";
import { eq } from "drizzle-orm";
import { ProLedger } from "./ledger";
import { ProTextOperation } from "./operation";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { createProRouter } = await import("../api/routers/pro");

async function fixture(
  transport: ConstructorParameters<typeof ProTextOperation>[1],
  textAvailable = true,
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
        await Bun.file(`../../packages/drizzle/drizzle/${migration}`).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: () => 1000,
  });
  await ledger.grantEligibility("owner", "alice", "tester");
  await ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "trial",
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 10_000_000,
    reason: "trial",
    environment: "test",
  });
  const executor = new ProTextOperation(ledger, transport);
  const router = createProRouter({
    ledger: () => ledger,
    textAvailable,
    dispatch: (id, text, account) => executor.execute(account, id, text),
  });
  await db
    .insert(schema.users)
    .values({
      id: "alice",
      email: "alice-283@example.test",
      name: "Alice",
      config: { aiPower: { mode: "pro" }, autocomplete: { enabled: true } },
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: {
        config: { aiPower: { mode: "pro" }, autocomplete: { enabled: true } },
      },
    });
  const caller = router.createCaller({
    drizzle: db,
    schema: {},
    session: { user: { id: "alice" } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  return { caller, ledger, client };
}

test("trusted autocomplete charges fractional usage once and records its feature, never accepting provider secrets or billable settings", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return {
      kind: "completed",
      completion: {
        text: " continuation",
        usage: { input: 100, cachedInput: 0, output: 4 },
        actualCostNanoUsd: 93000,
      },
    };
  });
  const input = {
    idempotencyKey: "suggestion",
    title: "Title",
    before: "Hello",
    after: "",
  };
  try {
    const result = await f.caller.autocomplete(input);
    expect(result).toMatchObject({
      feature: "autocomplete",
      state: "settled",
      charged: 31_000,
      result: " continuation",
    });
    expect(await f.caller.autocomplete(input)).toMatchObject({
      id: result.id,
      charged: 31_000,
    });
    expect(calls).toBe(1);
    expect(await f.caller.status()).toMatchObject({
      availableSubcredits: 9_969_000,
      reservedSubcredits: 0,
      history: [{ feature: "autocomplete", charged: 31_000 }],
    });
    for (const injected of [
      { apiKey: "sk-or-v1-distinctive-test-secret" },
      { model: "arbitrary" },
      { maxOutputTokens: 10000 },
    ])
      await expect(
        f.caller.autocomplete({ ...input, ...injected } as never),
      ).rejects.toThrow();
  } finally {
    f.client.close();
  }
});

test("autocomplete respects persisted opt-in/source and refuses provider credentials in context before reservation", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { kind: "unknown" };
  });
  const input = {
    idempotencyKey: "blocked",
    title: "",
    before: "Hello",
    after: "",
  };
  try {
    await db
      .update(schema.users)
      .set({
        config: { aiPower: { mode: "local" }, autocomplete: { enabled: true } },
      })
      .where(eq(schema.users.id, "alice"));
    await expect(f.caller.autocomplete(input)).rejects.toThrow("Select Pro");
    await db
      .update(schema.users)
      .set({
        config: { aiPower: { mode: "pro" }, autocomplete: { enabled: false } },
      })
      .where(eq(schema.users.id, "alice"));
    await expect(f.caller.autocomplete(input)).rejects.toThrow("Opt in");
    await db
      .update(schema.users)
      .set({
        config: { aiPower: { mode: "pro" }, autocomplete: { enabled: true } },
      })
      .where(eq(schema.users.id, "alice"));
    await expect(
      f.caller.autocomplete({
        ...input,
        before: "sk-or-v1-distinctive-fixture-credential-283",
      }),
    ).rejects.toThrow("Credential");
    expect(calls).toBe(0);
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 10_000_000,
      reservedSubcredits: 0,
      history: [],
    });
  } finally {
    f.client.close();
  }
});

test("one unknown autocomplete stays reserved and rejects another attempt without a second provider call", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { kind: "unknown" };
  });
  try {
    const input = {
      idempotencyKey: "unknown",
      title: "",
      before: "Hello",
      after: "",
    };
    const operation = await f.caller.autocomplete(input);
    expect(operation.state).toBe("unknown");
    await expect(
      f.caller.autocomplete({ ...input, idempotencyKey: "next" }),
    ).rejects.toThrow();
    await f.caller.cancel({ id: operation.id });
    expect(await f.caller.status()).toMatchObject({
      reservedSubcredits: 1_120_000,
      availableSubcredits: 8_880_000,
    });
    expect(calls).toBe(1);
  } finally {
    f.client.close();
  }
});

test("autocomplete cancellation before the provider fence releases and credit depletion refuses new work", async () => {
  const f = await fixture(async () => {
    throw Error("unexpected provider call");
  });
  try {
    const operation = await f.ledger.reserve(
      "alice",
      "before-fence",
      "Hello",
      "autocomplete",
    );
    await f.ledger.cancel("alice", operation.id);
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 10_000_000,
      reservedSubcredits: 0,
    });
    await f.client.execute("UPDATE pro_periods SET available = 0");
    await expect(
      f.caller.autocomplete({
        idempotencyKey: "depleted",
        title: "",
        before: "Hello",
        after: "",
      }),
    ).rejects.toThrow();
    expect((await f.ledger.status("alice")).reservedSubcredits).toBe(0);
  } finally {
    f.client.close();
  }
});

test("stale Pro text requests cannot spend after the account selected a device source", async () => {
  let paid = 0;
  const f = await fixture(async () => {
    paid++;
    return { kind: "unknown" };
  });
  try {
    await db
      .update(schema.users)
      .set({ config: { aiPower: { mode: "local" } } })
      .where(eq(schema.users.id, "alice"));
    await expect(
      f.caller.text({ idempotencyKey: "stale", text: "hello" }),
    ).rejects.toThrow("Select Pro");
    expect(paid).toBe(0);
    expect((await f.ledger.status("alice")).reservedSubcredits).toBe(0);
  } finally {
    f.client.close();
  }
});

test("unverified production text capability refuses requests before reservations or provider dispatch", async () => {
  let paid = 0;
  const f = await fixture(async () => {
    paid++;
    return { kind: "unknown" };
  }, false);
  try {
    await expect(
      f.caller.text({ idempotencyKey: "closed", text: "hello" }),
    ).rejects.toThrow("Coming soon");
    await expect(
      f.caller.autocomplete({
        idempotencyKey: "closed-suggestion",
        title: "",
        before: "hello",
        after: "",
      }),
    ).rejects.toThrow("Coming soon");
    expect(paid).toBe(0);
    expect((await f.ledger.status("alice")).reservedSubcredits).toBe(0);
  } finally {
    f.client.close();
  }
});

test("authenticated text and autocomplete use the admitted supplier model and cost while customer rates remain on the period", async () => {
  const { PRICEBOOK } = await import("./contracts");
  const { createProProviderTransport } = await import("./provider");
  let selected = "";
  let outputCap = 0;
  const transport = createProProviderTransport({
    authorize: (scope) =>
      f.ledger.authorizeDispatch(
        scope.operationId,
        scope.attemptId,
        scope.accountId,
      ),
    resolveServerKey: () => "synthetic-key",
    fetch: async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      selected = body.model;
      outputCap = body.max_output_tokens;
      // A configuration update after dispatch cannot alter terminal validation.
      f.ledger.config.supplierBooks = supplierFixture;
      return Response.json({
        id: "supplier-result",
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
              { type: "output_text", text: "Hello world", annotations: [] },
            ],
          },
        ],
        usage: {
          input_tokens: 4096,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: outputCap,
          total_tokens: 4096 + outputCap,
        },
      });
    },
  });
  const f = await fixture(transport);
  try {
    for (const feature of ["text", "autocomplete"] as const) {
      f.ledger.config.supplierBooks = () => ({
        verification: "test-injection",
        text: {
          ...PRICEBOOK,
          version: "supplier-v2",
          model: "synthetic-text-v2",
          inputNanoUsd: 1500,
          cachedInputNanoUsd: 150,
          outputNanoUsd: 9000,
        },
      });
      const result =
        feature === "text"
          ? await f.caller.text({
              idempotencyKey: "raised-text",
              text: "Hello",
            })
          : await f.caller.autocomplete({
              idempotencyKey: "raised-auto",
              title: "Title",
              before: "Hello",
              after: "",
            });
      expect(result).toMatchObject({
        state: "settled",
        charged: feature === "text" ? 1792000 : 1120000,
      });
      expect(selected).toBe("synthetic-text-v2");
      expect(outputCap).toBe(feature === "text" ? 512 : 64);
      expect((await f.ledger.attempts("alice", result.id))[0]).toMatchObject({
        exposure_nano_usd: feature === "text" ? 10752000 : 6720000,
        cost_nano_usd: feature === "text" ? 10752000 : 6720000,
      });
    }
  } finally {
    f.client.close();
  }
});

test("owned suggestion recovery survives opt-out, source change and closed capability without new dispatch or reservation", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    return { kind: "unknown" };
  });
  const input = {
    idempotencyKey: "issued",
    title: "",
    before: "Hello",
    after: "",
  };
  try {
    const accepted = await f.caller.autocomplete(input);
    await db
      .update(schema.users)
      .set({
        config: {
          aiPower: { mode: "local" },
          autocomplete: { enabled: false },
        },
      })
      .where(eq(schema.users.id, "alice"));
    await f.ledger.revoke("owner", "alice", "Generation access closed");
    const closed = createProRouter({
      ledger: () => f.ledger,
      textAvailable: false,
      dispatch: async () => {
        throw Error("Recovery cannot dispatch");
      },
    });
    const context = {
      drizzle: db,
      schema: {},
      session: { user: { id: "alice" } },
      auth: { kind: "session" },
      headers: new Headers(),
    };
    const reader = closed.createCaller(context as never);
    expect(await reader.autocompleteRecovery(input)).toMatchObject({
      id: accepted.id,
      state: "unknown",
    });
    await expect(reader.autocomplete(input)).rejects.toThrow("Coming soon");
    for (const bad of [
      { ...input, before: "Changed" },
      { ...input, idempotencyKey: "new" },
      { ...input, accountId: "alice" },
      { ...input, before: "sk-or-v1-distinctive-test-secret" },
    ])
      await expect(reader.autocompleteRecovery(bad)).rejects.toThrow();
    const foreign = closed.createCaller({
      ...context,
      session: { user: { id: "foreign" } },
    } as never);
    await expect(foreign.autocompleteRecovery(input)).rejects.toThrow();
    expect((await reader.status()).reservedSubcredits).toBe(1120000);
    expect(calls).toBe(1);
  } finally {
    f.client.close();
  }
});

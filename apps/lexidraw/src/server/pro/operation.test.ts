import { supplierFixture } from "~/test/supplier-fixture";
import { expect, test, mock } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installServerRuntime } from "~/test/server-runtime";
import { ProLedger } from "./ledger";
mock.module("@packages/env", () => ({
  default: new Proxy(
    { NODE_ENV: "test" },
    {
      get: (_target, key) =>
        key === "NODE_ENV" ? "test" : "https://example.test",
    },
  ),
}));
const db = await installServerRuntime();
const schema = await import("@packages/drizzle/drizzle-schema");
await db
  .insert(schema.users)
  .values({
    id: "alice",
    name: "Alice",
    email: "alice-291@example.test",
    config: { aiPower: { mode: "pro" } },
  })
  .onConflictDoUpdate({
    target: schema.users.id,
    set: { config: { aiPower: { mode: "pro" } } },
  });
const { createProRouter } = await import("../api/routers/pro");
const { ProTextOperation } = await import("./operation");

test("authenticated text requires separate private eligibility and entitlement; deterministic provider runs only after durable reservation", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    (
      (await Bun.file(
        "../../packages/drizzle/drizzle/0015_private_pro.sql",
      ).text()) +
      "\n--> statement-breakpoint\n" +
      (await Bun.file(
        "../../packages/drizzle/drizzle/0016_pro_billing_events.sql",
      ).text()) +
      "\n--> statement-breakpoint\n" +
      (await Bun.file(
        "../../packages/drizzle/drizzle/0029_sandbox_billing.sql",
      ).text())
    ).replaceAll("--> statement-breakpoint", ""),
  );
  await client.executeMultiple(
    (
      await Bun.file(
        "../../packages/drizzle/drizzle/0030_apple_sandbox.sql",
      ).text()
    ).replaceAll("--> statement-breakpoint", ""),
  );
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: () => 1000,
  });
  let calls = 0;
  const operation = new ProTextOperation(ledger, async () => {
    calls++;
    expect(await ledger.status("alice")).toMatchObject({
      reservedSubcredits: 1_792_000,
    });
    return {
      kind: "completed",
      completion: {
        text: "result",
        usage: { input: 1, cachedInput: 0, output: 1 },
        actualCostNanoUsd: 5250,
      },
    };
  });
  const router = createProRouter({
    ledger: () => ledger,
    dispatch: (id, text) => operation.execute("alice", id, text),
  });
  const caller = (id: string | null) =>
    router.createCaller({
      drizzle: db,
      schema: {},
      session: id
        ? { user: { id, role: "admin", email: "owner@example.test" } }
        : null,
      auth: { kind: "session" },
      headers: new Headers(),
    } as never);
  try {
    await expect(
      caller(null).text({ idempotencyKey: "x", text: "hello" }),
    ).rejects.toThrow();
    await expect(
      caller("alice").text({ idempotencyKey: "x", text: "hello" }),
    ).rejects.toThrow("Private entitlement required");
    await ledger.grantEligibility("owner", "alice", "tester");
    await expect(
      caller("alice").text({ idempotencyKey: "x", text: "hello" }),
    ).rejects.toThrow("Private entitlement required");
    expect(calls).toBe(0);
    await ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "trial",
      startsAt: 1000,
      endsAt: 2000,
      subcredits: 1_000_000_000,
      reason: "trial",
      environment: "test",
    });
    await expect(
      caller("alice").text({ idempotencyKey: "large", text: "😀".repeat(376) }),
    ).rejects.toThrow("Text exceeds bounded input");
    const result = await caller("alice").text({
      idempotencyKey: "x",
      text: "hello",
    });
    expect(result).toMatchObject({
      state: "settled",
      charged: 1750,
      result: "result",
    });
    expect(
      await caller("alice").text({ idempotencyKey: "x", text: "hello" }),
    ).toMatchObject({ id: result.id, charged: 1750 });
    await expect(
      caller("alice").text({ idempotencyKey: "x", text: "changed" }),
    ).rejects.toThrow("Idempotency key conflicts");
    await expect(
      caller("alice").text({
        idempotencyKey: "y",
        text: "hello",
        apiKey: "unexpected",
      } as never),
    ).rejects.toThrow();
    expect(calls).toBe(1);
    expect(await caller("alice").status()).toMatchObject({
      availableSubcredits: 999_998_250,
      liveCheckout: false,
    });
  } finally {
    client.close();
  }
});

async function operationFixture(
  transport: import("./operation").ProTransport,
  client: Client = createClient({ url: ":memory:" }),
) {
  await client.executeMultiple(
    (
      (await Bun.file(
        "../../packages/drizzle/drizzle/0015_private_pro.sql",
      ).text()) +
      "\n--> statement-breakpoint\n" +
      (await Bun.file(
        "../../packages/drizzle/drizzle/0016_pro_billing_events.sql",
      ).text()) +
      "\n--> statement-breakpoint\n" +
      (await Bun.file(
        "../../packages/drizzle/drizzle/0029_sandbox_billing.sql",
      ).text())
    ).replaceAll("--> statement-breakpoint", ""),
  );
  await client.executeMultiple(
    (
      await Bun.file(
        "../../packages/drizzle/drizzle/0030_apple_sandbox.sql",
      ).text()
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
    subcredits: 1_000_000_000,
    reason: "trial",
    environment: "test",
  });
  return { client, ledger, executor: new ProTextOperation(ledger, transport) };
}
test("restart after confirmed failed attempt refunds without another provider call; unfinished attempt remains reserved", async () => {
  const f = await operationFixture(async () => {
    throw new Error("unexpected provider dispatch");
  });
  try {
    const failed = await f.ledger.reserve("alice", "failed", "hash");
    await f.ledger.claim(failed.id);
    const attempt = await f.ledger.startAttempt(failed.id);
    await f.ledger.finishAttempt(attempt, {
      kind: "failed",
      actualCostNanoUsd: 500,
    });
    expect(await f.executor.execute("alice", failed.id, "text")).toMatchObject({
      state: "refunded",
      charged: 0,
    });
    const unknown = await f.ledger.reserve("alice", "unfinished", "hash2");
    await f.ledger.claim(unknown.id);
    await f.ledger.startAttempt(unknown.id);
    expect(await f.executor.execute("alice", unknown.id, "text")).toMatchObject(
      { state: "running", charged: 0 },
    );
    expect(await f.ledger.status("alice")).toMatchObject({
      reservedSubcredits: 1_792_000,
    });
  } finally {
    f.client.close();
  }
});

test("absorbed retry costs stay separate from fractional customer credits; refunded failures trip an account-wide circuit", async () => {
  let calls = 0;
  const f = await operationFixture(async () => {
    calls++;
    if (calls === 2)
      return {
        kind: "completed",
        completion: {
          text: "done",
          usage: { input: 1, cachedInput: 1, output: 1 },
          actualCostNanoUsd: 4575,
        },
      };
    return { kind: "failed", retryable: true, actualCostNanoUsd: 100 };
  });
  try {
    const first = await f.ledger.reserve("alice", "first", "h");
    expect(await f.executor.execute("alice", first.id, "text")).toMatchObject({
      state: "settled",
      charged: 1525,
    });
    for (let i = 0; i < 3; i++) {
      const op = await f.ledger.reserve("alice", `failed-${i}`, `h${i}`);
      expect(await f.executor.execute("alice", op.id, "text")).toMatchObject({
        state: "refunded",
        charged: 0,
      });
    }
    expect(calls).toBe(6);
    expect(await f.ledger.status("alice")).toMatchObject({
      availableSubcredits: 999_998_475,
      reservedSubcredits: 0,
      providerCosts: { knownNanoUsd: 5075, unknownExposureNanoUsd: 0 },
    });
  } finally {
    f.client.close();
  }
});

test("duplicate concurrent dispatch, explicit cancellation and disconnect uncertainty never reissue a paid attempt", async () => {
  let resolve:
    | ((value: import("./operation").ProviderOutcome) => void)
    | undefined;
  let calls = 0;
  const f = await operationFixture(async (_text, signal) => {
    calls++;
    return new Promise((done) => {
      resolve = done;
      signal.addEventListener("abort", () => done({ kind: "unknown" }), {
        once: true,
      });
    });
  });
  try {
    const op = await f.ledger.reserve("alice", "same", "h");
    const started = f.executor.execute("alice", op.id, "text");
    while (!resolve) await new Promise((done) => setTimeout(done, 1));
    expect(await f.executor.execute("alice", op.id, "text")).toMatchObject({
      state: "running",
    });
    await f.ledger.cancel("alice", op.id);
    expect(await started).toMatchObject({ state: "unknown", charged: 0 });
    expect(calls).toBe(1);
    expect(await f.executor.execute("alice", op.id, "text")).toMatchObject({
      state: "unknown",
    });
    expect(await f.ledger.status("alice")).toMatchObject({
      reservedSubcredits: 1_792_000,
      providerCosts: { knownNanoUsd: 0, unknownExposureNanoUsd: 5_376_000 },
    });
  } finally {
    f.client.close();
  }
});

test("Pro preference is non-secret and gated by durable private eligibility, never client admin claims", async () => {
  const { authRouter } = await import("../api/routers/auth");
  const schema = await import("@packages/drizzle/drizzle-schema");
  await db.insert(schema.users).values({
    id: "pro_preference_test",
    name: "Tester",
    email: "pro-pref@example.test",
  });
  const caller = authRouter.createCaller({
    drizzle: db,
    schema,
    session: { user: { id: "pro_preference_test", role: "admin" } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  await expect(
    caller.setPowerPreference({ mode: "pro" } as never),
  ).rejects.toThrow("Private eligibility required");
  await db
    .insert(schema.proEligibility)
    .values({ accountId: "pro_preference_test", active: 1 });
  await caller.setPowerPreference({ mode: "pro" } as never);
  expect(await caller.getPowerPreference()).toEqual({ mode: "pro" });
  await expect(
    caller.setPowerPreference({ mode: "pro", key: "unexpected" } as never),
  ).rejects.toThrow();
});

test("restart between reservation claim and attempt fence resumes safely; persisted completion settles without provider replay", async () => {
  let calls = 0;
  const f = await operationFixture(async () => {
    calls++;
    return {
      kind: "completed",
      completion: {
        text: "durable",
        usage: { input: 1, cachedInput: 0, output: 1 },
        actualCostNanoUsd: 5250,
      },
    };
  });
  try {
    const before = await f.ledger.reserve("alice", "before-fence", "h");
    await f.ledger.claim(before.id);
    expect(await f.executor.execute("alice", before.id, "text")).toMatchObject({
      state: "settled",
      result: "durable",
    });
    const after = await f.ledger.reserve("alice", "after-completion", "h2");
    await f.ledger.claim(after.id);
    const attempt = await f.ledger.startAttempt(after.id);
    await f.ledger.finishAttempt(attempt, {
      kind: "completed",
      completion: {
        text: "persisted",
        usage: { input: 1, cachedInput: 0, output: 1 },
        actualCostNanoUsd: 5250,
      },
    });
    expect(await f.executor.execute("alice", after.id, "text")).toMatchObject({
      state: "settled",
      result: "persisted",
    });
    expect(calls).toBe(1);
  } finally {
    f.client.close();
  }
});

function gate() {
  let open = () => {};
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { ready, open };
}

test("authenticated duplicate execution charges persisted completion once even when the losing fence returns before winner settlement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pro-completion-race-"));
  const storage = createClient({ url: `file:${join(directory, "ledger.db")}` });
  const claimed = gate();
  const completed = gate();
  const releaseLoser = gate();
  const releaseWinner = gate();
  let claims = 0;
  let afterClaims = 0;
  // Pause storage acknowledgements/acquisition after real SQLite commits.
  // Both claims precede the fence. The losing fence runs after completion
  // while the winner waits for its completion acknowledgement.
  const scheduled = new Proxy(storage, {
    get(target, key) {
      if (key !== "transaction") {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: Parameters<Client["transaction"]>) => {
        if (claims === 2 && ++afterClaims === 2) {
          await completed.ready;
          await releaseLoser.ready;
        }
        const tx = await target.transaction(...args);
        let isClaim = false;
        let isCompletion = false;
        return new Proxy(tx, {
          get(transaction, method) {
            if (method === "execute")
              return async (statement: Parameters<typeof tx.execute>[0]) => {
                const sql =
                  typeof statement === "string" ? statement : statement.sql;
                isClaim ||= sql.startsWith(
                  "UPDATE pro_operations SET state='running'",
                );
                isCompletion ||= sql.startsWith(
                  "UPDATE pro_attempts SET state=?,cost_nano_usd=",
                );
                return transaction.execute(statement);
              };
            if (method === "commit")
              return async () => {
                await transaction.commit();
                if (isClaim) {
                  if (++claims === 2) claimed.open();
                  await claimed.ready;
                }
                if (isCompletion) {
                  completed.open();
                  await releaseWinner.ready;
                }
              };
            const value = Reflect.get(transaction, method);
            return typeof value === "function"
              ? value.bind(transaction)
              : value;
          },
        });
      };
    },
  });
  let calls = 0;
  const f = await operationFixture(async () => {
    calls++;
    return {
      kind: "completed",
      completion: {
        text: "durable result",
        usage: { input: 1, cachedInput: 0, output: 1 },
        actualCostNanoUsd: 5250,
      },
    };
  }, scheduled);
  const caller = createProRouter({
    ledger: () => f.ledger,
    dispatch: (id, text, account) => f.executor.execute(account, id, text),
  }).createCaller({
    drizzle: db,
    schema: {},
    session: { user: { id: "alice" } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  const executions = [
    caller.text({ idempotencyKey: "duplicate", text: "hello" }),
    caller.text({ idempotencyKey: "duplicate", text: "hello" }),
  ];
  try {
    await completed.ready;
    expect(await caller.status()).toMatchObject({
      reservedSubcredits: 1_792_000,
      availableSubcredits: 998_208_000,
      history: [{ state: "running", charged: 0 }],
    });
    releaseLoser.open();
    const duplicate = await Promise.race(executions);
    expect(duplicate).toMatchObject({
      state: "settled",
      charged: 1750,
      result: "durable result",
    });
    expect(await caller.status()).toMatchObject({
      reservedSubcredits: 0,
      availableSubcredits: 999_998_250,
      history: [{ id: duplicate.id, state: "settled", charged: 1750 }],
    });
    releaseWinner.open();
    expect(await Promise.all(executions)).toEqual([duplicate, duplicate]);
    const reopened = createClient({
      url: `file:${join(directory, "ledger.db")}`,
    });
    try {
      const recovery = new ProTextOperation(
        new ProLedger(reopened, f.ledger.config),
        async () => {
          throw new Error("Recovery must not dispatch");
        },
      );
      expect(await recovery.execute("alice", duplicate.id, "hello")).toEqual(
        duplicate,
      );
      expect(await recovery.ledger.status("alice")).toEqual(
        await caller.status(),
      );
    } finally {
      reopened.close();
    }
    expect(
      await caller.text({ idempotencyKey: "duplicate", text: "hello" }),
    ).toEqual(duplicate);
    expect(calls).toBe(1);
    expect(
      (await f.ledger.entries("alice")).map((entry) => [
        entry.kind,
        entry.subcredits,
      ]),
    ).toEqual([
      ["grant", 1_000_000_000],
      ["reservation", 1_792_000],
      ["release", 1_792_000],
      ["debit", 1750],
    ]);
  } finally {
    releaseLoser.open();
    releaseWinner.open();
    await Promise.allSettled(executions);
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);

test("authenticated replay releases cancellation after claim but before a paid attempt, including revoked queued work", async () => {
  let calls = 0;
  const f = await operationFixture(async () => {
    calls++;
    throw new Error("Cancelled work must not dispatch");
  });
  const router = createProRouter({
    ledger: () => f.ledger,
    dispatch: (id, text, account) => f.executor.execute(account, id, text),
  });
  const caller = router.createCaller({
    drizzle: db,
    schema: {},
    session: { user: { id: "alice" } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  try {
    const { hash } = (await import("./operation")).inputIdentity({
      idempotencyKey: "before-cancel",
      text: "hello",
    });
    const op = await f.ledger.reserve("alice", "before-cancel", hash);
    await f.ledger.claim(op.id);
    expect(await caller.cancel({ id: op.id })).toMatchObject({
      state: "running",
      cancel_requested: 1,
    });
    expect(
      await caller.text({ idempotencyKey: "before-cancel", text: "hello" }),
    ).toMatchObject({
      id: op.id,
      state: "cancelled",
      charged: 0,
    });
    const queued = await f.ledger.reserve("alice", "revoked", hash);
    await f.ledger.revoke("owner", "alice", "end trial before dispatch");
    expect(await f.executor.execute("alice", queued.id, "hello")).toMatchObject(
      {
        state: "cancelled",
        charged: 0,
      },
    );
    expect(await f.executor.execute("alice", op.id, "hello")).toMatchObject({
      state: "cancelled",
      charged: 0,
    });
    expect(await caller.status()).toMatchObject({
      reservedSubcredits: 0,
      availableSubcredits: 1_000_000_000,
      history: [
        { state: "cancelled", charged: 0 },
        { state: "cancelled", charged: 0 },
      ],
    });
    expect(
      (await f.ledger.entries("alice")).map((entry) => entry.kind),
    ).toEqual([
      "grant",
      "reservation",
      "release",
      "cancellation",
      "reservation",
      "release",
      "cancellation",
    ]);
    expect(calls).toBe(0);
  } finally {
    f.client.close();
  }
});

test("published text and autocomplete maxima match the period book across an update and renewal", async () => {
  const { PRICEBOOK } = await import("./contracts");
  const client = createClient({ url: ":memory:" });
  for (const name of [
    "0015_private_pro",
    "0016_pro_billing_events",
    "0029_sandbox_billing",
    "0030_apple_sandbox",
  ])
    await client.executeMultiple(
      (
        await Bun.file(`../../packages/drizzle/drizzle/${name}.sql`).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  let now = 1000;
  let book = {
    ...PRICEBOOK,
    version: String(PRICEBOOK.version),
    creditNanoUsd: Number(PRICEBOOK.creditNanoUsd),
  };
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: () => now,
    textBook: () => book,
  });
  const action = new ProTextOperation(ledger, async () => ({
    kind: "completed",
    completion: {
      text: "done",
      usage: { input: 1, cachedInput: 0, output: 1 },
      actualCostNanoUsd: 5250,
    },
  }));
  const caller = createProRouter({
    ledger: () => ledger,
    dispatch: (id, text, account) => action.execute(account, id, text),
  }).createCaller({
    drizzle: db,
    schema: {},
    session: { user: { id: "alice" } },
    auth: { kind: "session" },
    headers: new Headers(),
  } as never);
  const grant = (start: number) =>
    ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: `text-${start}`,
      startsAt: start,
      endsAt: start + 1000,
      subcredits: 1_000_000_000,
      reason: "fixture",
      environment: "test",
    });
  try {
    await ledger.grantEligibility("owner", "alice", "tester");
    await grant(1000);
    book = { ...book, version: "synthetic-text-v2", creditNanoUsd: 1_500_000 };
    expect((await caller.status()).policy.disclosure).toContain(
      "Text reserves at most 1.792 credits",
    );
    expect(
      await caller.text({ idempotencyKey: "old-period", text: "hello" }),
    ).toMatchObject({ quote: 1_792_000, charged: 1750 });
    now = 2000;
    await grant(2000);
    const status = await caller.status();
    expect(status.autocompleteMaximumSubcredits).toBe(2_240_000);
    expect(status.textMaximumSubcredits).toBe(3_584_000);
    expect(status.policy.disclosure).toContain(
      "Text reserves at most 3.584 credits",
    );
    expect(status.policy.disclosure).toContain(
      "suggestion reserves at most 2.240 credits",
    );
    expect(
      await caller.text({ idempotencyKey: "new-period", text: "hello" }),
    ).toMatchObject({ quote: 3_584_000, charged: 3500 });
    expect(await caller.status()).toMatchObject({
      availableSubcredits: 999_996_500,
      providerCosts: { knownNanoUsd: 10500 },
    });
    now = 3000;
    book = { ...book, version: "synthetic-text-v3", creditNanoUsd: 6_000_000 };
    await grant(3000);
    expect(await caller.status()).toMatchObject({
      autocompleteMaximumSubcredits: 560_000,
      textMaximumSubcredits: 896_000,
    });
    now = 4000;
    expect(await caller.status()).toMatchObject({
      entitlementPeriodId: null,
      autocompleteMaximumSubcredits: null,
      textMaximumSubcredits: null,
    });
  } finally {
    client.close();
  }
});

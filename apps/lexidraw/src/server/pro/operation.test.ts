import { expect, test, mock } from "bun:test";
import { createClient } from "@libsql/client";
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
      ).text())
    ).replaceAll("--> statement-breakpoint", ""),
  );
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
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

async function operationFixture(transport: import("./operation").ProTransport) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    (
      (await Bun.file(
        "../../packages/drizzle/drizzle/0015_private_pro.sql",
      ).text()) +
      "\n--> statement-breakpoint\n" +
      (await Bun.file(
        "../../packages/drizzle/drizzle/0016_pro_billing_events.sql",
      ).text())
    ).replaceAll("--> statement-breakpoint", ""),
  );
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
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

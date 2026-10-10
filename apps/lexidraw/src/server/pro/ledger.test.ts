import { afterEach, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProLedger } from "./ledger";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pro-ledger-"));
  const url = `file:${join(dir, "db.sqlite")}`;
  const clients: Client[] = [];
  const open = () => {
    const client = createClient({ url });
    clients.push(client);
    return client;
  };
  const client = open();
  const sql =
    (await Bun.file(
      "../../packages/drizzle/drizzle/0015_private_pro.sql",
    ).text()) +
    "\n--> statement-breakpoint\n" +
    ((await Bun.file(
      "../../packages/drizzle/drizzle/0016_pro_billing_events.sql",
    ).text()) +
      "\n--> statement-breakpoint\n" +
      (await Bun.file(
        "../../packages/drizzle/drizzle/0029_sandbox_billing.sql",
      ).text()));
  for (const statement of sql.split("--> statement-breakpoint"))
    if (statement.trim()) await client.execute(statement);
  let now = 1000;
  const ledger = () =>
    new ProLedger(open(), { ownerAccountIds: ["owner"], now: () => now });
  cleanups.push(async () => {
    for (const c of clients) c.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    ledger: ledger(),
    reopen: ledger,
    clock: (value: number) => {
      now = value;
    },
  };
}

test("private eligibility and a bounded test period survive reopening; neither public nor admin claims grant access", async () => {
  const f = await fixture();
  await expect(
    f.ledger.grantEligibility("admin", "alice", "approval"),
  ).rejects.toThrow("Owner authorization required");
  await f.ledger.grantEligibility("owner", "alice", "approved private tester");
  expect(await f.reopen().status("alice")).toMatchObject({
    eligible: true,
    entitled: false,
    publicState: "coming_soon",
    liveCheckout: false,
  });
  await f.ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "trial-1",
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 1_000_000_000,
    reason: "one bounded trial",
    environment: "test",
  });
  expect(await f.reopen().status("alice")).toMatchObject({
    entitled: true,
    availableSubcredits: 1_000_000_000,
    reservedSubcredits: 0,
    renewalAt: 2000,
  });
  expect((await f.reopen().audit("owner")).map((x) => x.action)).toEqual([
    "eligibility_granted",
    "period_granted",
  ]);
});

async function entitled(subcredits = 1_000_000_000) {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "first",
    startsAt: 1000,
    endsAt: 2000,
    subcredits,
    reason: "test period",
    environment: "test",
  });
  return f;
}
test("two devices race near zero: one persistent reservation wins, duplicate keys do not reserve again, settlement is exact once", async () => {
  const f = await entitled(1_792_000);
  const results = await Promise.allSettled([
    f.ledger.reserve("alice", "a", "hash-a"),
    f.reopen().reserve("alice", "b", "hash-b"),
  ]);
  const winners = results.filter((x) => x.status === "fulfilled");
  expect(winners).toHaveLength(1);
  const loser = results.find((x) => x.status === "rejected");
  if (loser?.status === "rejected")
    expect(loser.reason.message).toContain("Insufficient credits");
  const winner = winners[0];
  if (winner?.status !== "fulfilled") throw new Error("missing winner");
  const operation = winner.value;
  expect(
    (
      await f
        .reopen()
        .reserve("alice", operation.idempotency_key, operation.input_hash)
    ).id,
  ).toBe(operation.id);
  expect(await f.reopen().status("alice")).toMatchObject({
    availableSubcredits: 0,
    reservedSubcredits: 1_792_000,
  });
  await f.ledger.settle(operation.id, {
    kind: "completed",
    text: "done",
    usage: { input: 1, cachedInput: 0, output: 1 },
  });
  await f.reopen().settle(operation.id, {
    kind: "completed",
    text: "done",
    usage: { input: 1, cachedInput: 0, output: 1 },
  });
  expect(await f.reopen().status("alice")).toMatchObject({
    availableSubcredits: 1_790_250,
    reservedSubcredits: 0,
  });
  expect((await f.reopen().entries("alice")).map((x) => x.kind)).toEqual([
    "grant",
    "reservation",
    "release",
    "debit",
  ]);
});

test("unknown provider work stays reserved across restart; owner reconciliation is audited and old-period completion cannot spend the renewal", async () => {
  const f = await entitled();
  const op = await f.ledger.reserve("alice", "old", "old-hash");
  expect(await f.ledger.claim(op.id)).toBe(true);
  const attempt = await f.ledger.startAttempt(op.id);
  await f.ledger.finishAttempt(attempt, { kind: "unknown" });
  f.clock(2000);
  await f.ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "renewal",
    startsAt: 2000,
    endsAt: 3000,
    subcredits: 1_000_000_000,
    reason: "renewal test",
    environment: "test",
  });
  expect((await f.reopen().operation("alice", op.id)).state).toBe("unknown");
  await expect(
    f.ledger.reconcile(
      "admin",
      op.id,
      { kind: "technical_failure" },
      "confirmed failed",
    ),
  ).rejects.toThrow("Owner authorization required");
  await f.reopen().reconcile(
    "owner",
    op.id,
    {
      kind: "completed",
      text: "recovered",
      usage: { input: 1, cachedInput: 1, output: 0 },
    },
    "provider record confirms completion",
  );
  expect(await f.reopen().status("alice")).toMatchObject({
    availableSubcredits: 1_000_000_000,
    reservedSubcredits: 0,
  });
  expect((await f.reopen().operation("alice", op.id)).charged).toBe(25);
  expect((await f.reopen().audit("owner")).at(-1)?.action).toBe(
    "operation_reconciled",
  );
});

test("revocation stops new paid steps but keeps outstanding accounting; cancellation before dispatch releases, running work needs evidence", async () => {
  const f = await entitled();
  const running = await f.ledger.reserve("alice", "running", "h1");
  await f.ledger.claim(running.id);
  await f.ledger.startAttempt(running.id);
  const queued = await f.ledger.reserve("alice", "queued", "h2");
  await f.ledger.cancel("alice", queued.id);
  expect((await f.reopen().operation("alice", queued.id)).state).toBe(
    "cancelled",
  );
  await f.ledger.cancel("alice", running.id);
  expect((await f.reopen().operation("alice", running.id)).state).toBe(
    "running",
  );
  await f.ledger.revoke("owner", "alice", "trial ended");
  await expect(f.ledger.reserve("alice", "new", "h3")).rejects.toThrow(
    "Private entitlement required",
  );
  await expect(f.ledger.startAttempt(running.id)).rejects.toThrow();
  expect(await f.reopen().status("alice")).toMatchObject({
    entitled: false,
    reservedSubcredits: 1_792_000,
  });
});

test("grant events are replay-safe, account-bound and cannot add a second allowance or live entitlement", async () => {
  const f = await entitled();
  const grant = {
    accountId: "alice",
    eventId: "first",
    startsAt: 1000,
    endsAt: 2000,
    subcredits: 1_000_000_000,
    reason: "replay",
    environment: "test" as const,
  };
  await f.ledger.grantPeriod("owner", grant);
  await f.ledger.grantEligibility("owner", "bob", "tester");
  await expect(
    f.ledger.grantPeriod("owner", { ...grant, accountId: "bob" }),
  ).rejects.toThrow("Billing event conflicts");
  await expect(
    f.ledger.grantPeriod("owner", { ...grant, eventId: "topup" }),
  ).rejects.toThrow("no top-ups");
  await expect(
    f.ledger.grantPeriod("owner", {
      ...grant,
      eventId: "live",
      environment: "live" as never,
    }),
  ).rejects.toThrow();
  expect(
    (await f.ledger.entries("alice")).filter((x) => x.kind === "grant"),
  ).toHaveLength(1);
});

test("only verified sandbox events reach the same allowance contract; cross-channel duplicates do not create a second grant", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  const event = {
    accountId: "alice",
    eventId: "sandbox-1",
    startsAt: 1000,
    endsAt: 2000,
    environment: "sandbox",
    source: "stripe",
  };
  await expect(
    f.ledger.consumePurchase({}, async () => ({
      ...event,
      environment: "live",
    })),
  ).rejects.toThrow("Sandbox verification required");
  await f.ledger.consumePurchase({}, async () => event);
  await f.ledger.consumePurchase({}, async () => ({
    ...event,
    eventId: "store-1",
    source: "apple",
  }));
  await f.ledger.consumePurchase({}, async () => event);
  expect(
    (await f.reopen().entries("alice")).filter((x) => x.kind === "grant"),
  ).toHaveLength(1);
  expect(await f.reopen().status("alice")).toMatchObject({
    availableSubcredits: 1_000_000_000,
    paymentEnvironment: "disabled",
  });
});

test("provider invoice reconciliation is owner-audited and does not rewrite customer credit settlement", async () => {
  const f = await entitled();
  const op = await f.ledger.reserve("alice", "invoice", "h");
  await f.ledger.claim(op.id);
  const attempt = await f.ledger.startAttempt(op.id);
  await f.ledger.finishAttempt(attempt, { kind: "unknown" });
  await f.ledger.reconcile(
    "owner",
    op.id,
    {
      kind: "completed",
      text: "recovered",
      usage: { input: 1, cachedInput: 0, output: 1 },
    },
    "confirmed response identifier",
  );
  await expect(
    f.ledger.reconcileAttemptCost("admin", attempt, 3000, "invoice record"),
  ).rejects.toThrow("Owner authorization required");
  await f
    .reopen()
    .reconcileAttemptCost(
      "owner",
      attempt,
      3000,
      "invoice record confirms actual attempt cost",
    );
  expect(await f.reopen().status("alice")).toMatchObject({
    availableSubcredits: 999_998_250,
    providerCosts: { knownNanoUsd: 3000, unknownExposureNanoUsd: 0 },
  });
  expect((await f.reopen().audit("owner")).at(-1)?.action).toBe(
    "provider_cost_reconciled",
  );
});

import { afterEach, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProLedger } from "./ledger";
import { AppleSandboxBilling } from "./apple-billing";
import { appleFixture } from "./apple-test-fixture";

const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "apple-billing-290-"));
  cleanup.push(dir);
  const client = createClient({ url: `file:${dir}/db` });
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
  let now = Date.now();
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    now: () => now,
  });
  await ledger.grantEligibility("owner", "alice", "approved tester");
  const signed = appleFixture(now);
  const billing = new AppleSandboxBilling(
    ledger,
    signed.config,
    signed.verifier,
    signed.api,
    () => now,
  );
  return {
    client,
    ledger,
    signed,
    billing,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("Apple purchase gate binds one stable account token and signed sandbox purchase shares the account allowance", async () => {
  const f = await fixture();
  try {
    await expect(f.billing.gate("public")).rejects.toThrow(
      "Private eligibility required",
    );
    const gate = await f.billing.gate("alice");
    expect((await f.billing.gate("alice")).appAccountToken).toBe(
      gate.appAccountToken,
    );
    f.signed.transaction.appAccountToken = gate.appAccountToken;
    await f.billing.claim("alice", f.signed.sign(f.signed.transaction));
    const status = await f.ledger.status("alice");
    expect(status.entitled).toBe(true);
    expect(status.availableSubcredits).toBe(1_000_000_000);
    expect(status.billing.environment).toBe("sandbox");
    await f.billing.claim("alice", f.signed.sign(f.signed.transaction));
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      1_000_000_000,
    );
  } finally {
    f.client.close();
  }
});
test("a restored revoked old transaction fences its own interval before renewal, never a later allowance", async () => {
  const f = await fixture();
  try {
    const gate = await f.billing.gate("alice");
    f.signed.transaction.appAccountToken = gate.appAccountToken;
    const old = {
      ...f.signed.transaction,
      revocationDate: f.signed.transaction.purchaseDate + 1,
    };
    f.advance(300000);
    f.signed.transaction.purchaseDate += 300000;
    f.signed.transaction.expiresDate += 300000;
    f.signed.transaction.signedDate += 300000;
    f.signed.transaction.transactionId = "10002";
    f.signed.renewal.signedDate += 300000;
    f.signed.api.getTransactionInfo = async (id) => ({
      signedTransactionInfo: f.signed.sign(
        id === old.transactionId ? old : f.signed.transaction,
      ),
    });
    await f.billing.claim(
      "alice",
      f.signed.sign({ ...old, revocationDate: undefined }),
    );
    expect((await f.ledger.status("alice")).entitled).toBe(true);
    await expect(
      f.ledger.consumePurchase({}, async () => ({
        accountId: "alice",
        eventId: "duplicate-old-interval",
        source: "stripe",
        environment: "sandbox",
        startsAt: old.purchaseDate,
        endsAt: old.expiresDate,
      })),
    ).rejects.toThrow("Paid period permanently fenced");
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      1_000_000_000,
    );
  } finally {
    f.client.close();
  }
});
test("verified Apple payment failure before purchase mapping blocks an overlapping manual allowance, recovery does not top up", async () => {
  const f = await fixture();
  try {
    const gate = await f.billing.gate("alice");
    f.signed.transaction.appAccountToken = gate.appAccountToken;
    await f.ledger.grantPeriod("owner", {
      accountId: "alice",
      eventId: "manual",
      startsAt: f.signed.transaction.purchaseDate,
      endsAt: f.signed.transaction.expiresDate,
      subcredits: 500000000,
      reason: "test",
      environment: "test",
    });
    f.signed.state.status = 3;
    f.signed.renewal.isInBillingRetryPeriod = true;
    await f.billing.claim("alice", f.signed.sign(f.signed.transaction));
    expect((await f.ledger.status("alice")).entitled).toBe(false);
    f.signed.state.status = 1;
    f.signed.renewal.isInBillingRetryPeriod = false;
    await f.billing.claim("alice", f.signed.sign(f.signed.transaction));
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      500000000,
    );
  } finally {
    f.client.close();
  }
});
test("signed notifications reconcile scheduled cancellation, failure, expiry and later renewal with old reservations", async () => {
  const f = await fixture();
  try {
    f.signed.transaction.appAccountToken = (
      await f.billing.gate("alice")
    ).appAccountToken;
    const notify = async (type: string, uuid = crypto.randomUUID()) => {
      const payload = f.signed.sign({
        notificationUUID: uuid,
        notificationType: type,
        signedDate: f.signed.transaction.signedDate,
        data: {
          environment: "Sandbox",
          bundleId: f.signed.config.bundleId,
          signedTransactionInfo: f.signed.sign(f.signed.transaction),
        },
      });
      await f.billing.notification(payload);
      return payload;
    };
    const paid = await notify("SUBSCRIBED");
    const reservation = await f.ledger.reserve(
      "alice",
      "old-reservation",
      "old-hash",
    );
    f.signed.renewal.autoRenewStatus = 0;
    await notify("DID_CHANGE_RENEWAL_STATUS");
    expect((await f.ledger.status("alice")).billing.cancelAtEnd).toBe(true);
    expect((await f.ledger.status("alice")).entitled).toBe(true);
    f.signed.state.status = 3;
    f.signed.renewal.isInBillingRetryPeriod = true;
    await notify("DID_FAIL_TO_RENEW");
    expect((await f.ledger.status("alice")).entitled).toBe(false);
    f.signed.state.status = 1;
    f.signed.renewal.isInBillingRetryPeriod = false;
    await notify("DID_RENEW");
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      998208000,
    );
    f.advance(300000);
    f.signed.transaction.signedDate += 300000;
    f.signed.renewal.signedDate += 300000;
    f.signed.state.status = 2;
    await notify("EXPIRED");
    expect((await f.ledger.status("alice")).entitled).toBe(false);
    f.signed.transaction.transactionId = "10002";
    f.signed.transaction.purchaseDate += 300000;
    f.signed.transaction.expiresDate += 300000;
    f.signed.state.status = 1;
    f.signed.renewal.autoRenewStatus = 1;
    await notify("DID_RENEW");
    await f.billing.notification(paid);
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      1000000000,
    );
    expect(
      (await f.ledger.status("alice")).previousPeriodReservedSubcredits,
    ).toBe(1792000);
    await f.ledger.settle(reservation.id, {
      kind: "completed",
      text: "Old period work",
      usage: { input: 100, cachedInput: 0, output: 10 },
    });
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      1000000000,
    );
  } finally {
    f.client.close();
  }
});
test("wrong signed identities, ownership, family sharing and tampering cannot grant, including another account restore and concurrent group claims", async () => {
  const f = await fixture();
  try {
    f.signed.transaction.appAccountToken = (
      await f.billing.gate("alice")
    ).appAccountToken;
    for (const change of [
      { productId: "other.product" },
      { bundleId: "other.bundle" },
      { subscriptionGroupIdentifier: "9999" },
      { environment: "Production" },
      { environment: "Xcode" },
      { inAppOwnershipType: "FAMILY_SHARED" },
      { quantity: 2 },
      { appAccountToken: crypto.randomUUID() },
      { originalTransactionId: "9999" },
      { expiresDate: f.signed.transaction.purchaseDate },
      { signedDate: f.signed.transaction.signedDate + 120000 },
    ]) {
      await expect(
        f.billing.claim(
          "alice",
          f.signed.sign({ ...f.signed.transaction, ...change }),
        ),
      ).rejects.toThrow("Apple sandbox transaction rejected");
      expect((await f.ledger.status("alice")).entitled).toBe(false);
    }
    const parts = f.signed.sign(f.signed.transaction).split(".");
    parts[1] = Buffer.from(
      JSON.stringify({ ...f.signed.transaction, transactionId: "9999" }),
    ).toString("base64url");
    await expect(f.billing.claim("alice", parts.join("."))).rejects.toThrow();
    await f.ledger.grantEligibility("owner", "bob", "approved tester");
    const bob = await f.billing.gate("bob");
    await expect(
      f.billing.claim("bob", f.signed.sign(f.signed.transaction)),
    ).rejects.toThrow();
    await f.billing.claim("alice", f.signed.sign(f.signed.transaction));
    const stolen = {
      ...f.signed.transaction,
      appAccountToken: bob.appAccountToken,
    };
    f.signed.transaction.appAccountToken = bob.appAccountToken;
    await expect(
      f.billing.claim("bob", f.signed.sign(stolen)),
    ).rejects.toThrow();
    expect((await f.ledger.status("bob")).entitled).toBe(false);
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      1000000000,
    );
  } finally {
    f.client.close();
  }
});
test("concurrent Apple restores and another channel map to one bounded grant; original group remains account-bound after reopening", async () => {
  const f = await fixture();
  try {
    f.signed.transaction.appAccountToken = (
      await f.billing.gate("alice")
    ).appAccountToken;
    const jws = f.signed.sign(f.signed.transaction);
    await Promise.all([
      f.billing.claim("alice", jws),
      f.billing.claim("alice", jws),
      f.ledger.consumePurchase({}, async () => ({
        accountId: "alice",
        eventId: "stripe-concurrent",
        source: "stripe",
        environment: "sandbox",
        startsAt: f.signed.transaction.purchaseDate,
        endsAt: f.signed.transaction.expiresDate,
      })),
    ]);
    expect(
      (await f.ledger.entries("alice")).filter((e) => e.kind === "grant"),
    ).toHaveLength(1);
    expect((await f.ledger.status("alice")).availableSubcredits).toBe(
      1000000000,
    );
    const reopened = new ProLedger(f.client, f.ledger.config);
    expect(await reopened.appleAccountToken("alice")).toBe(
      f.signed.transaction.appAccountToken,
    );
    await f.ledger.grantEligibility("owner", "bob", "tester");
    const bobFixture = appleFixture(f.signed.transaction.signedDate);
    bobFixture.transaction.appAccountToken =
      await reopened.appleAccountToken("bob");
    const bobBilling = new AppleSandboxBilling(
      reopened,
      bobFixture.config,
      bobFixture.verifier,
      bobFixture.api,
      () => f.signed.transaction.signedDate,
    );
    await expect(
      bobBilling.claim("bob", bobFixture.sign(bobFixture.transaction)),
    ).rejects.toThrow();
    expect((await f.ledger.status("bob")).entitled).toBe(false);
  } finally {
    f.client.close();
  }
});

test("fresh server status reads may contain older signed transaction and renewal data within an active period", async () => {
  const f = await fixture();
  try {
    f.signed.transaction.appAccountToken = (
      await f.billing.gate("alice")
    ).appAccountToken;
    f.signed.transaction.expiresDate =
      f.signed.transaction.purchaseDate + 30 * 86400000;
    const presented = f.signed.sign(f.signed.transaction);
    f.advance(600000);
    await f.billing.claim("alice", presented);
    expect((await f.ledger.status("alice")).entitled).toBe(true);
    expect(
      (await f.ledger.entries("alice")).filter((e) => e.kind === "grant"),
    ).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

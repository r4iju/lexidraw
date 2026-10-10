import { afterEach, expect, test } from "bun:test";
import Stripe from "stripe";
import { createClient } from "@libsql/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sandboxWebhook } from "./billing-webhook";
import { ProLedger } from "./ledger";
import { SandboxBilling, sandboxHttpClient } from "./billing";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
async function fixture(key = "sk_test_local_fixture") {
  const dir = await mkdtemp(join(tmpdir(), "billing-289-"));
  const client = createClient({ url: `file:${dir}/db` });
  for (const file of [
    "0015_private_pro",
    "0016_pro_billing_events",
    "0029_sandbox_billing",
  ]) {
    for (const sql of (
      await Bun.file(`../../packages/drizzle/drizzle/${file}.sql`).text()
    ).split("--> statement-breakpoint"))
      if (sql.trim()) await client.execute(sql);
  }
  let now = 1_791_000_000_000;
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    now: () => now,
  });
  const calls: { path: string; body: string }[] = [];
  const price = {
    id: "price_trial",
    object: "price",
    livemode: false,
    active: true,
    type: "recurring",
    currency: "usd",
    unit_amount: 1200,
    product: "prod_trial",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  };
  const customer = {
    id: "cus_local",
    object: "customer",
    livemode: false,
    metadata: { lexidraw_account: "alice" },
  };
  const invoice = {
    id: "in_local",
    object: "invoice",
    livemode: false,
    customer: "cus_local",
    status: "paid",
    paid: true,
    currency: "usd",
    amount_paid: 1200,
    total: 1200,
    lines: {
      has_more: false,
      data: [
        {
          amount: 1200,
          quantity: 1,
          period: { start: now / 1000, end: now / 1000 + 30 * 86400 },
          pricing: {
            price_details: { price: "price_trial", product: "prod_trial" },
          },
          parent: {
            subscription_item_details: {
              subscription: "sub_local",
              proration: false,
            },
          },
        },
      ],
    },
    parent: { subscription_details: { subscription: "sub_local" } },
    payments: {
      data: [
        { payment: { type: "payment_intent", payment_intent: "pi_local" } },
      ],
      has_more: false,
    },
  };
  const charge = {
    payment_intent: "pi_local",
    id: "ch_local",
    object: "charge",
    livemode: false,
    customer: "cus_local",
    refunded: false,
    amount_refunded: 0,
    disputed: false,
    paid: true,
    amount: 1200,
    currency: "usd",
  };
  const subscription = {
    id: "sub_local",
    object: "subscription",
    livemode: false,
    customer: "cus_local",
    status: "active",
    cancel_at_period_end: false,
    latest_invoice: "in_local",
    metadata: { lexidraw_account: "alice" },
    items: {
      has_more: false,
      data: [
        {
          id: "si_local",
          price,
          quantity: 1,
          current_period_start: now / 1000,
          current_period_end: now / 1000 + 30 * 86400,
        },
      ],
    },
  };
  const item = subscription.items.data[0];
  if (!item) throw new Error("Missing fixture item");
  const portalResponse = {
    id: "bps_local",
    livemode: false,
    customer: "cus_local",
    configuration: "bpc_local",
    url: "https://billing.stripe.com/p/session/test_local",
  };
  const invoicePayment = { id: "inpay_local", livemode: false };
  const secret = `whsec_${crypto.randomUUID()}`;
  const http = sandboxHttpClient(
    Object.assign(
      async (
        url: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, body: String(init?.body ?? "") });
        const data = path.includes("/disputes/")
          ? { id: "dp_local", charge: "ch_local", livemode: false }
          : path === "/v1/invoice_payments"
            ? {
                has_more: false,
                data: [
                  {
                    ...invoicePayment,
                    invoice: "in_local",
                    payment: {
                      type: "payment_intent",
                      payment_intent: "pi_local",
                    },
                  },
                ],
              }
            : path.includes("/billing_portal/configurations/")
              ? {
                  id: "bpc_local",
                  active: true,
                  livemode: false,
                  features: {
                    subscription_update: { enabled: false },
                    subscription_cancel: {
                      enabled: true,
                      mode: "at_period_end",
                    },
                  },
                }
              : path.endsWith("/prices/price_trial")
                ? price
                : path.endsWith("/products/prod_trial")
                  ? { id: "prod_trial", livemode: false, active: true }
                  : path.includes("/customers")
                    ? customer
                    : path.includes("/subscriptions/")
                      ? subscription
                      : path.includes("/invoices/")
                        ? invoice
                        : path.includes("/payment_intents/")
                          ? {
                              id: "pi_local",
                              livemode: false,
                              customer: "cus_local",
                              status: "succeeded",
                              amount: 1200,
                              currency: "usd",
                              latest_charge: "ch_local",
                            }
                          : path.includes("/charges/")
                            ? charge
                            : path.includes("/checkout/sessions")
                              ? {
                                  id: "cs_test_local",
                                  livemode: false,
                                  customer: "cus_local",
                                  mode: "subscription",
                                  url: "https://checkout.stripe.com/c/pay/cs_test_local",
                                }
                              : portalResponse;
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      { preconnect() {} },
    ),
  );
  const billing = new SandboxBilling(
    ledger,
    {
      key,
      webhookSecret: secret,
      priceId: "price_trial",
      productId: "prod_trial",
      origin: "https://lexidraw.test",
      portalConfigurationId: "bpc_local",
    },
    http,
    () => now,
  );
  const event = async (
    type = "invoice.paid",
    id = crypto.randomUUID(),
    object: unknown = { id: "in_local" },
    signatureOffset = 0,
    live = false,
  ) => {
    const raw = JSON.stringify({
      id: `evt_${id}`,
      object: "event",
      livemode: live,
      created: Math.floor(now / 1000),
      type,
      data: { object },
    });
    return {
      raw,
      signature: await Stripe.webhooks.generateTestHeaderStringAsync({
        payload: raw,
        secret,
        timestamp: Math.floor(now / 1000) + signatureOffset,
      }),
    };
  };
  cleanup.push(async () => {
    client.close();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    ledger,
    billing,
    calls,
    price,
    customer,
    subscription,
    item,
    portalResponse,
    invoicePayment,
    invoice,
    charge,
    event,
    clock: (n: number) => {
      now = n;
    },
    now: () => now,
    resign: async (raw: string) =>
      Stripe.webhooks.generateTestHeaderStringAsync({
        payload: raw,
        secret,
        timestamp: Math.floor(now / 1000),
      }),
  };
}
test("only owner-approved authenticated accounts can open fixed test checkout, live keys never dispatch", async () => {
  const f = await fixture();
  await expect(f.billing.checkout(null)).rejects.toThrow(
    "Authentication required",
  );
  await expect(f.billing.checkout("alice")).rejects.toThrow(
    "Private eligibility required",
  );
  expect(f.calls).toHaveLength(0);
  await f.ledger.grantEligibility("owner", "alice", "approved");
  expect(await f.billing.checkout("alice")).toEqual({
    url: "https://checkout.stripe.com/c/pay/cs_test_local",
  });
  const request = f.calls.find((x) => x.path.endsWith("/checkout/sessions"));
  expect(request?.body).toContain("mode=subscription");
  expect(request?.body).toContain("price_trial");
  const live = await fixture("sk_live_local_fixture");
  await live.ledger.grantEligibility("owner", "alice", "approved");
  await expect(live.billing.checkout("alice")).rejects.toThrow(
    "Sandbox billing unavailable",
  );
  expect(live.calls).toHaveLength(0);
});
test("signed raw events revalidate provider state and share a bounded grant with manual and Apple periods", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const e = await f.event();
  await expect(f.billing.webhook(e.raw, "t=1,v1=unsigned")).rejects.toThrow(
    "Sandbox event rejected",
  );
  await f.billing.webhook(e.raw, e.signature);
  await f.billing.webhook(e.raw, e.signature);
  expect(await f.ledger.status("alice")).toMatchObject({
    entitled: true,
    availableSubcredits: 1_000_000_000,
  });
  expect(
    (await f.ledger.entries("alice")).filter((x) => x.kind === "grant"),
  ).toHaveLength(1);
});
test("manual trial and concurrent Stripe/Apple grants share one allowance without rollover; old work settles in its original period", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  const first = f.now(),
    end = first + 30 * 86400000;
  await f.ledger.grantPeriod("owner", {
    accountId: "alice",
    eventId: "manual",
    startsAt: first,
    endsAt: end,
    subcredits: 1_000_000_000,
    reason: "trial",
    environment: "test",
  });
  const old = await f.ledger.reserve("alice", "old-work", "hash");
  await f.billing.checkout("alice");
  const e = await f.event();
  await Promise.all([
    f.billing.webhook(e.raw, e.signature),
    f.ledger.consumePurchase({}, async () => ({
      accountId: "alice",
      eventId: "apple",
      startsAt: first,
      endsAt: end,
      source: "apple",
      environment: "sandbox",
    })),
  ]);
  expect(
    (await f.ledger.entries("alice")).filter((x) => x.kind === "grant"),
  ).toHaveLength(1);
  f.clock(end);
  f.item.current_period_start = end / 1000;
  f.item.current_period_end = end / 1000 + 30 * 86400;
  const line = f.invoice.lines.data[0];
  if (!line) throw new Error("Missing fixture line");
  line.period.start = f.item.current_period_start;
  line.period.end = f.item.current_period_end;
  const renewal = await f.event();
  await f.billing.webhook(renewal.raw, renewal.signature);
  await f.ledger.settle(old.id, {
    kind: "completed",
    text: "old",
    usage: { input: 1, cachedInput: 0, output: 1 },
  });
  expect(await f.ledger.status("alice")).toMatchObject({
    availableSubcredits: 1_000_000_000,
    reservedSubcredits: 0,
  });
});
test("refund current provider evidence fences future work and delayed paid events cannot resurrect", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const e = await f.event();
  await f.billing.webhook(e.raw, e.signature);
  f.charge.refunded = true;
  f.charge.amount_refunded = 1200;
  const refund = await f.event("customer.subscription.updated", "refund", {
    id: "sub_local",
  });
  await f.billing.webhook(refund.raw, refund.signature);
  await expect(f.ledger.reserve("alice", "after-refund", "h")).rejects.toThrow(
    "Private entitlement required",
  );
  f.charge.refunded = false;
  f.charge.amount_refunded = 0;
  const stale = await f.event();
  await f.billing.webhook(stale.raw, stale.signature);
  expect((await f.ledger.status("alice")).entitled).toBe(false);
});
test("wrong test identities, account binding and plan cannot grant access or expose provider errors", async () => {
  for (const change of ["live", "price", "account"]) {
    const f = await fixture();
    await f.ledger.grantEligibility("owner", "alice", "tester");
    await f.billing.checkout("alice");
    if (change === "live") f.price.livemode = true;
    if (change === "price") f.price.unit_amount = 1201;
    if (change === "account") f.customer.metadata.lexidraw_account = "bob";
    const e = await f.event();
    await expect(f.billing.webhook(e.raw, e.signature)).rejects.toThrow(
      "Sandbox event rejected",
    );
    expect((await f.ledger.status("alice")).entitled).toBe(false);
  }
});
test("failure stops paid steps, recovery cannot top up, cancellation expires without resurrecting delayed events", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const e = await f.event();
  await f.billing.webhook(e.raw, e.signature);
  const running = await f.ledger.reserve("alice", "running", "h");
  await f.ledger.claim(running.id);
  f.invoice.status = "open";
  f.invoice.amount_paid = 0;
  f.subscription.status = "past_due";
  const failed = await f.event("invoice.payment_failed");
  await f.billing.webhook(failed.raw, failed.signature);
  await expect(f.ledger.startAttempt(running.id)).rejects.toThrow(
    "Paid steps stopped",
  );
  await expect(f.ledger.reserve("alice", "new", "h")).rejects.toThrow(
    "Private entitlement required",
  );
  f.invoice.status = "paid";
  f.invoice.amount_paid = 1200;
  f.subscription.status = "active";
  const recovery = await f.event();
  await f.billing.webhook(recovery.raw, recovery.signature);
  expect(
    (await f.ledger.entries("alice")).filter((x) => x.kind === "grant"),
  ).toHaveLength(1);
  f.subscription.cancel_at_period_end = true;
  const cancel = await f.event("customer.subscription.updated", undefined, {
    id: "sub_local",
  });
  await f.billing.webhook(cancel.raw, cancel.signature);
  expect((await f.ledger.status("alice")).entitled).toBe(true);
  f.clock(f.item.current_period_end * 1000);
  expect((await f.ledger.status("alice")).entitled).toBe(false);
  f.subscription.status = "canceled";
  const expired = await f.event("customer.subscription.deleted", undefined, {
    id: "sub_local",
  });
  await f.billing.webhook(expired.raw, expired.signature);
  f.subscription.status = "active";
  const delayed = await f.event();
  await f.billing.webhook(delayed.raw, delayed.signature);
  expect((await f.ledger.status("alice")).entitled).toBe(false);
});
test("management rejects untrusted portal configuration and checkout cannot open a second active subscription", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const e = await f.event();
  await f.billing.webhook(e.raw, e.signature);
  await expect(f.billing.checkout("alice")).rejects.toThrow(
    "Manage the existing sandbox subscription",
  );
  expect(await f.billing.portal("alice")).toEqual({
    url: "https://billing.stripe.com/p/session/test_local",
  });
});
test("shared account status labels sandbox plan, scheduled cancellation and expiry separately from capability access", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  f.subscription.cancel_at_period_end = true;
  const e = await f.event();
  await f.billing.webhook(e.raw, e.signature);
  expect((await f.ledger.status("alice")).billing).toMatchObject({
    environment: "sandbox",
    monthlyUsd: 12,
    monthlyCredits: 1000,
    state: "active",
    cancelAtEnd: true,
    expiresAt: f.item.current_period_end * 1000,
  });
  f.clock(f.item.current_period_end * 1000);
  expect((await f.ledger.status("alice")).billing.state).toBe("expired");
});

test("signed dispute events independently resolve charge and invoice and stop future paid work", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const e = await f.event();
  await f.billing.webhook(e.raw, e.signature);
  f.charge.disputed = true;
  const dispute = await f.event("charge.dispute.created", undefined, {
    id: "dp_local",
  });
  await f.billing.webhook(dispute.raw, dispute.signature);
  expect((await f.ledger.status("alice")).entitled).toBe(false);
});

test("signed live events and future or stale signature timestamps never create sandbox allowance", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  for (const [offset, live] of [
    [600, false],
    [-600, false],
    [0, true],
  ] as const) {
    const e = await f.event("invoice.paid", undefined, undefined, offset, live);
    await expect(f.billing.webhook(e.raw, e.signature)).rejects.toThrow(
      "Sandbox event rejected",
    );
  }
  expect((await f.ledger.status("alice")).entitled).toBe(false);
});

test("portal responses cannot transfer an authenticated account to another customer", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  f.portalResponse.customer = "cus_stolen";
  await expect(f.billing.portal("alice")).rejects.toThrow(
    "Sandbox management unavailable",
  );
});

test("a prior paid invoice cannot fund a newly reported subscription period", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const initial = await f.event();
  await f.billing.webhook(initial.raw, initial.signature);
  const end = f.item.current_period_end * 1000;
  f.clock(end);
  f.item.current_period_start = end / 1000;
  f.item.current_period_end = end / 1000 + 30 * 86400;
  const renewal = await f.event();
  await expect(
    f.billing.webhook(renewal.raw, renewal.signature),
  ).rejects.toThrow("Sandbox event rejected");
  expect(
    (await f.ledger.entries("alice")).filter((x) => x.kind === "grant"),
  ).toHaveLength(1);
});
test("a refund after payment failure is a permanent shared-period fence, another channel cannot clear it as recovery", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const e = await f.event();
  await f.billing.webhook(e.raw, e.signature);
  const apple = {
    accountId: "alice",
    eventId: "apple-paid",
    startsAt: f.item.current_period_start * 1000,
    endsAt: f.item.current_period_end * 1000,
    environment: "sandbox",
    source: "apple",
  };
  await f.ledger.consumePurchase({}, async () => apple);
  f.invoice.status = "open";
  f.invoice.amount_paid = 0;
  f.subscription.status = "past_due";
  const fail = await f.event("invoice.payment_failed");
  await f.billing.webhook(fail.raw, fail.signature);
  f.invoice.status = "paid";
  f.invoice.amount_paid = 1200;
  f.subscription.status = "active";
  f.charge.refunded = true;
  const refund = await f.event();
  await f.billing.webhook(refund.raw, refund.signature);
  await f.ledger.reconcileSandbox("apple:recovery", async () => ({
    accountId: "alice",
    customerId: "apple-original",
    subscriptionId: "apple-sub",
    source: "apple",
    environment: "sandbox",
    startsAt: apple.startsAt,
    endsAt: apple.endsAt,
    state: "active",
    cancelAtEnd: false,
  }));
  expect((await f.ledger.status("alice")).entitled).toBe(false);
});
test("refund retains visible original-period reservations and settles already completed work without restoring access", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const e = await f.event();
  await f.billing.webhook(e.raw, e.signature);
  const operation = await f.ledger.reserve("alice", "outstanding", "hash");
  f.charge.refunded = true;
  const refund = await f.event();
  await f.billing.webhook(refund.raw, refund.signature);
  expect(await f.ledger.status("alice")).toMatchObject({
    entitled: false,
    availableSubcredits: 0,
    reservedSubcredits: 1_792_000,
  });
  await f.ledger.settle(operation.id, {
    kind: "completed",
    text: "already completed",
    usage: { input: 1, cachedInput: 0, output: 1 },
  });
  expect(await f.ledger.status("alice")).toMatchObject({
    entitled: false,
    availableSubcredits: 0,
    reservedSubcredits: 0,
  });
  expect((await f.ledger.operation("alice", operation.id)).period_id).toBe(
    operation.period_id,
  );
});

test("delayed failure or old renewal delivery follows current provider lifecycle and never grants twice", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const old = await f.event("invoice.payment_failed");
  const paid = await f.event();
  await f.billing.webhook(paid.raw, paid.signature);
  await f.billing.webhook(old.raw, old.signature);
  expect(await f.ledger.status("alice")).toMatchObject({
    entitled: true,
    availableSubcredits: 1_000_000_000,
    billing: { state: "active" },
  });
  const next = f.item.current_period_end * 1000;
  f.clock(next);
  f.item.current_period_start = next / 1000;
  f.item.current_period_end = next / 1000 + 30 * 86400;
  const line = f.invoice.lines.data[0];
  if (!line) throw new Error("Missing invoice line");
  line.period.start = f.item.current_period_start;
  line.period.end = f.item.current_period_end;
  const renewal = await f.event();
  await f.billing.webhook(renewal.raw, renewal.signature);
  await f.billing.webhook(old.raw, await f.resign(old.raw));
  expect(
    (await f.ledger.entries("alice")).filter((x) => x.kind === "grant"),
  ).toHaveLength(2);
  expect((await f.ledger.status("alice")).availableSubcredits).toBe(
    1_000_000_000,
  );
});

test("HTTP webhook verifies the original raw body and rejects body tampering without a second grant", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const event = await f.event();
  const handle = sandboxWebhook(() => f.billing);
  const response = await handle(
    new Request("http://localhost/api/billing/stripe-sandbox", {
      method: "POST",
      headers: { "stripe-signature": event.signature },
      body: event.raw,
    }),
  );
  expect(await response.json()).toEqual({ received: true });
  const tampered = await handle(
    new Request("http://localhost/api/billing/stripe-sandbox", {
      method: "POST",
      headers: { "stripe-signature": event.signature },
      body: `${event.raw} `,
    }),
  );
  expect(tampered.status).toBe(400);
  expect(
    (await f.ledger.entries("alice")).filter((x) => x.kind === "grant"),
  ).toHaveLength(1);
});

test("live invoice-payment linkage cannot revoke or bind a sandbox subscription", async () => {
  const f = await fixture();
  await f.ledger.grantEligibility("owner", "alice", "tester");
  await f.billing.checkout("alice");
  const paid = await f.event();
  await f.billing.webhook(paid.raw, paid.signature);
  f.invoicePayment.livemode = true;
  f.charge.refunded = true;
  f.charge.amount_refunded = 1200;
  const refund = await f.event("charge.refunded", undefined, {
    id: "ch_local",
  });
  await expect(f.billing.webhook(refund.raw, refund.signature)).rejects.toThrow(
    "Sandbox event rejected",
  );
  expect((await f.ledger.status("alice")).entitled).toBe(true);
});

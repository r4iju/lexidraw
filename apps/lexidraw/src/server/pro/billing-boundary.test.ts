import { supplierFixture } from "~/test/supplier-fixture";
import { expect, mock, test } from "bun:test";
import * as schema from "@packages/drizzle/drizzle-schema";
import { installServerRuntime } from "~/test/server-runtime";
mock.module("@packages/env", () => ({ default: { NODE_ENV: "test" } }));
const db = await installServerRuntime();
const { createProRouter } = await import("../api/routers/pro");
import { ProLedger } from "./ledger";
import { createClient } from "@libsql/client";
import { sandboxConfig } from "./billing-config";
import { sandboxWebhook } from "./billing-webhook";
test("authenticated billing router rejects public, admin and forged mode/customer/redirect/receipt claims before provider dispatch", async () => {
  const client = createClient({ url: ":memory:" });
  for (const file of [
    "0015_private_pro",
    "0016_pro_billing_events",
    "0029_sandbox_billing",
    "0030_apple_sandbox",
  ])
    await client.executeMultiple(
      (
        await Bun.file(`../../packages/drizzle/drizzle/${file}.sql`).text()
      ).replaceAll("--> statement-breakpoint", ""),
    );
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: () => 1000,
  });
  const { SandboxBilling } = await import("./billing");
  const billing = new SandboxBilling(ledger, {
    key: "sk_test_fixture",
    webhookSecret: "whsec_fixture",
    priceId: "price_trial",
    productId: "prod_trial",
    origin: "https://lexidraw.test",
    portalConfigurationId: "bpc_trial",
  });
  const router = createProRouter({
    ledger: () => ledger,
    billing: () => billing,
    dispatch: async () => {
      throw new Error("Must not dispatch");
    },
  });
  const call = (id: string | null) =>
    router.createCaller({
      drizzle: db,
      schema,
      auth: { kind: "session" },
      headers: new Headers(),
      session: id
        ? {
            user: { id, name: "tester", email: "owner@example.test" },
            expires: "",
          }
        : null,
    });
  try {
    await expect(call(null).sandboxCheckout({})).rejects.toThrow();
    await expect(call("admin").sandboxCheckout({})).rejects.toThrow(
      "Private eligibility required",
    );
    await expect(call("owner").sandboxCheckout({})).rejects.toThrow(
      "Private eligibility required",
    );
    await ledger.grantEligibility("owner", "alice", "explicit");
    for (const input of [
      { isAdmin: true },
      { mode: "live" },
      { customer: "cus_stolen" },
      { price: "price_bad" },
      { redirect: "https://evil.test" },
      { receipt: { verified: true } },
    ])
      await expect(
        call("alice").sandboxCheckout(input as never),
      ).rejects.toThrow();
  } finally {
    client.close();
  }
});
test("only complete explicit sandbox config accepts a test key; live and publishable keys or redirects never initiate charges", () => {
  const config = {
    STRIPE_SANDBOX_ENABLED: "true",
    STRIPE_SANDBOX_SECRET_KEY: "sk_test_fixture",
    STRIPE_SANDBOX_WEBHOOK_SECRET: "whsec_fixture",
    STRIPE_SANDBOX_PRICE_ID: "price_trial",
    STRIPE_SANDBOX_PRODUCT_ID: "prod_trial",
    STRIPE_SANDBOX_APP_ORIGIN: "https://lexidraw.test",
    STRIPE_SANDBOX_PORTAL_CONFIGURATION_ID: "bpc_trial",
  };
  expect(sandboxConfig(config)?.key).toBe("sk_test_fixture");
  for (const key of [
    "sk_live_fixture",
    "pk_test_fixture",
    "rk_test_fixture",
    "",
  ])
    expect(
      sandboxConfig({ ...config, STRIPE_SANDBOX_SECRET_KEY: key }),
    ).toBeNull();
  for (const origin of [
    "https://lexidraw.test/redirect",
    "https://user@lexidraw.test",
    "http://evil.test",
  ])
    expect(
      sandboxConfig({ ...config, STRIPE_SANDBOX_APP_ORIGIN: origin }),
    ).toBeNull();
  expect(
    sandboxConfig({
      ...config,
      STRIPE_SANDBOX_ENABLED: "false",
      STRIPE_SECRET_KEY: "sk_live_fixture",
    }),
  ).toBeNull();
});
test("raw-body webhook boundary rejects unsigned claims and oversized payloads with fixed nonsecret errors", async () => {
  const handler = sandboxWebhook(() => {
    throw new Error("Do not expose checkout secrets");
  });
  for (const body of [
    JSON.stringify({ verified: true, accountId: "alice", mode: "sandbox" }),
    "x".repeat(262145),
  ]) {
    const response = await handler(
      new Request("http://localhost/api/billing/stripe-sandbox", {
        method: "POST",
        body,
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Sandbox event rejected" });
  }
});
test("Apple gate and claim are authenticated, strict and never trust a client verifier flag", async () => {
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
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    supplierBooks: supplierFixture,
    now: Date.now,
  });
  const router = createProRouter({
    ledger: () => ledger,
    dispatch: async () => {},
  });
  const caller = router.createCaller({
    drizzle: db,
    schema,
    auth: { kind: "session" },
    headers: new Headers(),
    session: {
      user: { id: "alice", name: "tester", email: "test@example.test" },
      expires: "",
    },
  });
  try {
    expect(await caller.appleSandboxGate()).toEqual({
      available: false,
      environment: "sandbox",
    });
    await expect(
      caller.appleSandboxClaim({ signedTransaction: "invalid" }),
    ).rejects.toThrow("Apple sandbox billing unavailable");
    await expect(
      caller.appleSandboxClaim({
        signedTransaction: "invalid",
        verified: true,
      } as never),
    ).rejects.toThrow();
  } finally {
    client.close();
  }
});

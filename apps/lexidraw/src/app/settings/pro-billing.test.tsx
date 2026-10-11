import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProBillingSection, ProBillingDetails } from "./pro-billing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { observable } from "@trpc/server/observable";
import { createClient } from "@libsql/client";
import { api } from "~/trpc/react";
import { installDom, render, button } from "~/test/dom";
import { installServerRuntime } from "~/test/server-runtime";
import { supplierFixture } from "~/test/supplier-fixture";
import { ProLedger } from "~/server/pro/ledger";
test("public coming soon and unavailable sandbox never offer a purchase; tester billing is distinct from capabilities", () => {
  const inactive = {
    environment: "sandbox" as const,
    available: false,
    canCheckout: false,
    canManageWeb: false,
    monthlyUsd: 12 as const,
    monthlyCredits: 1000 as const,
    state: "none",
    cancelAtEnd: false,
    expiresAt: null,
    customerBound: false,
    source: null,
    appleAvailable: false,
  };
  const publicView = renderToStaticMarkup(
    <ProBillingDetails billing={inactive} eligible={false} />,
  );
  expect(publicView).toContain("Coming soon");
  expect(publicView).not.toContain("Buy sandbox");
  const absent = renderToStaticMarkup(
    <ProBillingDetails billing={inactive} eligible />,
  );
  expect(absent).toContain("Web sandbox checkout unavailable");
  const active = renderToStaticMarkup(
    <ProBillingDetails
      billing={{
        ...inactive,
        available: true,
        state: "active",
        expiresAt: 1793592000000,
        cancelAtEnd: true,
        customerBound: true,
      }}
      eligible
    />,
  );
  expect(active).toContain("Sandbox/test payment");
  expect(active).toContain("$12/month");
  expect(active).toContain("1,000 credits");
  expect(active).toContain("Ends at period expiry");
  expect(active).toContain("capability");
});
test("Apple lifecycle is labelled separately from web checkout with one shared allowance", () => {
  const html = renderToStaticMarkup(
    <ProBillingDetails
      eligible
      billing={{
        environment: "sandbox",
        available: false,
        canCheckout: false,
        canManageWeb: false,
        monthlyUsd: 12,
        monthlyCredits: 1000,
        state: "active",
        cancelAtEnd: false,
        expiresAt: 1793592000000,
        customerBound: false,
        source: "apple",
        appleAvailable: false,
      }}
    />,
  );
  expect(html).toContain("Apple sandbox subscription");
  expect(html).toContain("internal iOS test build");
  expect(html).not.toContain("live purchase");
});

installDom();
const db = await installServerRuntime();
const { createProRouter } = await import("~/server/api/routers/pro");
test("mounted billing uses authoritative actions for Apple, stale subscriptions and public accounts", async () => {
  const client = createClient({ url: ":memory:" });
  for (const file of [
    "0015_private_pro",
    "0016_pro_billing_events",
    "0029_sandbox_billing",
    "0030_apple_sandbox",
  ])
    for (const sql of (
      await Bun.file(`../../packages/drizzle/drizzle/${file}.sql`).text()
    ).split("--> statement-breakpoint"))
      if (sql.trim()) await client.execute(sql);
  let now = 1_791_000_000_000;
  const ledger = new ProLedger(client, {
    ownerAccountIds: ["owner"],
    now: () => now,
    sandboxBillingAvailable: true,
    supplierBooks: supplierFixture,
  });
  const router = createProRouter({
    ledger: () => ledger,
    dispatch: async () => {
      throw new Error("No generation in billing fixture");
    },
  });
  const caller = (id: string) =>
    router.createCaller({
      drizzle: db,
      schema: {},
      session: { user: { id, role: "user", email: "fixture@example.test" } },
      auth: { kind: "session" },
      headers: new Headers(),
    } as never); // Abbreviated authenticated context contains every field used by these procedures.
  let mutations = 0;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const trpc = api.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            if (op.type === "mutation") mutations++;
            const request =
              op.path === "pro.sandboxCheckout"
                ? caller("apple-active").sandboxCheckout({})
                : op.path === "pro.sandboxManagement"
                  ? caller("apple-active").sandboxManagement({})
                  : caller("apple-active").status();
            void request.then(
              (data) => {
                observer.next({ result: { data } });
                observer.complete();
              },
              (error) => observer.error(error),
            );
          }),
    ],
  });
  async function show(account: string) {
    const status = await caller(account).status();
    const view = await render(
      <api.Provider client={trpc} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <ProBillingSection status={status} />
        </QueryClientProvider>
      </api.Provider>,
    );
    return view;
  }
  try {
    for (const state of ["active", "payment_failed", "expired"] as const) {
      const account = `apple-${state}`;
      await ledger.grantEligibility("owner", account, "D1 synthetic tester");
      const customerId = await ledger.appleAccountToken(account);
      await ledger.reconcileSandbox(`event-${account}`, async () => ({
        accountId: account,
        customerId,
        subscriptionId: account,
        source: "apple",
        environment: "sandbox",
        startsAt: now - 1000,
        endsAt: now + 1000,
        state,
        cancelAtEnd: false,
      }));
      for (const oldBinding of [false, true]) {
        if (oldBinding)
          await ledger.bindBillingCustomer(account, `cus_old_${state}`);
        const view = await show(account);
        try {
          expect(button("Buy sandbox subscription")).toBeUndefined();
          expect(button("Manage sandbox subscription")).toBeUndefined();
          expect(document.body.textContent).toContain(
            "internal iOS test build",
          );
        } finally {
          await view.unmount();
        }
      }
    }
    now += 2000;
    const stale = await show("apple-active");
    expect(button("Buy sandbox subscription")).toBeUndefined();
    await stale.unmount();
    const publicView = await show("public");
    expect(document.body.textContent).toContain("Coming soon");
    expect(button("Buy sandbox subscription")).toBeUndefined();
    await publicView.unmount();
    await ledger.grantEligibility("owner", "new-tester", "D1 synthetic tester");
    const allowed = await show("new-tester");
    expect(button("Buy sandbox subscription")).toBeDefined();
    expect(button("Manage sandbox subscription")).toBeUndefined();
    await allowed.unmount();
    expect(mutations).toBe(0);
  } finally {
    queryClient.clear();
    client.close();
  }
});

test("billing disclosure renders supplied figures and names each unavailable channel", () => {
  const billing = {
    environment: "sandbox",
    available: false,
    canCheckout: false,
    canManageWeb: false,
    monthlyUsd: 24,
    monthlyCredits: 2500,
    state: "none",
    cancelAtEnd: false,
    expiresAt: null,
    customerBound: false,
    source: null,
    appleAvailable: false,
  };
  const html = renderToStaticMarkup(
    // Alternate figures exercise presentation only, not valid trial pricing or checkout.
    <ProBillingDetails billing={billing as never} eligible />,
  );
  expect(html).toContain("$24/month");
  expect(html).toContain("2,500 credits per period");
  expect(html).toContain("Current sandbox trial offer");
  expect(html).toContain("Web sandbox checkout unavailable");
  expect(html).toContain("Apple sandbox billing unavailable");
});

import Stripe from "stripe";
import { z } from "zod";
import { ProError, type ProLedger } from "./ledger";
const Id = z.string().min(1).max(200);
const TestObject = z.object({ id: Id, livemode: z.literal(false) });
const Customer = TestObject.extend({
  metadata: z.object({ lexidraw_account: Id }),
  deleted: z.literal(false).optional(),
});
const Price = TestObject.extend({
  active: z.literal(true),
  type: z.literal("recurring"),
  product: Id,
  currency: z.literal("usd"),
  unit_amount: z.literal(1200),
  recurring: z.object({
    interval: z.literal("month"),
    interval_count: z.literal(1),
    usage_type: z.literal("licensed"),
  }),
});
export type SandboxConfig = {
  key: string;
  webhookSecret: string;
  priceId: string;
  productId: string;
  origin: string;
  portalConfigurationId: string;
};
export class SandboxBilling {
  private readonly stripe: Stripe;
  constructor(
    private readonly ledger: ProLedger,
    private readonly config: SandboxConfig,
    httpClient?: Stripe.HttpClient,
    private readonly now: () => number = Date.now,
  ) {
    this.stripe = new Stripe(config.key || "sk_test_unconfigured", {
      maxNetworkRetries: 0,
      timeout: 10000,
      httpClient: httpClient ?? sandboxHttpClient(),
    });
  }
  private configured() {
    const c = this.config;
    if (
      !/^sk_test_[A-Za-z0-9_]+$/.test(c.key) ||
      !c.webhookSecret.startsWith("whsec_") ||
      !c.priceId.startsWith("price_") ||
      !c.productId.startsWith("prod_") ||
      !c.portalConfigurationId.startsWith("bpc_")
    )
      throw new ProError("Sandbox billing unavailable");
    let origin: URL;
    try {
      origin = new URL(c.origin);
    } catch {
      throw new ProError("Sandbox billing unavailable");
    }
    if (
      origin.origin !== c.origin ||
      origin.username ||
      origin.password ||
      !(
        origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(origin.hostname))
      )
    )
      throw new ProError("Sandbox billing unavailable");
  }
  private async account(account: string | null) {
    if (!account) throw new ProError("Authentication required");
    if (!(await this.ledger.status(account)).eligible)
      throw new ProError("Private eligibility required");
    this.configured();
    return account;
  }
  private async plan() {
    const price = Price.parse(
      await this.stripe.prices.retrieve(this.config.priceId),
    );
    const product = TestObject.extend({ active: z.literal(true) }).parse(
      await this.stripe.products.retrieve(this.config.productId),
    );
    if (
      price.id !== this.config.priceId ||
      price.product !== product.id ||
      product.id !== this.config.productId
    )
      throw new ProError("Sandbox plan mismatch");
  }
  private async customer(account: string, create: boolean) {
    const id = await this.ledger.billingCustomer(account);
    if (!id && !create) throw new ProError("No sandbox subscription");
    const customer = Customer.parse(
      id
        ? await this.stripe.customers.retrieve(id)
        : await this.stripe.customers.create(
            { metadata: { lexidraw_account: account } },
            { idempotencyKey: `lexidraw-sandbox-customer:${account}` },
          ),
    );
    if (
      customer.metadata.lexidraw_account !== account ||
      (id && id !== customer.id)
    )
      throw new ProError("Billing account binding conflict");
    await this.ledger.bindBillingCustomer(account, customer.id);
    return customer.id;
  }
  async checkout(identity: string | null) {
    const account = await this.account(identity);
    const existing = await this.ledger.sandboxSubscription(account);
    if (existing && ["active", "payment_failed"].includes(existing.state))
      throw new ProError("Manage the existing sandbox subscription");
    try {
      await this.plan();
      const customer = await this.customer(account, true);
      const session = TestObject.extend({
        mode: z.literal("subscription"),
        customer: Id,
        url: z.string().max(4096),
      }).parse(
        await this.stripe.checkout.sessions.create(
          {
            mode: "subscription",
            customer,
            line_items: [{ price: this.config.priceId, quantity: 1 }],
            success_url: `${this.config.origin}/settings?billing=sandbox`,
            cancel_url: `${this.config.origin}/settings`,
            subscription_data: { metadata: { lexidraw_account: account } },
            allow_promotion_codes: false,
          },
          {
            idempotencyKey: `lexidraw-sandbox-checkout:${account}:${Math.floor(this.now() / 1800000)}`,
          },
        ),
      );
      if (
        !session.id.startsWith("cs_test_") ||
        session.customer !== customer ||
        new URL(session.url).origin !== "https://checkout.stripe.com"
      )
        throw new Error();
      return { url: session.url };
    } catch {
      throw new ProError("Sandbox checkout unavailable");
    }
  }
  async portal(identity: string | null) {
    const account = await this.account(identity);
    try {
      await this.plan();
      const customer = await this.customer(account, false);
      const config = TestObject.extend({
        active: z.literal(true),
        features: z.object({
          subscription_update: z.object({ enabled: z.literal(false) }),
          subscription_cancel: z.object({
            enabled: z.literal(true),
            mode: z.literal("at_period_end"),
          }),
        }),
      }).parse(
        await this.stripe.billingPortal.configurations.retrieve(
          this.config.portalConfigurationId,
        ),
      );
      if (config.id !== this.config.portalConfigurationId) throw new Error();
      const session = TestObject.extend({
        customer: Id,
        configuration: Id,
        url: z.string().max(4096),
      }).parse(
        await this.stripe.billingPortal.sessions.create({
          customer,
          configuration: this.config.portalConfigurationId,
          return_url: `${this.config.origin}/settings`,
        }),
      );
      if (
        session.customer !== customer ||
        session.configuration !== this.config.portalConfigurationId ||
        new URL(session.url).origin !== "https://billing.stripe.com"
      )
        throw new Error();
      return { url: session.url };
    } catch {
      throw new ProError("Sandbox management unavailable");
    }
  }
  async webhook(raw: string, signature: string) {
    this.configured();
    try {
      if (new TextEncoder().encode(raw).length > 262144) throw new Error();
      const timestamps = signature
        .split(",")
        .filter((part) => part.startsWith("t="));
      if (
        timestamps.length !== 1 ||
        !/^t=\d+$/.test(timestamps[0] ?? "") ||
        Math.abs(this.now() / 1000 - Number(timestamps[0]?.slice(2))) > 300
      )
        throw new Error();
      const event = await this.stripe.webhooks.constructEventAsync(
        raw,
        signature,
        this.config.webhookSecret,
        300,
        undefined,
        this.now(),
      );
      if (
        event.livemode !== false ||
        event.account ||
        Math.abs(this.now() / 1000 - event.created) > 32 * 86400
      )
        throw new Error();
      const type = event.type;
      if (
        ![
          "invoice.paid",
          "invoice.payment_failed",
          "customer.subscription.created",
          "customer.subscription.updated",
          "customer.subscription.deleted",
          "charge.refunded",
          "charge.dispute.created",
        ].includes(type)
      )
        return;
      const object = z.object({ id: Id }).parse(event.data.object);
      await this.ledger.reconcileSandbox(`stripe:${event.id}`, async () => {
        await this.plan();
        let subscriptionId: string;
        let eventRevoked = false;
        let eventCustomer: string | undefined;
        if (type.startsWith("customer.subscription."))
          subscriptionId = object.id;
        else if (type.startsWith("invoice.")) {
          const invoice = TestObject.extend({
            parent: z.object({
              subscription_details: z.object({ subscription: Id }),
            }),
          }).parse(await this.stripe.invoices.retrieve(object.id));
          if (invoice.id !== object.id) throw new Error();
          subscriptionId = invoice.parent.subscription_details.subscription;
        } else {
          // Charge events are bound through the trusted charge's invoice payment intent, never client metadata.
          const chargeId =
            type === "charge.dispute.created"
              ? TestObject.extend({ charge: Id }).parse(
                  await this.stripe.disputes.retrieve(object.id),
                ).charge
              : object.id;
          const charge = TestObject.extend({
            payment_intent: Id,
            customer: Id,
            refunded: z.boolean(),
            amount_refunded: z.number().int().nonnegative(),
            disputed: z.boolean(),
          }).parse(await this.stripe.charges.retrieve(chargeId));
          if (charge.id !== chargeId) throw new Error();
          eventRevoked =
            charge.refunded || charge.amount_refunded > 0 || charge.disputed;
          eventCustomer = charge.customer;
          const payments = z
            .object({
              has_more: z.literal(false),
              data: z
                .array(
                  TestObject.extend({
                    invoice: Id,
                    payment: z.object({
                      type: z.literal("payment_intent"),
                      payment_intent: Id,
                    }),
                  }),
                )
                .length(1),
            })
            .parse(
              await this.stripe.invoicePayments.list({
                payment: {
                  type: "payment_intent",
                  payment_intent: charge.payment_intent,
                },
                limit: 2,
              }),
            );
          const linked = payments.data[0];
          if (
            !linked ||
            linked.payment.payment_intent !== charge.payment_intent
          )
            throw new Error();
          const invoice = TestObject.extend({
            parent: z.object({
              subscription_details: z.object({ subscription: Id }),
            }),
          }).parse(await this.stripe.invoices.retrieve(linked.invoice));
          subscriptionId = invoice.parent.subscription_details.subscription;
        }
        const sub = TestObject.extend({
          customer: Id,
          status: z.string(),
          cancel_at_period_end: z.boolean(),
          latest_invoice: Id,
          metadata: z.object({ lexidraw_account: Id }),
          items: z.object({
            has_more: z.literal(false),
            data: z
              .array(
                z.object({
                  quantity: z.literal(1),
                  price: Price,
                  current_period_start: z.number().int(),
                  current_period_end: z.number().int(),
                }),
              )
              .length(1),
          }),
        }).parse(await this.stripe.subscriptions.retrieve(subscriptionId));
        if (
          sub.id !== subscriptionId ||
          (eventCustomer && eventCustomer !== sub.customer)
        )
          throw new Error();
        const item = sub.items.data[0];
        if (
          !item ||
          item.price.id !== this.config.priceId ||
          item.price.product !== this.config.productId
        )
          throw new Error();
        const customer = Customer.parse(
          await this.stripe.customers.retrieve(sub.customer),
        );
        if (
          customer.id !== sub.customer ||
          customer.metadata.lexidraw_account !== sub.metadata.lexidraw_account
        )
          throw new Error();
        const invoice = TestObject.extend({
          customer: Id,
          status: z.string(),
          currency: z.literal("usd"),
          amount_paid: z.number().int(),
          total: z.literal(1200),
          lines: z.object({
            has_more: z.literal(false),
            data: z
              .array(
                z.object({
                  amount: z.literal(1200),
                  quantity: z.literal(1),
                  period: z.object({
                    start: z.number().int(),
                    end: z.number().int(),
                  }),
                  pricing: z.object({
                    price_details: z.object({ price: Id, product: Id }),
                  }),
                  parent: z.object({
                    subscription_item_details: z.object({
                      subscription: Id,
                      proration: z.literal(false),
                    }),
                  }),
                }),
              )
              .length(1),
          }),
          parent: z.object({
            subscription_details: z.object({ subscription: Id }),
          }),
          payments: z.object({
            has_more: z.literal(false),
            data: z
              .array(
                z.object({
                  payment: z.object({
                    type: z.literal("payment_intent"),
                    payment_intent: Id,
                  }),
                }),
              )
              .max(1),
          }),
        }).parse(
          await this.stripe.invoices.retrieve(sub.latest_invoice, {
            expand: ["payments"],
          }),
        );
        if (
          invoice.id !== sub.latest_invoice ||
          invoice.customer !== sub.customer ||
          invoice.parent.subscription_details.subscription !== sub.id
        )
          throw new Error();
        const line = invoice.lines.data[0];
        if (
          !line ||
          line.period.start !== item.current_period_start ||
          line.period.end !== item.current_period_end ||
          line.pricing.price_details.price !== this.config.priceId ||
          line.pricing.price_details.product !== this.config.productId ||
          line.parent.subscription_item_details.subscription !== sub.id
        )
          throw new Error();
        let revoked = eventRevoked;
        if (invoice.status === "paid") {
          const paymentId = invoice.payments.data[0]?.payment.payment_intent;
          if (!paymentId) throw new Error();
          const payment = TestObject.extend({
            customer: Id,
            status: z.literal("succeeded"),
            amount: z.literal(1200),
            currency: z.literal("usd"),
            latest_charge: Id,
          }).parse(await this.stripe.paymentIntents.retrieve(paymentId));
          const charge = TestObject.extend({
            customer: Id,
            paid: z.literal(true),
            amount: z.literal(1200),
            currency: z.literal("usd"),
            refunded: z.boolean(),
            amount_refunded: z.number().int().nonnegative(),
            disputed: z.boolean(),
          }).parse(await this.stripe.charges.retrieve(payment.latest_charge));
          if (
            payment.id !== paymentId ||
            charge.id !== payment.latest_charge ||
            payment.customer !== sub.customer ||
            charge.customer !== sub.customer
          )
            throw new Error();
          revoked =
            revoked ||
            charge.refunded ||
            charge.amount_refunded > 0 ||
            charge.disputed;
        }
        const startsAt = item.current_period_start * 1000,
          endsAt = item.current_period_end * 1000;
        if (endsAt <= startsAt || endsAt - startsAt > 32 * 86400000)
          throw new Error();
        const state = revoked
          ? "revoked"
          : sub.status === "canceled"
            ? "cancelled"
            : endsAt <= this.now()
              ? "expired"
              : sub.status === "active" &&
                  invoice.status === "paid" &&
                  invoice.amount_paid === 1200
                ? "active"
                : "payment_failed";
        return {
          accountId: sub.metadata.lexidraw_account,
          customerId: sub.customer,
          subscriptionId: sub.id,
          source: "stripe",
          environment: "sandbox",
          startsAt,
          endsAt,
          state,
          cancelAtEnd: sub.cancel_at_period_end,
        };
      });
    } catch {
      throw new ProError("Sandbox event rejected");
    }
  }
}

export function sandboxHttpClient(transport: typeof fetch = fetch) {
  return Stripe.createFetchHttpClient(
    Object.assign(
      async (
        url: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const endpoint = new URL(String(url));
        if (endpoint.origin !== "https://api.stripe.com")
          throw new Error("Sandbox provider unavailable");
        const response = await transport(url, { ...init, redirect: "error" });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader) {
          try {
            for (;;) {
              const result = await reader.read();
              if (result.done) break;
              size += result.value.length;
              if (size > 262144) throw new Error("Sandbox response too large");
              chunks.push(result.value);
            }
          } finally {
            await reader.cancel();
          }
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        return new Response(bytes, {
          status: response.status,
          headers: response.headers,
        });
      },
      { preconnect() {} },
    ),
  );
}

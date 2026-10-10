# Private web sandbox billing

Public Pro remains Coming soon. Live checkout is disabled. Only an authenticated account with owner-audited private eligibility can open test checkout or management. Admin status, email, preferences and client purchase claims cannot grant access. Billing does not override modality capability gates.

The fixed initial test plan is USD 12/month, 1,000 credits. No annual plans, top-ups, overage or rollover. Sandbox credits can fund real Pro provider usage, so paid generation gates and spend limits still apply.

## Server setup

External setup is currently unverified. Missing or unsupported configuration displays Sandbox billing unavailable. No receipt or purchase is synthesized. The server accepts only these dedicated configuration names, never generic or live Stripe credential fallbacks:

- `STRIPE_SANDBOX_ENABLED=true`
- `STRIPE_SANDBOX_SECRET_KEY`, a `sk_test_` secret key
- `STRIPE_SANDBOX_WEBHOOK_SECRET`, the configured endpoint signing secret
- `STRIPE_SANDBOX_PRICE_ID` and `STRIPE_SANDBOX_PRODUCT_ID`
- `STRIPE_SANDBOX_APP_ORIGIN`, one exact HTTPS origin (loopback HTTP is permitted locally)
- `STRIPE_SANDBOX_PORTAL_CONFIGURATION_ID`

The configured Stripe price and product must be active test objects, USD 1,200 cents, recurring monthly, one licensed unit. The portal configuration must be active/test, disable subscription updates and allow cancellation only at period end. Checkout takes an empty authenticated input; customer, price, quantity, mode, metadata and redirect destinations come from trusted server configuration and durable account binding. Redirect responses must be HTTPS on the exact Stripe checkout/portal origin. Customer binding is unique, permanent and nontransferable, even after eligibility revocation.

Register snapshot webhooks at `/api/billing/stripe-sandbox` for invoice paid/payment failed, subscription created/updated/deleted, charge refunded and dispute created events. Raw UTF-8 request bytes are bounded to 256 KiB and verified with Stripe's real `constructEventAsync`, with a five-minute signature timestamp window in both directions. Live and connected-account events are rejected. This route receives no authenticated client receipt. All external errors return fixed messages; no provider error object, checkout envelope, raw webhook or credential enters telemetry.

The SDK has zero retries and a 10-second request timeout. Its transport permits only `https://api.stripe.com`, rejects redirects and bounds each response to 256 KiB. Relevant current subscriptions, customers, prices, products, invoices, payment intents and charges are independently retrieved and schema-checked. Invoice-payment lookup resolves refund/dispute charge ownership under the installed Stripe API; no obsolete PaymentIntent invoice field is assumed.

## Shared accounting and StoreKit handoff

Migration 0029 extends #280's ledger, not a parallel balance. `pro_billing_bindings` binds account/customer in sandbox; `pro_subscriptions` records current verified lifecycle; `pro_lifecycle_events` durably suppresses webhook replay; `pro_period_blocks` fences future paid steps while preserving settlement against the original reserved period.

Provider verification executes inside the ledger write fence, so concurrent deliveries cannot commit old snapshots after a terminal revocation. Arrival order and client metadata never determine the allowance. Payment failure blocks the current period, verified recovery removes only failure blocks and never tops up. Cancellation at period end retains access until expiry. Immediate cancellation, expiry reconciliation, refunds and disputes terminally fence that subscription; delayed paid events cannot resurrect it. Outstanding operations can still settle against their original period.

The existing `consumePurchase` contract accepts only server-verified sandbox Stripe/Apple periods. Exact or overlapping manual/Stripe/Apple periods map to the existing bounded allowance without changing its dates, remaining balance or environment. Renewal adds a fresh nonoverlapping grant with zero rollover. A duplicate purchase with different dates does not extend the existing period; show the actual ledger renewal date, not a promise of extra credit.

#290 should supply a trusted Apple verification adapter to `reconcileSandbox` with source `apple`, durable account/purchase binding and current lifecycle evidence. It must never expose this server verifier to client input. No Apple purchase is implemented here. Terminal period blocks remain authoritative across duplicate purchase channels. Owner eligibility stays independent of payment state.

Web and native `pro.status` share billing environment, availability, plan, cancellation, expiry, and lifecycle state alongside allowance/history. iOS displays the same status and directs test management to web settings. Saved playback, local and BYOK remain usable after paid entitlement ends.

## Local evidence and outstanding external criteria

Local tests use the real Stripe SDK HTTP adapter and signing/verification API, synthetic locally generated signing secrets, real SQLite persistence, and injected provider responses. They exercise authenticated/public boundaries, wrong keys/environments/price/account, signed raw events, concurrent channel duplicates, no rollover, original-period settlement, failures/recovery, cancellation/expiry, refunds/disputes and stale replay. UI fixtures are labelled test data.

No Stripe account/session/purchase/API write, real sandbox smoke, paid generation, hosted preview, remote migration or release was performed. Actual configured Stripe test checkout and portal, webhook delivery/retries and real sandbox lifecycle behavior remain external acceptance criteria. Local SDK fixtures do not establish that external setup exists.

Official references: [webhook raw signatures, retries and unordered delivery](https://docs.stripe.com/webhooks), [API key environments](https://docs.stripe.com/keys), [subscription lifecycle](https://docs.stripe.com/billing/subscriptions/webhooks), [fixed subscription checkout](https://docs.stripe.com/api/checkout/sessions/create), [portal sessions](https://docs.stripe.com/api/customer_portal/sessions/create), [invoice payments](https://docs.stripe.com/api/invoice-payment/list), and [Stripe SDK](https://github.com/stripe/stripe-node).

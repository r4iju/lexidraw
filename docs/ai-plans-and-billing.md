# AI plans and billing proposal

Status: agreed product scope, revised for device-side BYOK; proposed commercial values pending private-trial validation. Public Pro remains Coming soon. Written 2026-10-10. This document does not enable billing or change existing account access.

## Agreed product contract

- One tuned experience. No model picker, Fast/Intelligent switch, or per-feature provider setup.
- Three ways to power AI: Pro (curated app-owned APIs), one supported user-supplied provider key, or built-in local device capabilities.
- Core app and available built-in local capabilities are free. iOS narration uses Apple's speech synthesis; Apple Intelligence is a separate integration with its own availability constraints.
- One account-wide Pro subscription and monthly AI allowance shared by web and iOS.
- Credits expire at renewal, do not roll over, and cannot be topped up at launch. No automatic overages.
- Exhaustion stops new Pro cloud generation. Local, BYOK, and saved-result playback remain available.
- Technical failures are refunded. Internal retries are our cost. Completed results consume credits. Explicit regeneration is a new operation.
- A BYOK or local failure never silently falls back to an app-owned key.
- Pro runs on our servers. BYOK runs on the device with device-held credentials, and local uses built-in device capabilities. Shared TypeScript generation logic uses runtime-specific adapters.
- BYOK keys never reach our APIs, storage, analytics, diagnostics, or server jobs, including encrypted/encoded copies. iOS uses device-only Keychain; web defaults to session memory. Only non-secret preferences and generated artifacts sync.
- Public Pro is Coming soon with live checkout disabled. Explicitly approved accounts can use bounded test entitlements and sandbox purchases; test billing does not eliminate the cost of real provider calls.

## Proposed commercial envelope

Start with USD 12 per month and 1,000 AI credits per billing period. Do not offer an annual plan until usage and retention have been observed.

Use credits as a common unit across text, images, speech, and paid tools. The initial internal conversion is one credit per USD 0.003 of successfully delivered usage valued at the published reference price book. Track the actual invoice cost separately. This is an accounting conversion, not a cash balance, refundable currency, or promised number of messages. User-facing operation rates and examples must be published; customers should not need to understand tokens. Budget known scheduled provider price increases before launch rather than selling a promotional allowance that will immediately shrink.

At full consumption the successful-generation budget is USD 3 per account per period. Reserve another USD 1 in the economic model for absorbed failures/retries and incremental delivery/storage. These are planning assumptions, not measured operating costs. Fixed hosting, support, tax, currency conversion, and engineering are excluded and must be considered before launch.

At a conservative 30% distribution fee, USD 12 yields USD 8.40 before other deductions; subtracting the USD 4 variable-cost envelope leaves USD 4.40 (52.4% contribution on net receipts). Verify actual distribution and payment terms for the enrolled developer account and selling regions. Do not assume Small Business Program enrollment.

The allowance bounds successful use, not failed-request spending. Separate provider-spend controls must bound retries and failures; monitor the USD 1 planning buffer and pause affected integrations before runaway spend. Never make an unconditional promise that USD 4 covers every account's costs.

## Rates and customer experience

Initial rate examples are in [verified provider costs](ai-provider-costs.md). A 10,000-input / 2,000-output token text action costs approximately 5.5 credits on GPT-5.4 mini or 15.167 on the current GPT-5.2 default, assuming no cache savings and including reasoning within the output total. Those are examples of bounded usage, not a recommendation to substitute models without quality evaluation. At the published January 2027 Gemini narration rate, ten minutes of audio output costs 60 credits plus text input. Budget this January rate from launch. The full allowance is under 2.78 hours of narration after text input, or a mixture of features.

Use a preliminary 60-credit maximum quote for one 1024-square Gemini 3 Pro Image only after confirming the actual model ID, output constraints, and that all input/thinking costs fit its USD 0.18 budget. The verified USD 0.134 image-output reference alone consumes about 44.667 credits; it does not justify assigning the older preview alias that same total price. Image rates remain a launch validation gate.

- A versioned price book records provider, model, modality, token categories, tool charges, currency, effective date, and customer credit rates. Snapshot the price book on each operation.
- Initial text charges use billable input, cached input, output, and reasoning where applicable, rather than just displayed response length. Count hidden planning and tool-related model calls under the same user action.
- Images have a fixed quote for a constrained model, size, quality, and count, including a bounded prompt allowance. Larger or different settings are not exposed as model choices.
- Narration shows a quote for the actual text to be synthesized. Duration-based providers require a conservative duration/output bound; do not pretend character counts give an exact provider bill.
- Paid search/tools consume the shared allowance and belong in the action's quote. Tools without a verified price and enforceable bound are not enabled for Pro.
- Show expensive-action quotes before generation and label maximum reservations separately from expected consumption. Settlement never exceeds the accepted maximum.
- Autocomplete is an explicit opt-in with a visible allowance status and aggregate consumption, rather than a confirmation dialog on every suggestion. Bound its request rate, input size, output, and outstanding requests.
- Display the balance, reserved credits, renewal date, and a usage history by feature. Use sensible example quantities to explain purchasing power, not a promise of identical message costs.
- Store fractional usage in integer subcredits (for example 1 credit = 1,000,000 subcredits), accumulate small autocomplete charges, and round only for display. Do not round every call up to a whole credit.
- Published customer rates remain stable through the current billing period. A provider price change is absorbed temporarily or handled by disabling an affected integration, never by silently repricing an existing reservation.

## Accounting invariants

1. Every app-owned paid provider request requires an authenticated account, valid entitlement, an approved capability, and an atomic reservation before any paid work starts.
2. Available credits equal period grant minus settled debits minus active reservations. Parallel web/iOS requests cannot overspend the same balance.
3. An operation has an idempotency key scoped to the account and a bounded quote. Retries of that operation neither reserve nor charge twice.
4. Each operation ends as settled, refunded, or explicitly reconciled. An append-only ledger records grants, reservations, releases, debits, refunds, and administrative adjustments.
5. Provider attempts and their actual cost are recorded separately from customer credits, including failures and retries we absorb.
6. Durable workflow steps settle at most once. Recovery resolves unknown provider outcomes before retrying; expiry alone cannot release a reservation while paid work may still be running.
7. Streams settle on server-side provider completion, independently of browser disconnect. A partial result followed by a technical failure is refunded under the agreed rule; cancellation must stop further provider calls and be distinguished from a technical failure.
8. A failed narration job is refunded as an operation even if some parts were delivered. Preserve reusable parts and track their absorbed cost; prevent deliberate cancel/retry loops with limits. A later operation quotes only work still needed, and replays never charge generation credits.
9. Credits belong to the billing period they reserved. Renewal gives a new grant while outstanding old-period work settles against its old grant; it cannot consume new-period credits by accident.
10. Purchase events are verified server-side and processed idempotently. One account has one active allowance even if purchases arrive from multiple platforms; duplicate subscriptions must not create duplicate grants.

## Abuse and cost controls

The balance is a financial control, not the sole abuse control. Launch defaults should be tuned against legitimate use before being advertised:

- One active agent run, one narration job, two image operations, and two interactive text operations per account; autocomplete allows one outstanding request and cancels superseded work.
- Shared account limits across devices, plus burst limits by network/device for account farming. Registration controls and provider/project budgets remain necessary even without a cloud free allowance.
- Hard per-operation input, output, image count, narration size, tool-call, elapsed-time, and agent-cycle bounds. Existing agent code's six-cycle limit is only one component of this budget.
- Reserve the complete bounded agent action, including planning, decisions, searches, and generation. Refuse further paid steps before exceeding its cap. Do not leave user edits half-applied without reporting what completed.
- Bound internal retry count and provider spend, classify permanent errors, and open a circuit breaker on repeated provider failure. Refundable operations still count toward request/failure limits.
- No arbitrary upstream URLs, models, endpoint paths, or user-controlled billable settings under system credentials.
- BYOK calls execute directly on-device and do not debit Pro credits. Our artifact sync APIs retain operational/storage limits. Device generation also bounds concurrency, retries, and request size, but users remain responsible for provider spending limits. Tell users that their provider may charge failed requests; our credit refund promise concerns Pro. Unsupported paid tools never use our credentials as a fallback.

## Current code and enforcement work

The current checkout has no subscription or credit ledger. `LLMAuditEvents` records some text usage but is not an entitlement or accounting system: token categories, attempt costs, TTS, images, and all tool calls need complete coverage.

| Entry point | Required treatment |
| --- | --- |
| `app/api/autocomplete/stream` | Shared dispatch, rate limits, reservation and settlement |
| `app/api/llm/generate`, `stream`, `agent` | Bounded operations, server-owned tuned model configuration |
| `server/api/routers/llm` | Same dispatcher; no parallel unmetered implementation |
| `server/llm/planner`, `workflows/agent/*` | All model calls and paid tools charged to the parent action budget |
| `server/api/routers/image` | Fixed model/settings, complete quote, result accounting |
| `server/api/routers/web`, `sandbox` | Paid search covered by entitlement/budget, including delegated sandbox calls |
| `workflows/document-tts/*` and article narration | User/account ownership propagated into durable jobs; reserve before synthesis, record provider usage |
| `app/api/llm/proxy/openai/[...path]`, `google/[...path]` | Remove arbitrary forwarding under app-owned keys; replace Pro client agent usage with bounded server operations and BYOK usage with approved direct-device transports |

BYOK uses device-held opaque credential references, a direct approved-provider transport, and runtime egress assertions. Native iOS keys are held in non-synchronizing Keychain entries; web keys remain in session memory. Never persist or transmit user key material to our infrastructure, including uploads, job checkpoints, telemetry, or raw SDK errors. Attach keys only to approved HTTPS provider origins and paths, and reject authenticated redirects. Validate one-key text/image/narration compatibility and direct browser/native access before enabling a provider. Provider/model names appearing in source are not evidence of current account access.

Shared TypeScript generation logic runs on the server for Pro and on the device for BYOK. Native iOS uses a constrained bundled-JavaScript/native adapter bridge. BYOK progress and completed chunks survive supported device interruptions; app/browser shutdown is not a durable server job guarantee. Authenticated bounded artifact uploads sync finished recordings without key material. The rebuilt spec defines client-network interception tests with distinctive fake OpenAI, Anthropic, and OpenRouter keys to prove supported request paths keep keys off our infrastructure.

## Implementation sequence and acceptance cases

1. Centralize paid capability dispatch and provider accounting; remove unrestricted system-key proxies. Record costs without presenting incomplete billing as protection.
2. Add the atomic period/ledger/reservation layer and test concurrency, idempotency, failed operations, ambiguous provider completion, and rollover while work is running.
3. Add shared generation adapters, direct-device BYOK with egress assertions, bounded artifact sync, and native local narration; remove consumer model controls. Verify there is no implicit app-key fallback or backend BYOK proxy.
4. Integrate web and iOS sandbox purchase verification into one test entitlement system, plus explicit private tester grants. Verify restore, renewal, expiration, payment failure, cancellation, refunds/revocations, duplicate purchases, and webhook reordering. Keep sandbox/live events isolated and live checkout disabled.
5. Add plan, quote, balance, and usage UI. Run physical-device background narration verification and web/iOS shared-balance QA.
6. Enable private Pro only after the complete entry-point audit passes. Public Pro remains Coming soon. Existing users need explicit migration messaging and a staged rollout rather than an incidental access break caused by adding middleware. Public activation and live payments require separate launch work.

Public billing cannot launch until price-book rates, supported credentials, purchase integration, failed-stream/cancellation treatment, and measured variable-cost assumptions have been validated. No product-scope decisions above imply billing is already implemented. See [verified provider costs](ai-provider-costs.md) for source pricing and uncertainties, and [the rebuilt spec](ai-power-modes-spec.md) for the device-key custody contract and private rollout scope. This companion note supersedes its earlier server-stored BYOK recommendation.

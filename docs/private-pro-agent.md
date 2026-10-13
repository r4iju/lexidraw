# Private Pro document actions

The production capability is disabled. Public Pro remains Coming soon and live checkout remains off. Eligibility is an audited owner action, separate from a bounded test entitlement. Admin role, email, client settings, key presence and a supplied operation ID cannot enable the feature.

## One complete action

The authenticated `proAgent` router reserves one parent operation through the existing Pro ledger before planning or any paid tool. Its immutable request includes a document revision and an explicitly accepted maximum. The curated reference contract uses OpenAI Responses with `gpt-5.4-mini`, low reasoning, no retries, 4,096 input tokens and 512 output tokens. Input is conservatively bounded by UTF-8 bytes including the fixed system envelope. Prompts and current document context each have a 1,500 byte limit. There are no user model, endpoint or upstream parameter switches.

The action allows at most 120 seconds, six decision cycles, eight tools, thirteen text steps, two search requests, fifteen paid attempts and one simultaneous agent action per account. Each paid step is serial, fenced durably and authorized against the account, parent, attempt and exact server request hash before resolving a credential. Repeated delivery cannot retry a started, failed or uncertain paid step. Account request, concurrency, refunded-failure spend, total account spend and global daily spend circuits remain the existing ledger circuits. Refunding credits does not erase attempts or reopen those spend allowances.

The complete published-reference exposure is $0.079888, reserved as 26.629334 credits. It includes thirteen maximum text steps and two $0.005 search calls. Successful settlement sums all reference usage, including planning and decisions, and rounds once for the entire action. The charge never exceeds the accepted reservation. Customer credits are separate from provider attempt expense. Adapter list-price estimates are labeled estimates; they are not fabricated invoice costs. Until supplier evidence is reconciled, missing actual cost conservatively occupies the attempt's maximum spend exposure.

Technical failure, cap exhaustion or confirmed cancellation without complete action evidence returns the entire reservation. Saved document edits remain. Cancellation stops further paid steps. Durable final decision and all committed edit receipts take precedence over a losing failure or cancellation verdict under the settlement write lock. Uncertain provider outcomes retain the reservation and are not retried or silently released. An expired executor lease exposes reconciliation; owner reconciliation requires supplier evidence and a bounded actual cost. Renewal never moves an old action's costs or reservation into a new period.

## Documents and tools

The document adapter verifies edit access on each read and before each mutation, uses the saved revision as a compare-and-swap condition, and commits the idempotent edit receipt with the document update. Concurrent human edits and revoked access stop the action. Reports distinguish saved edits from incomplete planned edits on failure, cancellation and exhaustion. They make no rollback promise. Web and native composers save and leave the editor before starting, then reload document state when returning. Reopening either composer restores the latest account-scoped action and its saved-edit report from the server.

Supported production adapters are fixed text generation and Google Custom Search JSON API requests. Search uses the exact Google endpoint, five results, safe search, a six second deadline, a bounded response and no redirects. Images are unavailable pending a verified complete bound and account access. Cloud sandbox execution and delegation are unavailable pending complete audited tool bounds and identity contracts. Legacy planner, agent, generation, search, callback and cloud sandbox paths reject system-key execution outside the bounded operation. Supplying a parent ID or callback metadata does not grant tool authorization.

The image whole-action contract test uses an explicitly synthetic complete image pricebook with provenance `deterministic-whole-action-fixture`. It includes planning, decisions, paid search, image work and a document edit in one parent settlement. It does not enable production images or prove supplier account access, price, service or quality.

## Local evidence and enablement gates

The browser and iOS BrowserHarness exercise the production action composer, authenticated router, production document adapter and the same isolated account ledger through an injected paid-tool transport. They prove reservation, accounting, document mutations and UI reporting. They do not prove real provider service, credentials, latency, quality or invoice rates. The browser failure journey retains the first edit, lists the second as incomplete and charges zero credits.

Enablement requires an owner-approved paid preflight of the exact account, approved model parameters, provider usage and invoice attribution, representative output quality, paid search account availability, and durable workflow deployment and database migration. No local test certifies those external gates. Google states that this API is closed to new customers and existing customers must transition by January 1, 2027. Its account availability must therefore be verified, not inferred from public metadata. No fallback, proxy or alternate route is permitted.

Published reference sources checked for this implementation:

- [OpenAI gpt-5.4-mini model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini): $0.75 input, $0.075 cached input and $4.50 output per million tokens.
- [Google Custom Search JSON API overview](https://developers.google.com/custom-search/v1/overview): $5 per 1,000 requests and the customer transition restriction.

See [AI billing](ai-plans-and-billing.md), [provider costs](ai-provider-costs.md) and [private images](private-images.md) for the parent policies. This local implementation does not deploy, provision, run migrations remotely or perform paid calls.

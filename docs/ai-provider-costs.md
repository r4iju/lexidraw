# AI provider costs

Verified against official public documentation on **2026-10-10**. USD, standard synchronous API rates. These are provider list prices, not measurements of Lexidraw production spend. Recommendations and examples below are assumptions, not approved commercial terms.

## Existing implementation

`apps/lexidraw/src/lib/llm-models.ts` defaults OpenAI chat/agent to `gpt-5.2`, autocomplete to `gpt-5.4-nano`, and planning to `gpt-5-nano`. Google chat/agent uses `gemini-3-pro-preview`. These constants do not establish production usage or account availability.

Document narration selects Google in production by default (`server/tts/choose-provider.ts`). `workflows/document-tts/ensure-chunk-synthesized-step.ts` passes server credentials explicitly. Providers support an optional key argument, but that is not evidence of a complete user-key workflow. Google synthesis uses `gemini-3.8-flash-lite-tts`; OpenAI uses `gpt-4o-mini-tts`. Cached chunks return before synthesis.

## Verified OpenAI rates

Text prices per million tokens:

| Model | Input | Cached input | Output | Relevance |
|---|---:|---:|---:|---|
| [GPT-5.2](https://developers.openai.com/api/docs/models/gpt-5.2) | $1.75 | $0.175 | $14 | Current chat/agent default |
| [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) | $0.75 | $0.075 | $4.50 | Candidate for evaluation, not a quality-equivalent replacement proven here |
| [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano) | $0.20 | $0.02 | $1.25 | Current autocomplete default |
| [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano) | $0.05 | $0.005 | $0.40 | Current planner, documentation marks deprecated |

[GPT-4o mini TTS](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) lists $0.60/million text input tokens and $12/million audio output tokens, and is marked deprecated. Do not launch a new long-term promise tied to this model without resolving its migration. No per-minute conversion is assumed here.

[GPT Image 1.5](https://developers.openai.com/api/docs/models/gpt-image-1.5) lists 1024-square image output at $0.034 medium quality or $0.133 high quality, plus input costs, and is marked deprecated. These are comparison figures, not a recommended launch model. Current [OpenAI pricing](https://developers.openai.com/api/docs/pricing) lists GPT Image 2 standard rates of $2.50/million text input, $4/million image input, $1/million cached image input, and $15/million image output. Reserve from a model-specific size/quality estimate, not an older model's per-image price. The same pricing page lists web search at $0.01/call plus search-content tokens; this is not the price of Lexidraw's Google Custom Search integration.

## Verified Google rates

[Google's pricing page](https://ai.google.dev/gemini-api/docs/pricing) verifies these standard paid rates:

| Model | Input / million | Output / million |
|---|---:|---:|
| Gemini 3.8 Flash | $0.75 | $3.75 |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 |
| Gemini 3.1 Pro Preview, prompts <=200k | $2 | $12 |
| Gemini 3.8 Flash-Lite TTS | $0.50 text | $6 audio |

Flash and Flash-Lite TTS rates above double January 1, 2027. TTS produces 25 audio tokens/second: output costs $0.54/hour now, $1.08/hour from January, plus text input. Gemini 3 Pro Image lists $0.134 per 1K/2K image or $0.24 per 4K image, plus input/text output. The exact older `gemini-3-pro-preview` and `gemini-3-pro-image-preview` IDs in this checkout were not found in the current pricing page; do not assign newer aliases' prices or availability to them without verification.

## Billing overhead

[Stripe US Payments](https://stripe.com/pricing) lists domestic cards at 2.9% + $0.30 per successful transaction. [Stripe Billing](https://stripe.com/billing/pricing) adds 0.7% of billing volume on its pay-as-you-go plan. This is a US domestic example, not confirmation of the merchant's country or contract; taxes, currency conversion, international cards and other products may add cost.

[Apple's Small Business Program](https://developer.apple.com/app-store/small-business-program/) offers 15% commission for eligible enrolled developers, with a $1 million proceeds threshold across associated accounts. Eligibility alone does not confirm this account's enrollment. Model a 30% commission sensitivity until actual terms are confirmed. Store-specific tax treatment must also be checked.

## Proposed cost contract

Evaluate one fixed curated configuration per capability. Keep the user-facing experience unified; different tasks can use different internally selected models. Choose quality using representative documents, languages, image prompts and tool sequences before changing defaults.

Use credits as a product allowance, with an internal dollar-denominated cost budget. A proposal to test is **1,000 monthly credits with $3 maximum successful-generation provider cost**, or $0.003 per credit internally. Credits are not redeemable currency. Reserve an upper bound before any request, settle from actual metering where reliable, refund technical failures, and absorb internal retry spend separately. Version the published rate schedule and pin it for a subscriber's billing period.

Illustrative costs, assuming uncached inputs and that stated output totals include billable reasoning:

| Operation | Provider cost | Credits at proposed conversion |
|---|---:|---:|
| GPT-5.2: 10k input + 2k output | $0.0455 | 15.167 |
| GPT-5.4 mini: same tokens | $0.0165 | 5.5 |
| GPT-5.4 nano: 2k input + 200 output | $0.00065 | 0.217 |
| Gemini narration: 10 minutes, January output rate, before input | $0.18 | 60 |

Preserve fractional credits internally so autocomplete is not disproportionately rounded up. A 1,000-credit balance corresponds to at most about 2.78 hours of January Gemini TTS output alone, with less after input, other AI use and estimation buffers. This is not a promised narration allowance.

At an illustrative **$12/month**, US Stripe Payments plus Billing leaves $11.268; Apple at 15% leaves $10.20; a 30% sensitivity leaves $8.40, before tax. With $3 successful-generation spend and an assumed $1 combined retry/delivery buffer, contribution is respectively $7.268, $6.20, or $4.40. The 30% sensitivity gives 52.4% contribution on net receipts (36.7% of sticker revenue). This matches the [billing proposal](ai-plans-and-billing.md). Infrastructure, retry frequency and refunds require real measurement. Do not call this net profit.

Separate credit limits from request size, output/reasoning ceilings, tool-call counts, agent-step limits, concurrency, queue limits and account/device/IP rate limits. A failing workflow can spend provider money despite a user refund, so also enforce global and per-account retry/spend circuit breakers. Raw proxy routes must not bypass metering or permit arbitrary paid models/tools. Local and BYOK must never silently acquire system credentials. The revised architecture keeps BYOK keys and generation on the device; our infrastructure accepts generated artifacts and non-secret metadata only. BYOK artifact sync still incurs hosting costs and needs operational/storage limits. Client egress assertions must prove user keys do not reach app APIs, uploads, telemetry, or diagnostics.

Before selling: confirm current model access/deprecations, merchant/store fees, measured request distributions, narration duration bounds, generation usage metadata, cache ownership, durable reservation recovery, and all system-key entry points. Recheck the scheduled January price increases in the release rate schedule.

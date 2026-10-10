# Private Pro narration

Ticket #285 adds an authenticated narration operation, durable chunk fences,
account-owned retained audio, and web/native quote and playback controls. Public
Pro remains **Coming soon**, with no live checkout. Eligibility is an owner grant
separate from the dated credit entitlement. Selecting Pro does not grant access.

## Production capability is disabled

`serverProNarration()` deliberately returns no provider. No key, environment flag,
client model selection, BYOK configuration, or local fallback enables it. Google
public metadata establishes a reference configuration and rates, but does not
establish actual account access, successful generation, complete metering, or an
enforceable paid audio output bound. A separately authorized actual service
preflight is still required. No paid generation was used for this implementation.

The complete injected path uses the production authenticated router, ledger,
workflow entry/step, web panel, native composer, and existing native player. Local
UI verification invokes the workflow functions directly with a deterministic
provider fixture. It does not verify hosted workflow scheduling or a real provider.
Silent WAV fixtures prove media plumbing, not voice quality, intelligibility,
pronunciation, or real service duration/cost enforcement. Physical locked-device,
route, and interruption verification remains part of #291.

## Reference configuration and quote

One curated configuration is pinned: Google `gemini-3.8-flash-lite-tts`, `Kore`,
clear natural narration, 24 kHz mono 16-bit PCM WAV. On 2026-10-10, the primary
[pricing documentation](https://ai.google.dev/gemini-api/docs/pricing) lists
$0.50 per million input text tokens and $6 per million output audio tokens, rising
to $1 and $12 on 2027-01-01. Audio is metered at 25 tokens per second. The primary
[speech generation documentation](https://ai.google.dev/gemini-api/docs/speech-generation)
documents the model, voice, and PCM format. Neither reference demonstrates an
enforceable output cap for our account.

The immutable `private-narration-2026-10-v1` operation snapshot contains both
scheduled rates and conservatively uses the higher scheduled rate for quoting
and credit settlement. A credit is the existing private $0.003 test unit. Each
unique missing chunk reserves at most 12.950 credits: 2,850 input tokens plus
3,000 audio tokens at the higher rate, or $0.03885. This does not promise the
temporary lower rate as a promotional allowance. Measured usage settles against
the operation's stored snapshot; actual provider cost is recorded separately.
Changing future books must not rewrite old operation snapshots or periods.

Quotes cover only unique text/config hashes that still require synthesis. Source
revision, accepted maximum, entitlement period, document, account, and action key
are checked again before reservation. Cached audio is authorized by account and
attempt ownership inside the reservation write lock. Identical chunks within a
job are generated and charged once while appearing at each playback position.

## Bounds and durable recovery

- Maximum document: 6,000 UTF-8 bytes and eight 500-code-point chunks.
- Maximum accepted audio: 120 seconds and 3,000 audio tokens per chunk, eight
  chunks, canonical bounded WAV/base64 with usage and actual cost validation.
- Maximum job elapsed time: 20 minutes; a paid step has a 180-second deadline.
- One outstanding narration job per account, including uncertain jobs; existing
  account-wide concurrency, request burst, provider spend, failure spend, and
  daily global circuits also apply.
- Maximum three jobs for the same input per period, including the original;
  eight unique paid chunk fences per job and two durable step retries.

The job plan is immutable SQL data. A unique operation/chunk identity is committed
before provider dispatch. Restarted or duplicate steps reuse confirmed parts and
never reissue a started/uncertain paid request. A stale started fence becomes
uncertain rather than being guessed free. Unknown output holds its reservation
and prevents a new job until the original executor confirms it or an authenticated
owner reconciles validated output, actual usage/cost, and audit evidence. An
owner must not infer failure merely from a disconnected transport.

Settlement runs under the ledger write lock. Completion of the entire durable
plan wins a losing technical-failure/cancellation verdict. A technical job failure
refunds the entire reservation even if some parts were produced; known costs are
reported as absorbed and confirmed parts remain reusable without another charge.
Cancellation stops future paid steps. A fully completed recording is charged;
confirmed cancellation without completion releases the reservation. An uncertain
in-flight part remains held. These trial terms are displayed before acceptance.
Old jobs continue settling against their original entitlement period after renewal.

Audio is private bounded data in account-owned attempts, delivered only through
authenticated reads. Saved replay requires document access and cache ownership,
but no eligibility, entitlement, current credit balance, or provider. Native
playback files are temporary and cleared when the listener stops. This bounded
fixture storage/delivery path is not proof of production media throughput or
storage capacity.

## Legacy entry points

Legacy cloud narration start routes reject new generation. Opening the existing
web player no longer starts a job. Existing ready manifests remain readable;
legacy synthesis steps may return already stored audio but cannot dispatch a
paid provider request. Audio/speech retrieval through legacy provider proxies is
also closed before secret lookup. Broader provider-boundary auditing remains #291.

Only local tests, migrations on disposable SQLite fixtures, types, native builds,
and T3 browser/simulator verification are evidence for this ticket. Production
provider preflight, hosted workflow durability, production media limits, and real
speech quality remain external gaps. No deployment or production migration has
been performed.

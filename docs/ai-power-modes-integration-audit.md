# AI Power local integration audit (#291)

Local branch `feat/276-ai-power-modes`, audited from `36e8174bbea5d5b3536d85fec7aa524d04b9cd35`, descendant of original integration base `065a2f914d46ad667d10c4348d6323a94116245e`. Tickets 277 through 290 are integrated locally. This is implementation evidence, not independent review, cloud acceptance or completion of #276. Parent must run a fresh code-review against that original base.

## Dispatch inventory and current gates

| Surface | Current boundary |
| --- | --- |
| `/api/llm/generate`, `/api/llm/stream`, `/api/autocomplete/stream` | Legacy generation closed; authenticated callers get explicit unavailable responses. |
| `/api/llm/proxy/openai/*`, `/api/llm/proxy/google/*` | All legacy forwarding deleted, including GET/model discovery, HEAD and writes. No server key resolution or upstream forwarding. |
| `/api/llm/agent`, callback; `llm.plan`, `llm.generate` | Closed legacy planner/agent. Legacy agent UI links to supported document actions; chat now uses its separate source-selected bounded contract. |
| `web.googleSearch`, `web.extractWebpageContent`; `sandbox.search`, fetch/article and legacy tool helpers | Standalone paid search and sandbox dispatch closed. Legacy toolkit can only call denied routes. No standalone operation ID authorizes paid tools. |
| `image` legacy route; `imagePower` generation/upload; dashboard cover/drawing image callers | Legacy generation closed. Pro/BYOK image generation stays unavailable. Generated images now register in a dedicated private Blob store and use an authenticated, bounded app delivery route. Saving/read access is independent of generation eligibility; actual private-store configuration remains unverified. Existing images/drawings stay untouched. |
| `pro.chatQuote/chatAccept`, `/api/chat/stream`; web/native chat | Bounded shared CHAT preparation preserves text history/context and supports UTF-8 text attachments. Pro quotes and atomically accepts period-pinned text rates, then streams through authenticated ownership and durable attempt fences. Direct device OpenRouter SSE and native Apple Intelligence snapshots use separate credential-free adapters. Production provider chat gates remain closed pending separately authorized preflight; the complete local injected path is executable. |
| `pro.text`, `pro.autocomplete`, pro-text workflow | Production capability is explicitly false. UI shows Coming soon, rejects before reservation, and old durable production text jobs cannot resolve a system key. Injected bounded text adapter requires attempt/account authorization again at actual HTTP dispatch. |
| `agentPower.quote/start/current/operation/cancel`, pro-agent workflow | Production executor absent. Injected whole-action path uses one reservation and account budget for planning, decisions, generation and search. Actual dispatch requires active eligibility, current dated entitlement, original-period fence, operation ownership and started attempt. Search and SDK fetch recheck after key resolution; cancellation stops further steps. |
| `narration.quote/start/operation/saved`, pro-narration workflow | Production executor absent. Injected bounded narration uses period customer-rate snapshots and the common ledger. Provider-free operation/saved reads check current document access and return historical account-owned audio after edits, with no generation allowance or ledger mutations. |
| `deviceAgent` source/edit commit, web/native portable agent adapters | Device execution is disabled until actual provider/tool bounds are verified. Authenticated, versioned document commits persist generated edits without keys. No server inference or paid fallback. |
| `deviceNarration` source/save/saved; private GeneratedRecordings | Generation capability false, native/browser adapters remain gated. Bounded private finalized audio persists through authenticated document access and quotas. Sync and keyless replay use no Pro credits. |
| Browser BYOK text/autocomplete; native NativeBYOK/JS bridge | One OpenRouter key, fixed endpoint/model/settings, no app proxy, redirects rejected, no retry/fallback. Browser session memory; native device-only Keychain. Retired-key fingerprints guard late output after removal. Unsupported image/audio/agent modalities remain closed. |
| Native FoundationModels / local AVSpeech narration | Free local capabilities, truthful availability, one account source preference. Apple Intelligence requires actual runtime availability; unsupported browsers cannot simulate it. Saved playback stays free after exhaustion. |
| `tts.startDocumentTts/startArticleTts`, listen/settings metadata | Legacy synthesis refuses before worker admission. Direct provider/voice changes rejected; options/catalog never contact an upstream. Old stored configuration remains inert for compatibility. Playback resolves latest account-owned saved job rather than current voice hash. Another reader's newer job cannot shadow or be deleted by the caller. |
| document/article TTS workers, chunk helper, provider factories | Cached completed chunks remain reusable. Uncached synthesis and all three legacy factories refuse without key resolution. Worker retry cannot reopen cloud synthesis. UI regeneration no longer deletes saved audio before a closed route. |
| `config.updateLlmConfig`, profile settings, legacy policy/config reads | Arbitrary model/provider/tool updates denied. Only opt-in suggestions and playback speed remain in user settings. Historical policy/config records remain stored and cannot activate a paid runtime. |
| `/api/billing/stripe-sandbox`, sandbox checkout/portal | Dedicated test credentials only, owner-audited eligibility, signed bounded raw webhooks, current provider reads and durable lifecycle fences. Fixed origin, redirects denied, bounded response/deadline and zero SDK retries. Live checkout off. Actual configured smoke unmet. |
| `/api/billing/apple-sandbox`, gate/claim, native StoreKit | Dedicated Sandbox only, signed trust/account/product/group/period checks and current status reads. No client receipt grants access by itself. Status transport now exact Sandbox origin, numeric IDs, redirect rejection, 1 MiB body cap and 10-second deadline through streamed bodies. Signing time is not API-read freshness. Internal purchase build flag remains absent; production/simulator purchase disabled. OCSP/configured service/distribution acceptance unmet. |
| Ordinary uploads, document/drawing sync, article import, saved audio manifests, backup/font/render helpers | Continue ordinary storage/content behavior. These are not AI inference transports. They cannot supply legacy provider dispatch; existing user documents and recordings are preserved. |

Production app-owned AI inference is closed until separately authorized actual service preflights pass. A server key or environment flag cannot certify provider access, quality or metering bounds. Local fixtures explicitly inject transports, never establish cloud availability.

## Reproduced findings and fixes

Every concrete implementation finding below has an observed failing contract before its fix in `291-evidence/red-*.log`, with matching green evidence:

- Multilingual long-context clipping did quadratic encoding work (55,514,618 characters). Bounded code-point clipping now limits work and preserves UTF-8 limits.
- Narration operation recovery exposed account-owned audio after document permission revocation. Document access is now checked before recovery.
- Agent dispatch trusted reservation-era eligibility. Durable attempt authorization now checks active eligibility and dated/fenced entitlement at actual dispatch, including after async key resolution.
- Legacy GET forwarding/model discovery, direct model settings and TTS factories still bypassed the mode boundary. Forwarders and factories are closed; direct settings are strict.
- Legacy chat originally reached a closed route without a coherent outcome. That initial denial preserved history but did not complete S3. The source-selected replacement and its remaining proof gaps are recorded below.
- Stale text source accepted a paid reservation; unverified production text was selectable. Both are rejected before reservation and old production workflows have no provider runtime.
- The injected text provider could resolve a key without authorization. Authorization now precedes key resolution and actual SDK HTTP dispatch.
- Apple rejected freshly retrieved valid status because signedDate was older than five minutes; default SDK reads had no application response/time bound. Current reads now establish freshness with bounded transport; signatures/expiry/future-time checks remain.
- Private generated images could be stored with public blob access. The replacement uses private SDK writes with a dedicated token and app-only saved URLs; delivery checks current document access and registered lifecycle, rejects redirects, bounds PNG bytes/pixels and disables shared caches. Local synthetic storage proves the contract. No actual bucket configuration/read/write is claimed.
- Saved audio was tied to the currently selected voice, and another account's newer job could shadow playback. Saved lookup/deletion is account-scoped and independent of obsolete voice settings.
- Legacy voice discovery still contacted an upstream; direct voice updates remained writable. Discovery now reports unavailable without external requests.
- Document/article regeneration could delete old audio before failing at a closed route. Those controls now show unavailable and preserve saved recordings.
- Ordinary profile edits could overwrite a concurrently changed AI Power preference from a stale snapshot, and the retained speed slider did not update saved playback. Profile writes now patch ordinary subtrees atomically against the current account row; the speed control reads and writes the actual playback preference. Both regressions were reproduced before the fix.

The Apple JWT helper was additionally checked with a newly generated synthetic P-256 key: P1363 signature, fixed audience/bundle and five-minute token expiry all passed. This is local transport evidence only.

## Final local behavior evidence

Evidence root: `/tmp/lexidraw-276-implementation/291-evidence`. The result manifest lists exact files and final check counts. Web suites run in separate Bun processes to avoid module-mock contamination, always with `--no-env-file` and synthetic env preload. Relevant ledger/billing/device suites cover grants/revocation, two-client credit admission races, exhaustion, renewal/no rollover, technical-failure refunds, durable unknown recovery, cancellation, account switching, stale-source rejection and Sandbox/live isolation. Artifact suites cover private finalization, document permission revocation, generated edits/image receipts, keyless audio lookup, quota/idempotency and stale upload identity.

Credential suites exercise synthetic OpenAI/Anthropic/OpenRouter and opaque keys, known recoverable encodings, URLs/headers/bodies, redirects, browser storage/telemetry, provider errors/output echoes, native bridge/transport and late egress after removal. Binary transports fail closed when inspection cannot be synchronous. These checks do not claim detection of arbitrary ciphertext or steganography, or defense against a compromised runtime.

The fresh #291 loopback host mounts production web AI Power, document-action and recording controls. It uses authenticated synthetic Alice, file SQLite persistence, the real common ledger, actual schema, SqlAgentDocuments permission/revision adapter and GeneratedRecordings finalization. Deterministic injected provider responses stay on loopback; the browser intercepts the sole OpenRouter text connection check. `browser-proof.json` records successful setup/removal, zero key leakage to app requests, zero real external requests, completed generated edits and persisted accounting. `browser-recording.json` proves a fresh browser context with no key receives private saved recording controls. Silent PCM is synthetic and not provider output quality evidence.

T3 preview was used first and its initial screenshot preserved. It later explicitly reported no automation host; the permitted headless browser fallback completed the journey. Native BrowserHarness uses the actual production composer/player and authenticated #291 host, forwarding account preference and artifacts to the same persistent database. `native-snapshot-final.txt` and `native-shared-result.png` show the keyless second-device saved edit and exact charged result. The separate recording scenario uses no provider key and no enabled generation capability. A synthetic allowance-exhaustion stimulus sets only the fixture period to zero. A fresh keyless browser still receives audio controls, and the native player retrieves and plays the saved one-second silent artifact. Native playback is then explicitly stopped. This UI stimulus is separate from the real ledger admission/exhaustion contracts, and from physical audio acceptance.

Final verification includes web typecheck, six explicit native TypeScript projects, portable native bundle, focused Swift contracts, unsigned production native build, unsigned fixture harness build, network-blocked synthetic Next production build, OpenAPI copies/parity, node schema parity, Biome and diff checks. The known broad root baseline (892 pass, 49 fail, 37 errors) was not rerun or claimed fixed. Obsolete initiative-caused settings/TTS mock expectations were updated; a stale built Drizzle schema was rebuilt locally before adapter tests. No broad root build or production env wrapper was used.

Frontend bars opened: state, types, data and components. Full routed grep evidence is `frontend-bars.txt`. Representative final matches: `settings-form.tsx: useState`, `schema.ts: z.strictObject`, `pro-trial.tsx: api.pro.textCapability.useQuery`, `settings-form.tsx: "use client"`. Removed catalog mirror effects and obsolete model/voice controls; only event-owned UI state remains for the changed settings flow.

## Full feature gap matrix

| Ticket | Local evidence | Remaining external/acceptance criteria |
| --- | --- | --- |
| 277 shared contract | Strict schemas, common preference and capability gates | Full initiative independent review and separately approved migration/release. |
| 278 web BYOK | Session memory/egress and fresh setup/removal fixture | Actual authorized provider account/browser CORS, representative text quality and paid access. |
| 279 native BYOK | Device-only Keychain/bridge/transport contracts and build | Actual authenticated physical provider success, configuration and representative output. Prior manifests report an earlier attempted invalid-provider fixture call; this audit made no such call. |
| 280 shared Pro ledger/text | Persistent races, fences, refunds, unknown recovery, billing sharing | Actual mini account/parameter/quality/complete output-cost preflight; hosted durable workflow restart behavior. Production text remains closed. |
| 281 local speech | Native local speech contracts; earlier physical background/Pause evidence | Physical locked replay, lock-screen controls, headphone removal and real interruption recovery. |
| 282 Apple Intelligence | Native availability/generation contracts; earlier real physical English/Japanese generation | Device availability remains runtime dependent; broader authenticated deployed account integration untested. |
| 283 autocomplete | Shared source boundaries, revocation, opt-in, UTF-8 clipping regression | Actual BYOK/Pro account access and quality; Pro closed; physical remaining audio gates unchanged. |
| 284 images | Bounded artifact/UI fixtures, document/drawing preservation and image contracts | Actual model access, routing/quality/complete pricing/output bound; private-store provisioning and externally authorized configuration proof. Private saving/delivery implemented locally; generation remains closed. Dashboard cover separate manual journey not claimed. |
| 285 Pro narration | Ledger/permission/recovery/artifact contracts | Actual voice account access, enforceable audio billing/output bound, pronunciation/quality, hosted workflow/media capacity. Closed. |
| 286 BYOK narration | Portable checkpoints, private artifact sync and keyless playback contracts/UI | Actual speech endpoint/account/PCM format/output-cost bounds and external recovery service. Closed. |
| 287 Pro agents | Whole-action fixture saved edits/search/accounting; late eligibility recheck | Actual tuned mini/search account access and quality; complete paid bounds; actual private-store configuration; sandbox/delegation cost/authorization; hosted workflow. Closed. |
| 288 device agents | Direct controller/document commit and credential contracts | Actual provider planning/tool quality/account/bounds; image gate; external recovery. Browser/native agent transport closed. |
| 289 web Sandbox | Real SDK/signature fixtures, persistent lifecycle/race/refund/renewal contracts | Configured Stripe checkout/portal, delivery/retry and actual Sandbox lifecycle. No external smoke or write. |
| 290 Apple Sandbox | Real SDK synthetic trusted signatures, persistent lifecycle plus bounded status HTTP | Configured product/key/group/API/OCSP access, real Sandbox purchase/restore/notification, physical internal distribution. No actual/local StoreKit purchase. |
| 291 integration | Reproduced audit fixes, final contracts/types/build/UI evidence | Parent fresh independent review, unresolved physical gates, all actual provider/payment/deployment criteria above. #276 remains incomplete. |

## Physical provenance and blocked criteria

Earlier genuine evidence is preserved in `physical-verification.json` and the existing #283 physical screenshots/recordings: M1 iPad `00008103-001E081C1A79001E`, real FoundationModels English/Japanese, local AVSpeech about ten seconds, background and Control Center Pause. Those are earlier observations, not repeated #291 proofs.

#291 first used T3 device list/open. The physical iPad was explicitly unsupported there; authorized devicectl fallback initially reported paired but tunnel disconnected, DDI unavailable, last connection 2026-10-10 11:56 UTC. A later bounded details probe connected over the existing local-network pairing and confirmed DDI/developer services. The final lock-state probe returned `passcodeRequired: true` and `unlockedSinceBoot: true`; no passcode/unlock action was attempted. A concise asynchronous reconnect/unlock/hardware-help request was made; no answer or reconnection is treated as approval or evidence. Locked playback/lock-screen/headphone removal/actual audio interruption remain blocked until the user unlocks the device to start the controlled local narration run and can perform the lock/headphone/interruption actions. Cached manual signing is authorized, but no locked-device app install/launch or new signing was attempted in this audit. No volume/passcode/credential changes, purchases, provisioning updates or production app data changes occurred. Simulator evidence never substitutes for these gates.

The first two pool leases conflicted with prior agent-device sessions. Their sessions were preserved and only our lease membership was removed under the pool lock, without shutdown. A safe existing Pool iPad 2 was then used. No simulator clone, other writer or worktree was created.

## Staged migration and release policy

1. Before any future production denial, release coherent account settings/chat/listening notices explaining one account source, supported capabilities and unavailable legacy cloud services. This local branch includes those notices together with closed routes for audit. Before production ships the denial patch, the owner must first deliver the notice through an approved existing announcement channel or a separately reviewed notice-only patch and confirm delivery, including older native clients. No production notice was delivered here, and staged rollout acceptance is not claimed. Existing documents, drawings, API tokens/user keys and saved recordings are retained; old provider configurations stay inert rather than being erased.
2. Confirm private eligibility audit, actual feature preflight and authenticated artifact delivery. Keep each unresolved capability Coming soon. Existing saved content remains readable/replayable without a generation allowance or provider key. Never ask users to send device provider keys to our server.
3. Only after separate user authorization, plan remote migrations and one batched final release per affected app, inspecting branch remote deployment configuration before any push/merge. This task performs none of those actions. No production migration, cloud build, hosted preview, CI, deployment, release preparation, auth setting change, paid request or payment write occurred.

Public Pro stays Coming soon, live checkout off. Private cancellation terms are disclosed as test policy; public terms remain unresolved before launch. Parent owns graph/tracker/PR lifecycle and final independent review; none was modified here.

## Final review fixes from pinned `a0353455`

The sole-writer local follow-up addresses Standards S1-S6 and the shared-document-mechanics judgment J1, plus Spec S1 from the independent pinned review. Mixed valid percent escapes and malformed ordinary text can no longer conceal a configured or retired credential at web network/storage boundaries; the analogous Swift invalid-UTF-8 run is also guarded. Persisted agent attempt descriptors are strictly validated before paid steps and accounting. Device checkpoint types require their phase/status payloads, narration explicitly maps pending/error/empty query states, playback resets through component lifetime, and the affected controls use the existing design system. Browser-facing result types derive from type-only router outputs.

Access reads, block construction and revision compare-and-swap are shared between Device and Pro writers. Receipt transactions remain distinct: Device scopes identity to account/document and enforces credential/quota checks; Pro scopes identity to an operation and updates its report atomically under eligibility/cancellation fences. The extraction preserves those contracts and image-dimension policies.

Evidence is `/tmp/lexidraw-276-implementation/291-standards-fixes-v1.json`, with actual red/green boundary logs, fresh-process local suites, web/native shared-core typechecks, JavaScriptCore checkpoint verification, Swift credential-guard verification and T3 loopback control interaction evidence. The old ListenPlayer query fixture also failed at the pinned baseline; its fixture is updated and its five playback/focus checks pass. No release or external acceptance is claimed. S2 private image delivery now has local implementation and evidence below. S4 period-pinned narration rates and S5 saved-job read-only delivery now have local implementation and evidence below. S3 subsequently received the local source-selected migration below; its external provider proof remains pending. No scope revision or spec completion is claimed. Actual provider/payment, physical audio and deployment criteria remain open, and #276 is incomplete.


## S2 authenticated private images, local follow-up

`GeneratedImages` stores only a stable `/api/generated-images/<id>` URL in its receipt/table, never a Blob/provider URL. Production storage uses the installed `@vercel/blob` private `put` and `del` APIs, with a dedicated `PRIVATE_IMAGE_BLOB_READ_WRITE_TOKEN` (its store identity follows the installed SDK token format). It cannot fall back to the public bucket. The installed SDK `get` follows fetch redirects, so the private read instead constructs the fixed private Blob origin from that store identity and uses redirect rejection, storage-only authorization, a deadline and bounded PNG metadata/stream consumption. No incoming app cookies/tokens or provider keys enter storage requests.

The app delivery route requires web cookie or native API-token authentication, checks the current entity access before and after storage reads, and requires registered lifecycle. Shared readers may view; shared editors may register. Revoked shares, deleted documents, anonymous requests and pending/abandoned artifacts cannot read. Output verifies the saved byte count/hash and fixed 1024×1024 PNG structure/pixels, rejects SVG/metadata/SDK envelopes, and uses private no-store responses varying on Cookie and Authorization. Saving and reads have no generation, Pro eligibility, allowance or provider-key prerequisite. Pending upload leases, quotas, duplicate receipts and repeat abandoned-part cleanup are preserved.

Web image insertion already uses the authenticated save mutation and ordinary same-origin image rendering. Device document-agent upload now uses that private registration, and the Pro document adapter factory shares the same store. The provider executors remain gated. Native save resolves only a validated app image path; the document loader reads it with the current app token using an isolated transport that rejects redirects, has no cookies/cache and bounds body consumption. Private images bypass the global public-image cache. The native media parser admits exactly the relative private-image app path, so web/agent saved document nodes reach that authenticated loader. Other relative sources stay rejected.

Evidence: `/tmp/lexidraw-276-implementation/291-private-images-v1.json` and `291-private-images-evidence/`. Red/green cycles cover stable saved URLs/current permissions, private adapter request/type/stream bounds, the actual delivery route, native credential origin/read behavior, agent insertion and partial-upload retries/cleanup. Sixty relevant web tests pass in sixteen fresh env-free, network-closed processes. Web and native shared TypeScript checks pass. Twenty-eight relevant Swift tests and the local generic iOS Simulator application build pass. T3 preview mounts the production image provider/editor and delivery handler against synthetic in-memory SQLite/storage/provider responses: one generation saves and renders a 1024×1024 image; keyless reload renders it again; document deletion returns 404 and the existing unavailable placeholder; anonymous read returns 401. This is synthetic local evidence, not provider quality, physical-device or actual Blob-service verification. No bucket calls, cloud writes, deployment or release work occurred.


## Narration spec follow-up (local S4/S5)

The sole-writer follow-up from `2870a5e7909b691a298e98790187070dd2310a37`
adds a durable period rate envelope in the existing SQL text column. Text and
narration books were copied at period creation. At that checkpoint gated
image/agent books used a first-period-quote pin. That policy did not satisfy
entire-period pricing stability and is superseded by the supplier-cost and D3
follow-up below. Text/autocomplete maxima and disclosures
use the period book, and agent charges use its credit conversion. Historical
operation books remain valid for reservation/recovery/settlement. Text-only legacy
v1 periods deterministically map to the archived narration v1 book; first prior
image/agent operations retain their pins. Lazy envelope materialization changes
no grant or credit counters. No remote schema or data migration occurred.

Narration quotation, consent and reservations use the same period book, final
maximum and period/revision identity. Paid retries retain operation caps and
supplier cost remains separate. A provider-free `SavedNarrationReader` supplies
account-owned snapshots and cached/historical audio after current document-access
checks. Reads never execute or recover generation, resolve provider keys, reserve,
reconcile or debit. Edited/oversized documents, missing generation, revoked Pro,
and later empty failures preserve saved recordings and useful parts. Current
document deletion/revocation and cross-account operation IDs still deny delivery.

Evidence is `/tmp/lexidraw-276-implementation/291-narration-spec-fixes-v1.json`
and its `291-narration-spec-evidence/` logs. Actual red/green cycles cover saved
job reads without an executor, rate update/renewal and historical recovery,
image/agent adapter updates, agent credit conversion, published text maximums,
oversized edits, hidden older recordings, retained later cached parts and native
historical-quote restore. Fresh env-free, network-closed Bun fixtures exercise
authenticated operation boundaries and real SQLite accounting. Explicit web and
native shared TypeScript checks and focused Swift contracts are recorded in the
manifest. A synthetic loopback UI host mounts the production web panel and native
composer/player: both restore prior audio after edits with generation absent and
eligibility revoked, native playback and browser media time advance, and current
access revocation removes audio delivery. No new ledger entry or provider call is
caused by saved playback. Silent fixtures prove media plumbing only.

S3 now has the local implementation and evidence below. #291 and #276 remain incomplete.
Actual provider/account/model/quality/metering, payment/store verification, hosted
workflow/media durability, physical audio/lock-screen/interruption and release
criteria remain unverified. No push, merge, PR edit, cloud CI/build/preview/deploy,
production API/payment write, real private-store call, release preparation or
remote migration was performed. Existing draft PR292 remains untouched.


## S3 source-selected chat migration (local implementation, external proof pending)

Starting at `31fa631a37007d3d020fc336a211f43c709bfc67`, chat now has one
portable CHAT contract shared with the native JavaScriptCore bundle. It preserves
saved text turns and document context, accepts at most two bounded UTF-8 text
attachments, and rejects tools, PDF, images, audio, unsupported message content
and oversized requests before a paid dispatch. It does not truncate conversation
history silently. Legacy settings/history and saved recordings remain intact.

The web composer and native document Chat surface show the selected source,
capability messaging, safe partial output and Stop. Native account changes clear
the displayed conversation before authentication, retaining the prior account’s
stored history without exposing it on authentication failure. Pro uses reviewed maximum
quotes, unchanged-input/period/rate acceptance, account entitlement and the shared
ledger's concurrency, spend, retry and uncertainty fences. Replays retrieve the
existing result without paid dispatch. Lost acceptance responses get one bounded replay of the same reservation key to
recover its ID for cancellation, never a repeated provider request. Confirmed
internal retries are absorbed;
completed cancellation charges once in the accepted period; unknown outcomes stay
reserved for reconciliation. Browser/native OpenRouter transports attach the single
device key only at the exact provider endpoint, reject redirects, stream actual
SSE deltas and guard cumulative wire/output, withholding incomplete tokens before
publishing. Native local chat streams Apple Intelligence response snapshots, with
capability checks and no cloud fallback or credit debit. Credential material never
enters the native shared task request.

Evidence and exact commands are in
`/tmp/lexidraw-276-implementation/291-chat-migration-v1.json`. Fresh local contracts
cover shared preparation, source ports, credential echoes/encoded egress, Pro
quotes/authentication/period changes, cancellation/retry/replay and web/native
callbacks. T3 loopback browser and a leased pooled simulator demonstrate the actual
web composer/context and native chat view with saved turns and provider partial
output. These are injected provider/UI fixtures, not real provider proof. Native
Pro API contracts and server accounting contracts complement those UI checks.

Production Pro and direct-provider chat remain unavailable until separately
authorized provider/model/streaming/usage bounds are verified. Native local chat
is offered only when the actual OS/model/locale reports support; deterministic
local model tests do not prove supported physical hardware quality. Actual
provider/CORS, shared hosted execution/restart durability, account/payment/store,
physical audio/lock-screen/interruption, staged migration messaging and release
requirements remain open. This migration does not complete #291 or #276 and does
not authorize a release or amend their scope.

## Standards V2 and terminal chat failure follow-up (local)

The follow-up starts at `9f3eaf92c1c2219d848c075dd80a24ebe61b7677`.
S7 query access now distinguishes disabled, loading, error (including failed
refreshes with cached data), and ready before deriving new-generation
availability. Chat has no default provider while preference is unknown. Image,
device narration, Pro text, suggestions and AI Power expose query retry. Failed
reads block new generation while retaining chat history, completed images,
recording playback/sync and active operation controls. Device narration retains
its account/document controller across capability refreshes. S8 uses the existing
file-capable design-system Input with the same accessible label and form props.
J2 native chat uses associated-value events with required, bounded payloads and
all six legitimate operation states. Unknown/malformed events and content after
terminal completion fail closed; valid partial completion and cancellation remain
covered locally.

Spec V2-S1 validates failed/incomplete terminal response status, bounded identity
and usage (including cached-token consistency) before recording technical failure.
Response identities must agree when a creation event was supplied. Validated
provider error events belong to the authenticated redirect-free request stream;
no raw supplier diagnostic is returned. Known terminal failure refunds the whole
customer operation after partial output, without automatically retrying. Measured
supplier cost remains recorded; missing usage leaves supplier exposure unresolved
independently of the refunded customer reservation. Malformed terminal evidence
and disconnects without terminal evidence remain uncertain and reserved.

Exact RED/GREEN and focused local checks are in
`/tmp/lexidraw-276-implementation/291-standards-fixes-v2.json`. No external
provider, payment, bucket, production API or release action is claimed.
#291 and #276 remain incomplete pending parent review and remaining implementation
and acceptance work. Spec V2-S2 supplier cost-book exposure/bounds/dispatch is the
next sequential implementation scope. D2 operation-bound sandbox/delegation and
D3 first-use image/agent rate books remain partial implementation requirements,
not merely external proof gaps. Previously recorded provider, payment/store,
hosted durability, physical audio, migration and release criteria remain open.


## Supplier attempts and complete period schedules (local V2-S2 / D3)

The sole-writer follow-up from `4254fe7091cf2a9c14bade533dd6fe762aff840a`
separates the customer period/accepted-operation book from the supplier dispatch
contract. Before each paid fence the ledger resolves a server-configured,
verified supplier book (or an explicit synthetic injection for an owner test
period). It derives the maximum from the exact model, token/audio/image/tool
caps and rates, checks safe integer arithmetic and known plus unknown paid
exposure, and atomically stores the attempt with its immutable contract in the
existing append-only audit table. No schema or remote migration was run.
Adapters select models and supplier costs from the durable authorization result;
a supplied context cannot override that result. Text, autocomplete and chat,
narration, image, and agent phases validate terminal usage/cost and historical
recovery against their own attempt contract. Missing invoice evidence remains
unknown supplier exposure, including after successful delivery or a customer
refund. Invalid invoice evidence on a confirmed technical failure cannot prevent
the customer refund. Invoice reconciliation remains bounded by the admitted
contract. Known archived dispatch contracts can recover old attempts; unknown or
corrupt contracts fail closed without a paid replay. Historical chat used its
operation book for dispatch while saving the compiled v1 ceiling; recovery
reconstructs that known dispatch contract and materializes its corrected supplier
exposure under the accounting lock. Historical text/autocomplete instead map to
their original compiled supplier configuration. Customer books and grants do not
change.

`period-rates-v2` snapshots the full configured customer schedule at period
creation and renewal. Image/agent fields explicitly distinguish `available` with
a complete book from `unavailable`. Availability requires a configured supplier
contract as well as customer rates; synthetic schedules require an owner test
period. A later quote or adapter does not add or reprice a feature in the same
period. Legacy text-only v1 periods retain the archived narration v1 mapping;
legacy v1 envelopes preserve already-pinned feature books. Where a legacy feature
has no pin, its first existing accepted operation supplies the historical book;
without that evidence it stays unavailable. Materialization changes only the
period schedule, not its grant, credit counters or accepted operation books.
Accepted historical work remains recoverable even when a later period is
unavailable.

Evidence is `/tmp/lexidraw-276-implementation/291-supplier-cost-contract-v1.json`.
Recorded RED/GREEN cycles include authenticated raised supplier dispatch,
first-quote period pricing, corrupt saved narration exposure, rejection of a
supplied dispatch contract, technical-failure refunds with invalid invoice
evidence, and text/autocomplete output-cap alignment. Fresh env-free,
network-closed SQLite/injected suites additionally exercise lower supplier rates,
missing invoices and cost circuits, durable recovery after supplier updates,
higher-cost narration/image/agent results, renewal and unavailable periods, and
legacy mapping. Web and native shared TypeScript checks are local. No UI or
physical-device acceptance is claimed: production generation gates remain closed
and no Swift or bundled device-generation behavior changed.

D2 operation-bound sandbox/delegation is the next sequential implementation
scope. Standalone denied routes do not fulfill that requirement. #291 and #276
remain incomplete pending that work, independent review and the previously
recorded provider, payment/store, private-storage, hardware, hosted durability,
migration and release proofs. This follow-up makes no external calls, changes no
PR, and authorizes no release.

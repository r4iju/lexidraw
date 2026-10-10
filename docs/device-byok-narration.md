# Device OpenRouter narration (#286)

Production generation is **unavailable**. This implementation supplies the portable core, direct device transport, durable local progress, private completed-recording sync, and production web/iOS controls. It does not establish actual provider access or authorize a paid preflight. Public Pro remains Coming soon. No narration generation, sync, or playback in this path debits Pro.

## Provider evidence and gate

Checked through the approved default public-documentation route on 2026-10-10:

- [OpenRouter TTS documentation](https://openrouter.ai/docs/guides/overview/multimodal/tts) documents `POST /api/v1/audio/speech`, raw audio bytes, explicit voice, delivery instructions, and `pcm` or `mp3`. This is distinct from the streamed chat audio API.
- [Speech model metadata](https://openrouter.ai/api/v1/models?output_modalities=speech) lists `google/gemini-3.8-flash-lite-tts`, text input and speech output, Kore, and price fields prompt `0.0000005` and completion `0.000006`. These metadata values alone do not prove a complete billable bound for an actual speech request.
- The model endpoint metadata URL was unavailable through the approved route. No alternate network route was used.

One reference configuration is encoded: that model, Kore, faithful natural delivery instructions, PCM. There is no model selector or silent fallback. The injected fixtures interpret PCM as mono 24 kHz, signed 16-bit little-endian audio; actual OpenRouter response format must be verified before enabling generation. The public evidence does not prove an enforceable provider output cap, actual account access, or complete usage/pricing behavior. Local byte/time caps stop local consumption but do not cap provider billing.

The server capability is false, browser session transport defaults off, native transport defaults off, and the native production flow defaults off. Only test-owned injected transports enable fixture generation. There is no production key/flag bypass. The existing private Pro narration factory remains disabled.

## Device execution and persistence

The shared TypeScript core prepares text, plans chunks, constructs the reference speech request, and validates/processes audio. Native JavaScriptCore uses the same bundle. Native credentials remain in the native runtime and are attached immediately before direct URLSession dispatch, outside serialized JavaScript jobs. Web credentials are attached immediately before direct browser dispatch. Provider requests never traverse Lexidraw workers, app upload APIs, or Pro execution.

Input is bounded to 6,000 UTF-8 bytes, at most eight parts of 500 Unicode code points. Each part has one dispatch and no automatic provider retry. The local request timeout is 180 seconds; fresh generation/resume is limited to twenty minutes from job creation. PCM consumption is capped at 5,760,000 bytes per part (120 seconds under the fixture format). Only canonical WAV output without extra chunks, metadata, compression, or envelopes is accepted.

IndexedDB and protected, backup-excluded native files hold account/document-scoped checkpoints and confirmed audio. A compare-and-swap fence is persisted before dispatch so concurrent controllers cannot silently create duplicate paid jobs. Removal/replacement and account lifecycle are checked again immediately before dispatch. Resume re-establishes current key availability. Removal prevents future requests; confirmed completed audio remains available for playback and sync.

A started request recovered after interruption becomes unknown. It may have been billed and is never automatically repeated. A late confirmed response can resolve that original fence without another dispatch. Validated original output can also be reconciled through the flow's explicit confirmation API; there is no automatic retrieval or user-facing provider recovery service. This is not an exactly-once provider billing guarantee.

Retired credential fingerprints are irreversible detectors, persisted with checkpoints so old opaque credential echoes remain rejected after reopening. Raw/encoded nested credential material, provider configuration envelopes, compressed payload signatures, metadata and errors are guarded before persistence, upload and app egress. Generic server detection supplements device-specific retired-key checks. Errors shown to users are fixed text. The implementation does not promise detection of arbitrary ciphertext or steganography; supported output containers are deliberately restricted.

Logout/account replacement clears local account checkpoints and invalidates the native runtime. Browser/page or app suspension, shutdown, or process termination can interrupt generation. Background audio playback capability is separate from generation; no background generation guarantee is made.

## Completed artifact sync and replay

Only a fully completed, validated, key-free recording is accepted by authenticated `deviceNarration.save`. The server independently checks document edit access and permitted document/URL type, canonical audio, aggregate text/size bounds, account quota (ten recordings and 100 MiB), immutable content hash, account-scoped idempotency, ten-minute upload expiry, and atomic concurrent finalization. Recording grants have a distinct `recording_upload` type and are never provider keys. Expired pending grants are abandoned and their payload cleared. Retrying an expired upload rotates only its upload identity.

Completed private recordings live in the authenticated database, not a public blob URL. Saved lookup requires authenticated account scope and document read access. Sync failure keeps completed local audio; retry works without a provider key and makes no provider call. Another signed-in keyless device can replay the saved recording for free. Migration `0026_generated_recordings.sql` is supplied; no remote migration was run.

The actual web ListenPlayer mounts the device controller and saved audio controls. The actual native ListenViews mounts the composer, and Listener/Session route saved device audio through existing native media and player controls. The production controls remain gated even though saved playback is available.

## Local evidence

Red/green logs and UI evidence are under `/tmp/lexidraw-276-implementation/286-*`; the result manifest lists exact checks and provenance. Boundary coverage includes device interception, removal before future dispatch, old-key echoes after recovery, account/logout scope, concurrent checkpoints/finalization, unknown and late-confirmed outcomes, private keyless replay, and upload retry without regeneration. Existing BYOK and Pro ledger/narration tests are included.

Web verification mounts the production controller/view with durable IndexedDB and the actual authenticated upload router against isolated SQLite; only the provider transport is injected. Native BrowserHarness mounts the production composer and Listener with an injected URLProtocol provider and the same private upload fixture. These are fixture journeys, not proof of real provider service or a full authenticated production deployment.

Physical iPad lock, route and interruption verification remains #291. Simulator playback observations are reported separately and do not prove physical background playback or durable background generation.

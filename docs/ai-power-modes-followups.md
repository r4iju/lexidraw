# AI Power Modes release follow-ups (#294)

Integration branch: `feat/294-release-followups`, based on shipped master
`af05908f9281f2c27392230305a422a004a37d92`. The original ticket dependencies
remain in #277–#291; integrated implementation permits local follow-up work,
but does not turn the outstanding external acceptance cases into passes.

## Local verification

Commit `8ab4e8aa` replaces workstation recovery-directory imports in the
saved-recording and two-save conversion checks with declared current Lexical
packages. The database fixture uses temporary directories. Its independent
payload and retained-row expectations remain intact. Explicit TypeScript peer
dependencies keep the editor and node constructors in the same runtime.
Existing fixture types now satisfy strict checking without suppressions.

Local checks: 70 focused document/recording/autocomplete checks, two conversion
checks, and the final 53-check document-payload rerun passed. The full web
`test:ts` passed after shared packages were built and stale incremental output
was cleared. These checks cover local persisted edits and key-free saved-recording
rendering; they do not establish hosted storage or physical playback acceptance.

## Acceptance frontier

| Workstream | Prerequisite | Completion evidence still required |
| --- | --- | --- |
| Hosted persisted content | Disposable hosted data tested; remaining artifact storage/playback setup | Save/reopen documents and drawings, saved recording delivery and second-device playback through the deployed clients |
| Provider output/cost/recovery | Account/budget approved; working credential and verified model contract | Actual browser/native/provider access, parameters, representative output, complete usage and uncertain-outcome recovery |
| Native speech and local text | Phone available; candidate build and physical control path | Background/lock-screen speech, route changes, interruptions, controls and supported Apple Intelligence behavior |
| Web Sandbox billing | Configured Stripe Sandbox and approved tester | Actual checkout/portal, renewal, restore-equivalent account state and verified event lifecycle |
| Apple Sandbox billing | Configured subscription product and Sandbox tester | Actual purchase/restore and notification lifecycle with the shared allowance |
| Previously excluded integration domains | Scope resolution for the historical review exclusions | Independent source review of those domains; old test-first gaps remain historical facts |

Paid agent search additionally requires existing-customer Google Custom Search
access and a migration decision before its January 1, 2027 discontinuation;
see [provider costs](ai-provider-costs.md#paid-search-availability).

Public Pro remains Coming soon with purchases disabled. Provider fixture
responses, Simulator runs and mocked transactions are not substituted for
external acceptance. The released web and Internal TestFlight build are unchanged
by these local test/documentation repairs.

## Queue tracing disposition

No queue configuration change is needed. The released Linux artifact bundles
and traces the queue code in the relevant workflow/cron/tRPC chunks. The local
development handler import is removed from the inspected production chunk.
The final production log contains no queue warning, and its artifact verifier
recorded 2,794 external references with none missing. This packaging evidence
does not claim a live workflow completion.

## Hosted and external observations

The owner authorized any existing account and a US$5 maximum total provider
budget. Disposable hosted document creation, append, reread and PNG rendering
passed, preserving English, Japanese and emoji. Drawing creation, reread and
PNG rendering passed. Drawing replacement returned HTTP 500 on the shipped
release. A local regression reproduces the document-root parser rejecting the
Excalidraw array. The drawing route now uses an array-preserving store with
revision comparison and thumbnail notification retained. Its regression passed
and full web types passed; this repair has not been deployed.

The OpenAI preflight produced no successful output: the release configuration
value was unsuitable and a distinct existing development credential returned
401. Two tiny requests had no retries and reserved at most US$0.00672 combined;
no successful usage was reported. Output, usage and recovery acceptance remain
open until a working provider credential is configured.

The physical iPhone 14 Plus is connected and unlocked. Its installed app is
1.0 (12), with no TestFlight app installed; the physical target is unsupported
by the current T3 control session. No new-build narration or lock-screen result
is claimed. This hardware also cannot establish supported Apple Intelligence
acceptance. Candidate installation/control and route-change/interruption
operation remain prerequisites.

Stripe/Apple dedicated Sandbox environment variables are absent from the
inspected configuration. App Store Connect has no subscription groups and no
Sandbox server-notification URL. Apple purchases require the separately opted-in
physical DEBUG Sandbox build; normal TestFlight build 13 does not supply that
build flag. No purchase, configuration change or entitlement grant was made.

Original review exclusions and historical test-first gaps remain unresolved;
these narrow repairs do not claim review of the complete original integration.

## Review and editor disposition

Independent Standards and Spec reviews of `af05908f...6c4cf4d3` found no new
implementation defect. Their incomplete-acceptance findings above remain open.
Two existing ordinary editor regressions (deferred caret after blur and an
outside-focus update) passed at `6c4cf4d3`, with 17 assertions. No new editor
patch or test backfill was justified. Matching mounted lost-submission recovery
remains unverified within the permitted scope.

All account/budget authorization recorded above persists; it is not requested
again. The remaining prerequisites concern working configuration, distribution
and available controls. The local drawing repair still needs a separately
approved release before its hosted update can be rechecked.

## Successful OpenRouter text preflight

One actual `openai/gpt-4.1-mini` request through OpenRouter returned HTTP 200,
with coherent concise English/Japanese output, 40 input tokens and 26 output
tokens. Independently calculated US$0.0000576 exactly matched its reported
cost. There were no retries or provider fallbacks. All three provider attempts
(including the rejected OpenAI attempts) conservatively reserved US$0.0084608,
well within the US$5 cap. This uses an existing app-owned development credential
for supplier verification; it does not prove browser/native BYOK credential
custody or enable any capability gate.

The hosted disposable documents/drawings were moved to trash after their
responses and rendered artifacts were retained locally. Existing user content
was not edited.

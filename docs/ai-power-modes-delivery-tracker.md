# AI Power Modes delivery tracker (#276)

This tracker applies to the **whole spec and project**, issues #277–#291, rather
than only the current Store verification task. The requirements remain those in
[the spec](ai-power-modes-spec.md). Historical implementation evidence and gaps
remain in [the integration audit](ai-power-modes-integration-audit.md).

## Execution policy

- Parallelize every independent implementation, investigation, review, and
  verification workstream across the entire dependency graph.
- Use GPT subagents or the primary GPT agent. Do not use Claude agents.
- Claim each task once. Keep one repository writer when agents share the checkout;
  use disjoint external evidence directories for concurrent preparation work.
- Run Spec and Standards reviews independently in parallel after their input is
  fixed. Run independent checks concurrently; order dependent edits and checks.
- Recompute the ready frontier after integration. A completed worker does not
  unblock dependent tickets until its result is inspected and integrated.
- Keep progressing on independent ready work while another task is blocked. State
  the specific prerequisite when work cannot run in parallel.
- Preserve failed evidence. Distinguish implementation, static review, observed
  behavior, and deployment. Do not mark the whole project complete from a bounded
  check or a worker's completion notification.
- Keep existing scope and release constraints. This policy does not authorize
  external provider/payment calls, cloud CI, pushes, merges, or deployment.

## Current state

Recorded 2026-10-13. Integration branch: `feat/276-ai-power-modes`, code checkpoint
`49d0c121` (React Compiler repair). Store evidence remains pinned to the
unchanged protected sources at `639f6cba`. **Incomplete and unshipped.**

| Workstream | Verified state | Next prerequisite |
| --- | --- | --- |
| Save-hook/content preservation | Two edits and saves, latest settings, exact preserved bytes, and fresh headless reopens verified by both evidence reviews | Retain qualified acceptance; original post-run reporter STOP remains recorded |
| Summary reporter | Replacement code and integration coverage passed both static reviews | Integrate into a future complete package before execution; no retroactive reset of old evidence |
| Saved audio in rich documents | Fixed in `e63fd17f`; 28 tests pass; final independent Spec and Standards reviews resolve the original P1 finding | Hardware/player and full-ticket acceptance remain pending |
| Store/content persistence | Both v21 static reviews passed; the runner stopped before any verification phase on capture-directory setup; redundant v22 preparation stopped with partial work preserved | Prioritize direct genuine Store behavior; no further bundled-harness rebuild/review loop planned |
| Direct-source Store verification | v7 passed: three Store constructions, two headless edits, two writes, two fresh reopens, 18 SQL callbacks and 154 matching comparisons; only the DDL-backed fixture metadata expectation was corrected | Selected present-row content-preservation path verified; missing-row, historical conversion, default media and whole-ticket acceptance remain open |
| Autocomplete scalar boundaries | Prompt boundaries fixed in `7dbc7ab8`; output clipping fixed in `d24c3965` with RED then 3 passing tests; final independent reviews resolve the original finding | Whole #277 acceptance remains pending |
| Shared pure-text contracts | Nine frozen cases and both independent GPT evidence reviews passed for ordinary AC2/AC4 subset | Bounded evidence accepted; assembled configuration, adapters, visible editor behavior, and whole #277 remain unverified |
| Pure autocomplete request preparation | Four frozen cases passed; parent reviewed source, frozen expectations, raw outputs, launch records, and all seven matching byte-copy pairs after both delegated reviews were cancelled | Bounded pure assembly evidence accepted; no adapter, provider, visible-editor, or whole #277 acceptance |
| Editor obligations | Focus admission fixed in `c7066ad7`; genuine RED then two passing focused tests, refocus behavior and separate deferred-blur check passed; missing `and` import fixed in `e76860d3` | Drizzle declaration repair active; lost-submission adapter disposition and whole-editor acceptance remain pending |
| Whole-spec reconciliation | GPT reconciliation complete: 114 child criteria, 62 overlapping parent stories, and 26 dependency edges accounted for | All tickets remain open; root #277 whole-contract acceptance and product obligations remain beyond the Store subset |
| Local shipping checks | Latest production web types and isolated Next webpack compile passed; offline iOS build passed; final Spec and Standards reviews accept the local repairs with no blocking findings | Full prerender, provider/device/payment/hosted acceptance, excluded review coverage and BYOK `Inflate`/queue warning disposition remain pending |

The autocomplete repository writer and focused independent review are finished.
The selected direct Store verification, focused editor repair and native build passed.
The local repair reviews passed; their fixed scope does not cover the original
initiative. The local repair phase is complete and no delegated task remains active.
**Shipping decision: no-go for the full public release.** Full prerender,
provider/device/payment/hosted acceptance, excluded original-base review coverage,
and the BYOK `Inflate`/queue warnings remain open. The successful isolated compile
is compile-only evidence. No push, PR, merge, deployment or release occurred.
Public Pro remains Coming soon and purchases remain disabled. Following the user's
time constraint, no further exploratory or harness review loops are planned.
Redundant bundled-harness
preparation was stopped following the user's time constraint. Independent product
checks should continue in parallel where they can establish acceptance. Shared pure-text observation
and both evidence reviews are complete as bounded evidence. Shipping-check planning, requirements
reconciliation, editor investigation, and root #277 acceptance preparation are
complete as reports, without completing their tickets.
Future tracker updates must reflect their inspected results, not assume success.

## Reconciled requirement frontier

The recovered child bodies contain **114 criteria across 15 tickets** and **26
blocking edges**. The 62 parent stories overlap them and are not an additional
progress denominator. No ticket is currently accepted as complete.

Original dependency order:

| Ready after accepted prerequisite | Successor workstreams |
| --- | --- |
| Root #277 | #278 |
| #278 | #279, #280, #281, #282 in parallel |
| #279, #280, #282 | #283 |
| #279 and #280 | #284 |
| #280 | #285, #289, #290 in parallel |
| #279 | #286 |
| #284 | #287 and #288 in parallel |
| #281–#290 listed predecessors | #291 |

Existing implementation and bounded verification can be inspected in parallel;
the table governs whole-ticket acceptance rather than forcing already available
work to be repeated. Root #277 still needs its full tracer, portable contract,
compatibility, and visible-behavior evidence reconciled. Store acceptance credits
only the document-preservation subset of #291.

The audit also queues concrete app obligations: deferred editor blur, lost
submission handling, period quote floor, production-router/ledger autocomplete
acceptance, and narration recovery/resume with actionable unknown outcomes and
native continuation UI. Their exact current contracts and repair dispositions
must be recovered before assigning fixes; compact audit entries do not establish
that code is absent or correct. Restricted domains remain pending under the
existing scope, rather than being silently treated as complete.

The exact criterion-by-criterion matrix and evidence index are in
`~/.ai/working/lexidraw-276-recovery/evidence/remaining-requirements-reconciliation-gpt-v1/matrix.json`.
Historical test-first/process gaps remain separate from current product gaps:
do not invent past RED evidence or rerun accepted content checks solely to repair
chronology.

Root #277 investigation identified a concrete pure-content defect:
`autocompletePrompt` slices UTF-16 context at fixed offsets and can leave an
unpaired surrogate when an emoji crosses either boundary. The assigned repair
must observe a new failing contract before changing code, preserve the existing
3000/600 code-unit budgets, and leave ordinary ASCII and intact emoji unchanged.
This new repair does not establish the original #277 test-first chronology or
complete its visible tracer and adapter-parity acceptance.

## Planned final local checks

The inspected shipping plan identifies **Lexidraw and iOS** as the baseline final
build scope. Renderer and code-runner require checks only if their inputs differ
from their actual last release or their separate release-tooling changes are
deliberately included. The commands below are planned, not executed.

| Gate | Planned command or prerequisite |
| --- | --- |
| Shared outputs | Build the affected apps' workspace dependencies once; do not run overlapping builds against the same outputs concurrently |
| Explicit types | From the repository root: `bun --no-env-file run --cwd packages/types test:ts`, `bun --no-env-file run --cwd apps/lexidraw test:ts`, and `bun --no-env-file run --cwd apps/ios test:ts` |
| Changed behavior | Select relevant deterministic local suites from the reconciled acceptance matrix; avoid unfiltered root test commands that load `.env.test` |
| Web build | `bun --no-env-file run --cwd apps/lexidraw build:app`, after inspecting its build closure and supplying an admitted local configuration |
| Native bundles | From `apps/ios`: `bun --no-env-file run build:reference` and `bun --no-env-file run build:generation` |
| Native verification | Relevant Swift/fuzz checks and an unsigned generic iOS Simulator build; inspect composite scripts before running them |
| Final review | Independent GPT Spec and Standards review of the entire integrated diff, plus `git diff --check` |

Both Next configurations ignore TypeScript build errors, so a successful build
does not replace explicit type checks. Device/UI checks retain the pooled-device
and existing authorization requirements. Renderer font fetching is outside the
current offline scope. No production environment files are needed for this plan.

Release preparation remains a separate stage. The inspected helper includes a
settings pull and can prerender application services even though it does not
upload; it must not be used as an ordinary offline test. Committed HEAD still has
PR-triggered workflows and lacks the working tree's deployment suppression.
Inspect actual remote side effects before a push, PR, or merge.

Full source-grounded command details and prerequisites are in the local evidence
report `~/.ai/working/lexidraw-276-recovery/evidence/local-shipping-checks-gpt-v1/checklist.md`.

## Entire ticket scope

This matrix preserves the integration audit's distinction between local
implementation and remaining acceptance. It is not a claim that any external
criterion has been verified. Reconciliation will refine each row against the
original acceptance cases.

| Issue | Workstream | Outstanding acceptance or dependency |
| --- | --- | --- |
| [#277](https://github.com/r4iju/lexidraw/issues/277) | Shared account/source contract | Whole-initiative review and migration/release acceptance |
| [#278](https://github.com/r4iju/lexidraw/issues/278) | Web BYOK | Actual provider/browser access and representative output |
| [#279](https://github.com/r4iju/lexidraw/issues/279) | Native BYOK | Physical provider success and representative output |
| [#280](https://github.com/r4iju/lexidraw/issues/280) | Shared Pro ledger/text | Provider parameters, output/cost bounds, and hosted durability |
| [#281](https://github.com/r4iju/lexidraw/issues/281) | Local speech | Physical lock-screen, headphone, and interruption checks |
| [#282](https://github.com/r4iju/lexidraw/issues/282) | Apple Intelligence | Runtime availability and broader account integration |
| [#283](https://github.com/r4iju/lexidraw/issues/283) | Autocomplete | Actual provider access and quality |
| [#284](https://github.com/r4iju/lexidraw/issues/284) | Images | Model/output/cost acceptance and actual private-store configuration |
| [#285](https://github.com/r4iju/lexidraw/issues/285) | Pro narration | Voice/output/billing bounds and hosted media durability |
| [#286](https://github.com/r4iju/lexidraw/issues/286) | BYOK narration | Endpoint/format/cost acceptance and external recovery |
| [#287](https://github.com/r4iju/lexidraw/issues/287) | Pro agents | Provider/tool bounds, sandbox/delegation, storage, and workflow acceptance |
| [#288](https://github.com/r4iju/lexidraw/issues/288) | Device agents | Provider/tool quality, bounds, image prerequisite, and recovery |
| [#289](https://github.com/r4iju/lexidraw/issues/289) | Web Sandbox billing | Configured checkout/portal and actual Sandbox lifecycle |
| [#290](https://github.com/r4iju/lexidraw/issues/290) | Apple Sandbox billing | Configured product/API, purchase/restore/notification, and distribution |
| [#291](https://github.com/r4iju/lexidraw/issues/291) | Integration and preservation | Store observation, complete requirement reconciliation, final independent review, and remaining acceptance above |

External criteria remain pending under the existing authorization boundary.
Public Pro stays **Coming soon**, with purchases disabled. Completing private
implementation does not authorize public activation or live charges.

## Completion and shipping gates

1. Account for every acceptance requirement in #276 and #277–#291. Record the
   evidence, remaining gap, owner, and dependency for each unfinished item.
2. Integrate required product changes and resolve concrete correctness findings.
3. Complete the relevant local behavior checks, type checks, and affected-app
   builds. Run independent checks in parallel where inputs and resources allow.
4. Complete independent Spec and Standards review of the entire integration diff,
   not only the current evidence harness.
5. State explicitly which physical, provider, payment, and hosted criteria remain
   unverified. Obtain an explicit scope decision before calling incomplete
   requirements complete.
6. Prepare one batched final release following [local releases](local-releases.md).
   Pushing, merging, cloud execution, and deployment remain separate actions with
   their existing authorization requirements.

## Update protocol

After each inspected integration or acceptance result, update this document with
the checked code/evidence checkpoint, workstream status, concrete blocker, next
ready tasks, and currently parallel assignments. Keep historical failures and
qualification links intact. Do not report a percentage from overlapping evidence
milestones; use original acceptance requirements as the denominator once the
reconciliation is complete.

# Agent Workflow Migration: Client to Server Orchestration

## Status Summary

**Overall Progress:** 🟡 **~70% Complete** - Core workflow implemented, MVP functional, but missing multi-tool loop and reliability features

**Completed Phases:**

- ✅ Phase 1: Workflow Skeleton
- ✅ Phase 2: Streaming Infrastructure (SSE + Callback)
- ✅ Phase 3: Client Integration & UX
- 🟡 Phase 4: Orchestration Loop Details (MVP: single tool call only)
- 🟡 Phase 0: Preparation (Security partially implemented)
- ⏳ Phase 5: Reliability, Security, Observability
- ⏳ Phase 6: Testing
- 🟡 Phase 7: Hard Switch & Cleanup (main switch done, cleanup incomplete)

## Current Architecture

**Client-side orchestration** (`use-send-query.ts`, `llm-context.tsx`):

- Planner selection via tRPC (`api.llm.plan`) - ⚠️ Still used by `agent-helpers.ts` but planner now called server-side in workflow
- LLM calls via `generateText` from AI SDK (client-side) - ✅ Removed for agent mode
- Tool execution happens client-side via `runtime-tools-provider.tsx` - ✅ Still client-side (correct)
- Decision cycles (`handleDecisionCycle`) run client-side - ✅ Removed, replaced by workflow
- Chat mode streams via `/api/llm/stream` endpoint - ✅ Unchanged

**Key files:**

- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-send-query.ts` - ✅ Updated to use workflow hook
- `apps/lexidraw/src/app/documents/[documentId]/context/llm-context.tsx` - ⚠️ Still contains `generateChatResponse` (used by slide creation workflow)
- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/runtime-tools-provider.tsx` - ✅ Still client-side (correct)

## Target Architecture

**Server-side workflow orchestration** (Vercel Workflows + SSE):

- ✅ Workflow orchestrates planner/LLM/decisions server-side
- ✅ Stream LLM deltas and tool-call requests to client via `run.readable` (SSE over POST)
- ✅ Client executes editor-bound tools locally and POSTs results to a secure callback using a one-time hook token
- ✅ Only SSE and callback use route handlers; all other logic uses tRPC server callers (no HTTP)
- ✅ Chat mode remains unchanged (simple text streaming endpoint)

## Phase 0: Preparation (Tool Audit, Contracts, Security) 🟡 **Partial**

- ⏳ Inventory tools and classify:
  - Server-capable: external API/database/pure compute
  - Client-only: require Lexical/DOM/app state
- ✅ Define a uniform tool schema (shared, versioned):
  - `{ toolName, callId, params, result }` with Zod schemas per tool
  - ⚠️ No canonical "readDocument" tool yet (server relies on `documentMarkdown` snapshot)
- ✅ Conversation state contract:
  - Server plans using prior messages; when it needs fresh editor state, it uses `documentMarkdown` snapshot
- 🟡 Security and correlation:
  - ✅ Hook tokens are single-use, short-lived, signed; claims: `runId`, `toolCallId`, `userId`, `documentId`, `exp`
  - ⚠️ JWT validation exists but callback route has TODO about proper integration
  - ✅ Correlate everything by `{runId, callId}`; reject cross-doc results
- ⏳ Non-functional baselines:
  - ✅ One tool-call in flight at a time; server waits for callback before next decision
  - ⏳ Default client execution timeout (e.g., 60s); server aborts with error event on timeout
  - ⏳ Abort policy: Abort current run if user edits the document (or make editor read-only during run)
- ✅ Type & lint:
  - ✅ Shared types in `packages/types`; strict Zod validation
  - ✅ No `any`/`@ts-ignore`; Biome clean; React 19 `useEffectEvent` where deps differ

## Phase 1: Workflow Skeleton ✅ **Complete**

- ✅ `apps/lexidraw/src/workflows/agent/agent-workflow.ts` — `"use workflow"`
  - ✅ Signature matches plan (with additional `runId` and `originalPrompt` params)
  - ✅ Create `runId`, monotonic `eventId`, and NDJSON writer utility
  - ✅ For each tool call, create a `createHook<{ toolCallId: string; result: unknown }>()`; include `hookToken` in the emitted event
- ✅ Steps (`"use step"`):
  - ✅ `call-planner-step.ts`: Calls `planTools` server-side (no HTTP)
  - ✅ `call-llm-step.ts`: AI SDK server-side; returns text and tool-call descriptors
  - ✅ `decision-step.ts`: Implemented but not yet integrated into loop

## Phase 2: Streaming Infrastructure (SSE + Callback) ✅ **Complete**

- ✅ Start/stream route: `apps/lexidraw/src/app/api/llm/agent/route.ts`
  - ✅ `export const runtime = 'nodejs'`
  - ✅ POST; authenticate user and authorize `documentId`
  - ✅ Start: `const run = start(agentWorkflow, args)`
  - ✅ Return `new Response(run.getReadable<Uint8Array>(), { headers: ... })`
  - ⚠️ Uses `application/octet-stream` instead of `text/event-stream` (NDJSON format)
  - ⏳ On `request.signal` abort: cancel workflow and close writer
  - ✅ Heartbeats: `event: heartbeat` implemented
- ✅ Callback route: `apps/lexidraw/src/app/api/llm/agent/callback/route.ts`
  - ✅ `export const runtime = 'nodejs'`
  - ✅ POST; Zod-validate body; verify hook token and access to `documentId`
  - ✅ `await resumeHook(hookToken, { toolCallId, result })`; return 204
- ✅ Event framing (server emits):
  - ✅ `event: text-delta` → `{ id, runId, messageId, delta }`
  - ✅ `event: tool-call` → `{ id, runId, toolCallId, toolName, input, hookToken }`
  - ✅ `event: finish` → `{ id, runId, summary? }`
  - ✅ `event: error` → `{ id, runId, message, code? }`
  - ✅ `event: heartbeat` → `{ id, ts }`
  - ✅ NDJSON format (one JSON object per line) instead of SSE format

## Phase 3: Client Integration & UX ✅ **Complete**

- ✅ `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-agent-workflow.ts`
  - ✅ Use `fetch(POST)` and read the response `ReadableStream` (not `EventSource`)
  - ✅ NDJSON parser (handle split lines/chunks); dedupe on `{runId, id}`
  - ✅ On `tool-call`: map `toolName` → `runtimeTools`, execute with editor context, POST `{ hookToken, toolCallId, result }` to callback
  - ✅ On `text-delta`: dispatch UI updates
  - ✅ Cancel in-flight via `AbortController` when a new prompt starts
  - 🟡 UX: basic state management implemented; status indicators could be enhanced
- ✅ Update `use-send-query.ts`
  - ✅ Replace agent-mode orchestration with workflow hook; chat mode unchanged (`/api/llm/stream`)
- 🟡 Update `llm-context.tsx`
  - ⚠️ `generateChatResponse` still exists (used by slide creation workflow, may be intentional)

## Phase 4: Orchestration Loop Details 🟡 **MVP Only**

- 🟡 Loop (Current: MVP handles ONE tool call, then finishes):
  - ✅ planner → allowed tools
  - ✅ llm step → stream deltas + collect tool calls
  - ✅ for each tool call (currently only first):
    - ✅ emit `tool-call` with `hookToken`
    - ✅ `await hook` for `{ toolCallId, result }`
    - ✅ append tool result to `messages`
  - ⏳ decision → `planNext` or `summarize` (decision-step exists but not integrated)
  - ✅ on summarize → finalize, emit `finish`, close writer
- ⏳ Abort-aware:
  - ⏳ Forward `AbortSignal` to steps and LLM calls
  - ⏳ Cancel run on user-initiated cancellation or editor conflict (per policy)

**Current Limitation:** Workflow processes exactly one tool call per run, then finishes. Decision step exists but is not integrated into the loop for multi-tool scenarios.

## Phase 5: Reliability, Security, Observability ⏳ **Pending**

- ✅ Idempotency & duplicates:
  - ✅ Client dedupe by `{runId, id}`; server emits monotonic `eventId`
  - ✅ `resumeHook` is idempotent per `{runId, toolCallId}`; duplicates return success without re-triggering
- ⏳ Timeouts:
  - ⏳ Client tool execution timeout (e.g., 60s); server emits `error` with code `tool-timeout` and ends gracefully
  - ⏳ Workflow overall timeout guard (e.g., 5–10 min) with a user-facing error event
- ✅ Authorization:
  - ✅ Verify `userId` can access `documentId` on start and callback; reject cross-doc results
- ⏳ Rate limits:
  - ⏳ Per-user rate limit on start and callback routes to mitigate abuse
- 🟡 Logging/metrics:
  - 🟡 Basic console.log statements; include `runId` in some logs
  - ⏳ Traces around planner, LLM, and each tool-call lifecycle

## Phase 6: Testing ⏳ **Pending**

- ⏳ Unit:
  - ⏳ SSE parser (split frames, back-to-back events, malformed recovery)
  - ⏳ Hook token sign/verify and single-use semantics
  - ⏳ Planner via server caller
- ⏳ Integration:
  - ⏳ Mock LLM streaming + tool-call emission; verify sequence and callback resume
  - ⏳ Duplicate callback deliveries; ensure idempotent behavior
- ⏳ E2E:
  - 🟡 Happy path with single tool (MVP works)
  - ⏳ Network drops (client or server) → ensure no duplicate tool executions
  - ⏳ Editor-change cancellation behavior
  - ⏳ Timeouts (client tool runs too long) → user-facing error event

## Phase 7: Hard Switch & Cleanup 🟡 **Partial**

- ✅ Hard switch: agent mode uses workflow + SSE exclusively
- ✅ Removed client-side agent orchestration (`handleDecisionCycle` removed)
- ⚠️ `generateChatResponse` still exists but is used by slide creation workflow (may be intentional)
- ✅ `/api/llm/agent` route implements SSE workflow
- ⏳ Simplify context types; remove dead code and toggles
- ⏳ Update docs/runbooks (ops + dev)

## Files to Create

- ✅ `apps/lexidraw/src/workflows/agent/agent-workflow.ts` - Created and functional
- ✅ `apps/lexidraw/src/workflows/agent/call-planner-step.ts` - Created and functional
- ✅ `apps/lexidraw/src/workflows/agent/call-llm-step.ts` - Created and functional
- ✅ `apps/lexidraw/src/workflows/agent/decision-step.ts` - Created but not integrated into loop
- ✅ `apps/lexidraw/src/workflows/agent/message-utils.ts` - Created (helper utility)
- ✅ `apps/lexidraw/src/app/api/llm/agent/route.ts` - Created and functional
- ✅ `apps/lexidraw/src/app/api/llm/agent/callback/route.ts` - Created and functional
- ✅ `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-agent-workflow.ts` - Created and functional
- ✅ `packages/types/src/agent-events.ts` - Created with Zod schemas

## Files to Modify

- ✅ `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-send-query.ts` — ✅ Updated to use workflow hook
- 🟡 `apps/lexidraw/src/app/documents/[documentId]/context/llm-context.tsx` — ⚠️ `generateChatResponse` still exists (used by slide creation workflow)
- ✅ Planner access via server caller — ✅ Implemented in `call-planner-step.ts` using `planTools` directly

## Key Findings & Next Steps

### What's Working ✅

- Core workflow infrastructure is functional
- MVP handles single tool call per run successfully
- SSE streaming (NDJSON format) works correctly
- Hook token security and callback mechanism implemented
- Client integration complete with proper error handling

### Critical Gaps ⚠️

1. **Multi-tool loop not implemented**: Workflow only handles one tool call then finishes. Decision step exists but not integrated.
2. **No timeouts**: Missing client tool execution timeout and workflow overall timeout guards
3. **Incomplete abort handling**: No `AbortSignal` forwarding to workflow steps
4. **Limited observability**: Basic logging only, no structured metrics/traces

### Recommended Next Steps (Priority Order)

1. **Integrate decision step into loop** (Phase 4) - Enable multi-tool scenarios
2. **Add timeout guards** (Phase 5) - Client tool timeout + workflow timeout
3. **Implement abort signal forwarding** (Phase 4) - Proper cancellation support
4. **Add comprehensive testing** (Phase 6) - Unit, integration, E2E tests
5. **Enhance observability** (Phase 5) - Structured logging, metrics, traces
6. **Rate limiting** (Phase 5) - Protect against abuse
7. **Final cleanup** (Phase 7) - Remove dead code, update docs

### Technical Notes

- Using NDJSON format instead of SSE format (simpler, works well)
- Hook token validation has TODO about JWT integration (callback route)
- `generateChatResponse` kept intentionally for slide creation workflow
- Planner called server-side directly (no tRPC HTTP overhead)

## Dependencies

- Workflows integration (`workflow/api`) present in `next.config.ts`
- AI SDK already used (`generateText`, `streamText`)
- Existing LLM config/proxy and tRPC router for planner

## Appendix: Type Shapes (concise)

```ts
export type AgentEvent =
  | {
      type: "text-delta";
      id: string;
      runId: string;
      messageId: string;
      delta: string;
    }
  | {
      type: "tool-call";
      id: string;
      runId: string;
      toolCallId: string;
      toolName: string;
      input: Record<string, unknown>;
      hookToken: string;
    }
  | { type: "finish"; id: string; runId: string; summary?: string }
  | { type: "error"; id: string; runId: string; message: string; code?: string }
  | { type: "heartbeat"; id: string; ts: number };

export interface ToolCallbackBody {
  hookToken: string;
  toolCallId: string;
  result: unknown;
}
```

- SSE frame format per event:
  - `id: <eventId>\n`
  - `event: <type>\n`
  - `data: <JSON string>\n\n`
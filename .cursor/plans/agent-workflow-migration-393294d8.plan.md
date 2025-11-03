# Agent Workflow Migration: Client to Server Orchestration

## Current Architecture

**Client-side orchestration** (`use-send-query.ts`, `llm-context.tsx`):

- Planner selection via tRPC (`api.llm.plan`)
- LLM calls via `generateText` from AI SDK (client-side)
- Tool execution happens client-side via `runtime-tools-provider.tsx`
- Decision cycles (`handleDecisionCycle`) run client-side
- Chat mode streams via `/api/llm/stream` endpoint

**Key files:**

- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-send-query.ts` - Agent orchestration logic
- `apps/lexidraw/src/app/documents/[documentId]/context/llm-context.tsx` - LLM client calls
- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/runtime-tools-provider.tsx` - Tool definitions (client-side, need editor context)

## Target Architecture

**Server-side workflow orchestration** (Vercel Workflows + SSE):

- Workflow orchestrates planner/LLM/decisions server-side
- Stream LLM deltas and tool-call requests to client via `run.readable` (SSE over POST)
- Client executes editor-bound tools locally and POSTs results to a secure callback using a one-time hook token
- Only SSE and callback use route handlers; all other logic uses tRPC server callers (no HTTP)
- Chat mode remains unchanged (simple text streaming endpoint)

## Phase 0: Preparation (Tool Audit, Contracts, Security)

- Inventory tools and classify:
  - Server-capable: external API/database/pure compute
  - Client-only: require Lexical/DOM/app state
- Define a uniform tool schema (shared, versioned):
  - `{ toolName, callId, params, result }` with Zod schemas per tool
  - Add a canonical “readDocument” tool for state reconciliation (server never assumes client state)
- Conversation state contract:
  - Server plans using prior messages; when it needs fresh editor state, it must call `readDocument` (or client can optionally provide an initial summary snapshot)
- Security and correlation:
  - Hook tokens are single-use, short-lived, signed; claims: `runId`, `toolCallId`, `userId`, `documentId`, `exp`
  - Correlate everything by `{runId, callId}`; reject cross-doc results
- Non-functional baselines:
  - One tool-call in flight at a time; server waits for callback before next decision
  - Default client execution timeout (e.g., 60s); server aborts with error event on timeout
  - Abort policy: Abort current run if user edits the document (or make editor read-only during run)
- Type & lint:
  - Shared types in `packages/types`; strict Zod validation
  - No `any`/`@ts-ignore`; Biome clean; React 19 `useEffectEvent` where deps differ

## Phase 1: Workflow Skeleton

- `apps/lexidraw/src/workflows/agent/agent-workflow.ts` — `"use workflow"`
  - Signature:
    - `agentWorkflow(args: { prompt: string; messages: ModelMessage[]; system: string; config: AgentConfig; userId: string; documentId: string })`
  - Create `runId`, monotonic `eventId`, and an SSE writer utility (writes `id:`, `event:`, `data:` + `\n\n`)
  - For each tool call, create a `createHook<{ toolCallId: string; result: unknown }>()`; include `hookToken` in the emitted event
- Steps (`"use step"`):
  - `call-planner-step.ts`: `appRouter.createCaller({ ctx })` to select allowed tools (no HTTP)
  - `call-llm-step.ts`: AI SDK server-side; stream `text-delta` via writer; return tool-call descriptors only
  - `decision-step.ts`: choose `summarize` vs `planNext` bounded by allowed tools

## Phase 2: Streaming Infrastructure (SSE + Callback)

- Start/stream route: `apps/lexidraw/src/app/api/llm/agent/route.ts`
  - `export const runtime = 'nodejs'`
  - POST; authenticate user and authorize `documentId`
  - Start: `const run = start(agentWorkflow, args)`
  - Return `new Response(run.readable, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, max-age=0, must-revalidate', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' } })`
  - On `request.signal` abort: cancel workflow and close writer
  - Heartbeats: `event: heartbeat` every 15–25s to keep the connection alive
- Callback route: `apps/lexidraw/src/app/api/llm/agent/callback/route.ts`
  - `export const runtime = 'nodejs'`
  - POST; Zod-validate body; verify hook token (single-use) and access to `documentId`
  - `await resumeHook(hookToken, { toolCallId, result })`; return 204
- Event framing (server emits):
  - `event: text-delta` → `{ id, runId, messageId, delta }`
  - `event: tool-call` → `{ id, runId, toolCallId, toolName, input, hookToken }`
  - `event: finish` → `{ id, runId, summary? }`
  - `event: error` → `{ id, runId, message, code? }`
  - `event: heartbeat` → `{ id, ts }`
  - Always include `id:` (monotonic per `runId`) and `\n\n` frame terminator

## Phase 3: Client Integration & UX

- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-agent-workflow.ts`
  - Use `fetch(POST)` and read the response `ReadableStream` (not `EventSource`)
  - Minimal SSE parser (handle split lines/chunks; support `event`, `id`, `data`); dedupe on `{runId, id}`
  - On `tool-call`: map `toolName` → `runtimeTools`, execute with editor context, POST `{ hookToken, toolCallId, result }` to callback
  - On `text-delta`: dispatch UI updates; handlers with `useEffectEvent`
  - Cancel in-flight via `AbortController` when a new prompt starts
  - UX: show agent status (“Assistant is editing…”), a cancel button, and tool activity indicators
- Update `use-send-query.ts`
  - Replace agent-mode orchestration with this hook; chat mode unchanged (`/api/llm/stream`)
- Update `llm-context.tsx`
  - Remove agent-only client LLM calls; keep chat stream and simplify context types

## Phase 4: Orchestration Loop Details

- Loop:
  - planner → allowed tools
  - llm step → stream deltas + collect tool calls
  - for each tool call:
    - emit `tool-call` with `hookToken`
    - `await hook` for `{ toolCallId, result }`
    - append tool result to `messages`
  - decision → `planNext` or `summarize`
  - on summarize → finalize, emit `finish`, close writer
- Abort-aware:
  - Forward `AbortSignal` to steps and LLM calls
  - Cancel run on user-initiated cancellation or editor conflict (per policy)

## Phase 5: Reliability, Security, Observability

- Idempotency & duplicates:
  - Client dedupe by `{runId, id}`; server emits monotonic `eventId`
  - `resumeHook` is idempotent per `{runId, toolCallId}`; duplicates return success without re-triggering
- Timeouts:
  - Client tool execution timeout (e.g., 60s); server emits `error` with code `tool-timeout` and ends gracefully
  - Workflow overall timeout guard (e.g., 5–10 min) with a user-facing error event
- Authorization:
  - Verify `userId` can access `documentId` on start and callback; reject cross-doc results
- Rate limits:
  - Per-user rate limit on start and callback routes to mitigate abuse
- Logging/metrics:
  - Log start/finish/error, tool latencies, token counts, timeouts; include `runId` in all logs
  - Traces around planner, LLM, and each tool-call lifecycle

## Phase 6: Testing

- Unit:
  - SSE parser (split frames, back-to-back events, malformed recovery)
  - Hook token sign/verify and single-use semantics
  - Planner via tRPC caller
- Integration:
  - Mock LLM streaming + tool-call emission; verify sequence and callback resume
  - Duplicate callback deliveries; ensure idempotent behavior
- E2E:
  - Happy path with multiple tools
  - Network drops (client or server) → ensure no duplicate tool executions
  - Editor-change cancellation behavior
  - Timeouts (client tool runs too long) → user-facing error event

## Phase 7: Hard Switch & Cleanup

- Hard switch immediately: agent mode uses workflow + SSE exclusively
- Remove client-side agent orchestration (`handleDecisionCycle`, agent-specific `generateChatResponse`)
- Replace `/api/llm/agent` stub with the SSE workflow route
- Simplify context types; remove dead code and toggles
- Update docs/runbooks (ops + dev)

## Files to Create

- `apps/lexidraw/src/workflows/agent/agent-workflow.ts`
- `apps/lexidraw/src/workflows/agent/call-planner-step.ts`
- `apps/lexidraw/src/workflows/agent/call-llm-step.ts`
- `apps/lexidraw/src/workflows/agent/decision-step.ts`
- `apps/lexidraw/src/app/api/llm/agent/route.ts`
- `apps/lexidraw/src/app/api/llm/agent/callback/route.ts`
- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-agent-workflow.ts`
- `packages/types/src/agent-events.ts` (types + Zod)

## Files to Modify

- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-send-query.ts` — replace agent logic with workflow hook
- `apps/lexidraw/src/app/documents/[documentId]/context/llm-context.tsx` — remove agent-specific paths
- Ensure planner access via server caller (e.g., `apps/lexidraw/src/server/api/routers/llm.ts`)

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
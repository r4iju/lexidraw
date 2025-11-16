<!-- 644cd3ad-e145-468b-9488-300c5e264f64 3834a612-a0df-4096-af1f-dca5757d9d28 -->
# Migrate Tool to Vercel Sandbox (Code Mode) — Production‑ready Plan

## Overview & Goals

Migrate one tool from client‑side execution to server‑side execution using Vercel Sandbox. This adopts the “code mode” pattern where tools run in isolated microVMs, improving safety for untrusted code while keeping the existing client tool flow intact for editor‑driven tools.

Success criteria:

- Server‑side tool(s) are executed inside Vercel Sandbox with clear timeouts and resource limits.
- Agent workflow runs server tools inline (no client hook round‑trip) while keeping the existing client tool hook flow unchanged.
- Strong typing everywhere (Zod + shared `@packages/types`), no `any`, no `@ts-ignore` (Biome stays happy).
- No ad‑hoc REST: use tRPC for any app‑facing API surface.
- Minimal impact to existing UI and client tool execution.

Non‑goals (for this iteration):

- Multi‑language support beyond Node.js.
- Persistent sandboxes/sessions.
- End‑user code editor UI.

## Tool Selection: `executeCode`

**Recommended tool**: Introduce `executeCode` as the migration candidate because:

- Clean, isolated functionality perfect for testing
- Clear demonstration of code mode pattern
- Safe to test without affecting existing document editing tools
- Useful functionality (code execution) that can be extended later

**Alternative**: If desired later, `extractWebpageContent` could be enhanced to run server‑side for more robust extraction (still within sandbox).

## Current Architecture Snapshot (repo‑specific)

- Agent workflow: `apps/lexidraw/src/workflows/agent/agent-workflow.ts`
- Emits `tool-call` events and waits on a workflow hook; the client executes tools and POSTs back to `/api/llm/agent/callback` with `ToolCallbackBody`.
- Tool registry: `apps/lexidraw/src/server/llm/tools/registry.ts`
- Defines `group: "client" | "server"` (currently all listed tools are `"client"`).
- Provides `getAvailableToolNames()` for planner and `getAiSdkToolMap()` for tool schema exposure.
- tRPC: `apps/lexidraw/src/server/api/root.ts`, with routers in `apps/lexidraw/src/server/api/routers/*`
- LLM routes exist in `routers/llm.ts`.
- Env: `packages/env/src/index.ts` typed via `@t3-oss/env-nextjs`.

This matches our desired pattern: server‑orchestrated agent with client‑executed editor tools via hook callbacks. We’ll add a server‑executed tool path without breaking the client path.

## Proposed Architecture Changes

### Current Flow (client‑executed tools)

1. Server workflow emits `tool-call` event with hook token
2. Client receives event, executes tool locally in browser
3. Client sends result via `/api/llm/agent/callback`
4. Workflow resumes with result

### New Flow (server‑executed tools in Sandbox)

1. Server workflow detects a `"server"` tool from registry.
2. Instead of emitting a `tool-call` hook, the workflow executes the tool server‑side.
3. The tool spins up a Vercel Sandbox, runs the code, collects stdout/stderr/exitCode, enforces timeout, and returns a structured result.
4. The workflow appends a tool result message and continues the loop (no client callback for this tool).
5. Client‑executed tools (group `"client"`) continue to use the existing hook/SSE flow unchanged.

## Implementation Steps

### 1) Install dependencies (apps/lexidraw)

- Add `@vercel/sandbox`
- Add `ms` (for readable timeouts) and `@types/ms`
- Ensure `@types/node` present

Note: Keep Node runtime (not Edge) for any code touching Sandbox SDK.

### 2) Create server‑side Sandbox service

File: `apps/lexidraw/src/server/llm/tools/code-execution.ts`

- Export `executeCodeInSandbox(args)`:
- Input: `{ code: string; language?: "node"; timeoutMs?: number; resources?: { vcpus?: number; memoryMbPerVcpu?: number } }`
- Behavior:
- Create sandbox via `Sandbox.create({ runtime: "node22", timeout, resources })`
- Write code to a temp file (e.g., `/tmp/main.mjs`) to avoid shell quoting issues
- Run with `["node", "/tmp/main.mjs"]`
- Capture `stdout`, `stderr`, and exit status; enforce timeout; dispose sandbox
- Output: `{ ok: boolean; stdout: string; stderr: string; exitCode: number; durationMs: number }`

Observability: logs/exit codes visible in Vercel Dashboard → Observability → Sandboxes.

### 3) Add tRPC endpoint for tool (no ad‑hoc REST)

Files:

- Add `apps/lexidraw/src/server/api/routers/tools.ts` with `protectedProcedure.executeCode`
- Register in `apps/lexidraw/src/server/api/root.ts` (e.g., `tools: toolsRouter`)

Details:

- Input schema via Zod, call `executeCodeInSandbox()`, return structured result
- This enables admin/manual tests; the agent workflow will call the service directly (no network hop required).

### 4) Add tool definition to registry

File: `apps/lexidraw/src/server/llm/tools/registry.ts`

- Add `executeCode` with:
- `group: "server"`
- Input schema: `ExecuteCodeSchema` (from `@packages/types`)
- Description: “Run short Node.js snippets in an isolated sandbox and return stdout/stderr.”

### 5) Update agent workflow for server tools

File: `apps/lexidraw/src/workflows/agent/agent-workflow.ts`

- On each toolCall:
- Look up tool group from registry by name
- If `group === "server"`:
- Append assistant `tool-call` message to the transcript (for traceability)
- Call a new helper `executeServerTool({ name, input, userId, runId })`
- Append tool result message to transcript
- Do NOT emit hook/SSE event for these
- Else (client tools): keep existing hook creation, `tool-call` event emission, and `/api/llm/agent/callback` flow
- Ensure the result shape is consistent (e.g., JSON object payload `{ ok, stdout, stderr, exitCode, durationMs }`)

### 6) Create server tool dispatcher

File: `apps/lexidraw/src/workflows/agent/execute-server-tool.ts`

- Export `executeServerTool(args)`:
- Switch on tool `name`, route to concrete server implementations
- For `executeCode`, call `executeCodeInSandbox()`
- Format output to the tool result structure the workflow expects

### 7) Environment setup (typed in `@packages/env`)

- Add optional vars in `packages/env/src/index.ts`:
- `VERCEL_OIDC_TOKEN?: string` (auto‑available on Vercel)
- `VERCEL_TOKEN?: string`, `VERCEL_TEAM_ID?: string`, `VERCEL_PROJECT_ID?: string` (for local/testing if needed)
- Document expected behavior:
- On Vercel, use OIDC by default
- Locally, set personal `VERCEL_TOKEN` if required by Sandbox SDK
- Add to `.env.local` for dev; keep optional to avoid breaking builds

### 8) Shared types (no `any`, no `@ts-ignore`)

Files:

- `packages/types/src/tool-schemas.ts` — add `ExecuteCodeSchema`:
- `{ code: z.string(), language: z.enum(["node"]).optional(), timeoutMs: z.number().int().min(100).max(5 * 60_000).optional(), resources: z.object({ vcpus: z.number().int().min(1).max(8).optional(), memoryMbPerVcpu: z.number().int().min(512).max(2048).optional() }).optional() }`
- `packages/types/src/agent-tools-contract.ts` — add contract for `executeCode`
- Re‑export in `packages/types/src/index.ts`

This keeps planner/tool schemas and app types in sync.

### 9) Testing & verification

Functional tests:

- Run `executeCodeInSandbox` with:
- `console.log("hello")` → stdout contains “hello”
- `throw new Error("boom")` → non‑zero exitCode, stderr contains “boom”
- Long‑running loop → timeout enforced; sandbox disposed
- Ensure observability in Vercel Dashboard shows run metadata.

Integration tests:

- tRPC `tools.executeCode` returns structured, typed result
- Agent E2E: when LLM calls `executeCode`, no `tool-call` hook is emitted for this tool, and the result is appended inline to the transcript.

Non‑regression:

- Existing client tools still emit `tool-call` + hook and callback POST continues to work (`/api/llm/agent/callback`).
---

## Client (Browser) Code Mode — Safe In‑Browser Execution

Some editor‑aware tools must run near Lexical. For “real Code Mode in the browser” (LLM‑generated snippets that manipulate the document), run untrusted code in an isolated browser sandbox and bridge results back to the host app, which then applies the changes to Lexical.

### Threat model & core rules

- Never run generated code in the same JS context as the app (no `new Function` in main window).
- Execute in a sandboxed context (iframe or Worker), ideally a different origin.
- Expose only a minimal, explicit API focused on a data model (document JSON / logical selection).
- The host app (not the sandbox) applies validated results to Lexical with undo support.

### High‑level architecture

1) Host app (main window)

- Owns Lexical and UI; holds auth/session.
- Serializes a document snapshot to a JSON format (no secrets).
- Sends `{ code, initialDoc, toolParams }` to sandbox; later applies `{ newDoc | ops }`.

2) Code sandbox (isolated execution)

- Option A: Sandboxed iframe without `allow-same-origin`, with `sandbox="allow-scripts"`.
- Option B: Cross‑origin Web Worker (served from another origin with CORS).
- Receives doc snapshot and code string; runs code with a tiny “tool API” limited to:
- `getDocument()`, `setDocument(json)`, optionally `getSelection()` (logical).
- Logging and bounded timers.
- Returns `{ ok, newDoc?, ops?, logs?, error? }`.

3) Bridge (message protocol)

- Use `postMessage` to send requests/responses.
- Host validates response sizes and operation count before applying to Lexical.

### Lexical integration strategy

- Export: `exportLexicalToJson(editorState)` → sanitized, secret‑free JSON.
- Import: `importJsonIntoLexical(newDoc, editor)` inside `editor.update(...)`.
- Always push to undo stack; optionally show diff/summary to the user.

### Sandboxing options (browser)

- Iframe (recommended for strongest isolation):
- Hosted at separate origin (e.g., `https://code-runner.your-sandbox.example/runner.html`).
- `sandbox="allow-scripts"` (no `allow-same-origin`, no forms, no top‑navigation).
- Communication via `postMessage`.
- Cross‑origin Worker:
- Worker JS hosted on a different origin with CORS permitted.
- No DOM access; message passing only. Network access may still exist; rely on CORS/auth server‑side.

### New client tool definition

- Add `executeCodeClient` in `apps/lexidraw/src/server/llm/tools/registry.ts` with:
- `group: "client"`
- Input schema (in `@packages/types`): `ExecuteCodeClientSchema`
 - `{ code: string; timeoutMs?: number; maxOps?: number; selection?: {...}? }`
- Description: “Run small browser sandbox code that returns a document update; the host applies to Lexical.”
- The agent planner can include `executeCodeClient` for editor‑adjacent tasks; actual execution remains in the client hook flow (unchanged) [[memory:10692632]].

### Client integration points (proposed files)

- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/code-mode/`
- `run-in-iframe-sandbox.ts` (or `run-in-worker-sandbox.ts`): start sandbox, send `{ code, initialDoc }`, await result.
- `message-protocol.ts`: request/response TypeScript types, size limits, guards.
- `lexical-adapter.ts`: `exportLexicalToJson`, `importJsonIntoLexical`.
- `index.ts`: thin façade used by the client tool runner.
- If using an iframe:
- Host `runner.html` on a separate origin (infra task). For local dev, a second Vercel project/domain is sufficient. Alternatively, a static file in another app served on a different hostname.

### Guardrails

- Input/Output caps: `maxChars`, `maxBlocks`, `maxOps`, `maxDurationMs`.
- Truncate logs; reject oversized results; confirm destructive changes before apply.
- No secrets in snapshots; no auth tokens sent to sandbox.
- Apply changes only via controlled import functions; never expose Lexical/editor directly to sandbox.

### Testing (browser)

- Unit test `exportLexicalToJson` and `importJsonIntoLexical` with representative docs.
- E2E test iframe/worker message round‑trip with simple code:
- Insert heading; modify paragraph; out‑of‑bounds selection handling.
- Negative tests: infinite loop (timeout), huge output (reject), invalid schema (reject).
- Ensure undo/redo works after applying sandbox results.

## Key Files to Modify (and add)

1. `apps/lexidraw/package.json` — add `@vercel/sandbox`, `ms`, `@types/ms`
2. `apps/lexidraw/src/server/llm/tools/registry.ts` — add `executeCode` tool spec (`group: "server"`)
3. `apps/lexidraw/src/workflows/agent/agent-workflow.ts` — branch logic by tool `group`; run server tools inline
4. `apps/lexidraw/src/server/llm/tools/code-execution.ts` — NEW: sandbox service
5. `apps/lexidraw/src/workflows/agent/execute-server-tool.ts` — NEW: server tool dispatcher
6. `apps/lexidraw/src/server/api/routers/tools.ts` — NEW: tRPC mutation for `executeCode` (protected)
7. `apps/lexidraw/src/server/api/root.ts` — register `tools` router
8. `packages/types/src/tool-schemas.ts` — add `ExecuteCodeSchema`
9. `packages/types/src/agent-tools-contract.ts` — add contract
10. `packages/types/src/index.ts` — re‑export schema/contract
11. `packages/env/src/index.ts` — optional `VERCEL_*` additions (typed)
12. Client Code Mode (browser):

- `apps/lexidraw/src/server/llm/tools/registry.ts` — add `executeCodeClient` (`group: "client"`)
- `packages/types/src/tool-schemas.ts` — add `ExecuteCodeClientSchema`; re‑export in `index.ts`, add contract
- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/code-mode/*` — NEW browser sandbox bridge, protocol, and Lexical adapters
- (Infra) Separate origin hosting for iframe or cross‑origin Worker script

## Security Considerations

- Sandbox isolation (Vercel)
- Strict timeouts (keep short by default; configurable with caps)
- Resource limits (vCPUs/memory) with conservative defaults
- Input validation via Zod; protected tRPC procedure
- No secrets injection into executed code; never pass app secrets to sandboxed code
- Rate limiting on tRPC route if later exposed to non‑admin user surfaces

## Error Handling

- Sandbox creation failures (surface user‑friendly message; log full detail server‑side)
- Code execution errors (non‑zero exit; capture stderr; return `ok=false`)
- Timeout errors (return specific timeout signal; ensure sandbox is disposed)
- Invalid input (Zod)
- Network/transient errors (retry not recommended for code execution—fail fast and log)

## Operational Notes

- Keep server execution strictly on Node runtime (not Edge).
- The agent is server‑orchestrated; only client tools require the hook/SSE round‑trip. The new server tools never emit hook events.
- View sandbox runs: Vercel Dashboard → Observability → Sandboxes.
- Keep results small; truncate stdout/stderr in the transcript if needed.

## Future Enhancements

- Allow file uploads/multi‑file execution
- Long‑lived sandbox sessions (caution: cost/limits)
- Admin UI to browse latest runs
- Caching of deterministic results

## References

- Vercel Sandbox docs: `https://vercel.com/docs/vercel-sandbox`
- Guide: Running AI‑generated code safely: `https://vercel.com/guides/running-ai-generated-code-sandbox`
- Repo files:
- `apps/lexidraw/src/workflows/agent/agent-workflow.ts`
- `apps/lexidraw/src/server/llm/tools/registry.ts`
- `apps/lexidraw/src/server/api/root.ts` and `routers/llm.ts`
- `apps/lexidraw/src/app/api/llm/agent/callback/route.ts`
- `packages/types/src/*`
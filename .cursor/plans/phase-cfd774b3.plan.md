<!-- cfd774b3-1aee-4fbf-877c-72da21a672fd 7875c782-7097-4fd1-8d50-792e0e471118 -->
# Phase 4: Orchestration Loop (Multi-Tool, Decision, Abort-Aware)

## Objective

Enable the agent to perform multiple tool calls in a single run by integrating a decision step that chooses whether to summarize or plan the next step. Keep one tool-call in flight at a time, maintain NDJSON streaming, and add basic abort-awareness.

## Key Decisions

- Keep NDJSON event format (no SSE framing changes needed).
- One tool-call at a time via `createHook` + callback.
- Reuse the initial planner’s allowed tools for the entire run (optional re-plan later).
- Add a `maxCycles` guard (e.g., 6) to prevent infinite loops.

## Files to Update

1) `apps/lexidraw/src/workflows/agent/agent-workflow.ts`

- Convert current single-turn flow into a bounded loop:
  - After each `callLlmStep`, emit `text-delta` (as today), handle tool calls sequentially.
  - For each tool call: emit `tool-call`, await hook result, append tool result to `currentMessages`.
  - Invoke `decisionStep` with `(messages, system, config, priorAssistantText)`.
  - If decision is `planNext`, continue the loop with updated `currentMessages`; if `summarize`, emit `finish` and end.
  - Insert a `maxCycles` guard and break with an error event if exceeded.
  - Add minimal abort-awareness: check an `aborted` flag between cycles and end with an `error` event (`code: "aborted"`).

Minimal context of current single-call block to replace:

```96:131:apps/lexidraw/src/workflows/agent/agent-workflow.ts
// 2) One LLM turn
const llmResult = await callLlmStep({
  messages: toModelMessages(currentMessages),
  system: args.system,
  config: args.config,
  allowedTools,
});

// Emit a single text-delta after step returns
if (llmResult.text) {
  const event: AgentEvent = {
    type: "text-delta",
    id: String(eventId++),
    runId,
    messageId: llmResult.messageId,
    delta: llmResult.text,
  };
  await agentWrite(writable, event);
}

// 3) Handle at most one tool call, then finish
const toolCalls = llmResult.toolCalls ?? [];
if (toolCalls.length > 0) {
  const [firstToolCall] = toolCalls;
```

2) `apps/lexidraw/src/app/api/llm/agent/route.ts`

- Add abort forwarding: listen to `req.signal` and, if supported by the workflow runtime, cancel the run; otherwise, close the stream and let the loop check an `aborted` flag via args.
- Pass an `aborted` hint to the workflow (e.g., set in a shared store or via a best-effort flag inside args if supported).

3) `apps/lexidraw/src/workflows/agent/decision-step.ts`

- No structural changes; ensure it accepts `priorAssistantText` (already done) and returns `summarize | planNext`.

## Implementation Notes

- Keep `eventId` monotonic. Reuse existing `agentWrite` and `finish/error` events.
- `maxCycles` configurable via `args.config` or a local constant (e.g., 6).
- Maintain one tool-call in flight at a time. The client already dedupes events.
- Continue emitting initial heartbeat. Optional: emit a heartbeat between cycles if there’s prolonged waiting (can be deferred).

## Acceptance Criteria

- Agent can execute 2+ sequential tool calls in one run when model requests it.
- After each tool result, the decision step determines continue-or-finish.
- Single tool-call in flight at any moment; no duplicate tool executions.
- Client UI shows streamed assistant text and correct tool activity updates.
- Cancelling on the client stops further cycles and terminates the stream.
- Guard: runs stop after `maxCycles` with a clear error event if not summarized.

## Testing

- Unit: simulate multi-tool sequences (e.g., tool A → tool B → summarize) by stubbing `callLlmStep`.
- Integration: run end-to-end via the callback route; verify event order and that only one tool executes at a time.
- Abort: start a multi-step run; cancel mid-flight; verify an `error` event with `code: "aborted"` and no further tool calls.
- Regression: single-tool and zero-tool paths still return `finish` and good summary.

### To-dos

- [ ] Implement bounded multi-step loop in agent-workflow.ts with maxCycles
- [ ] Call decisionStep after each tool result and branch continue/finish
- [ ] Emit tool-call event, await hook, append tool-result to messages
- [ ] Wire basic abort-awareness between route and workflow; end with error
- [ ] Forward NextRequest abort to workflow run or signal flag
- [ ] Add maxCycles guard and concise logs with runId per cycle
- [ ] Add unit/integration tests for multi-step, abort, and regression
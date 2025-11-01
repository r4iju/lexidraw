## Agent duplicate tool execution — root cause & fix plan

### Problem

Single LLM response (with a single tool call) results in multiple executions of the same tool (e.g., `insertMarkdown`) in agent mode.

### Evidence (logs)

```text
[insertMarkdown] Starting ...
✅ [insertMarkdown] Success: Inserted ...
[agent] Executing 1 tool call(s): insertMarkdown
[insertMarkdown] Starting ...
✅ [insertMarkdown] Success: Inserted ...
[insertMarkdown] Starting ...
✅ [insertMarkdown] Success: Inserted ...
```

Notable: the first `insertMarkdown` starts before our own "[agent] Executing 1 ..." log, indicating a separate execution path.

### Scope

- `apps/lexidraw/src/app/documents/[documentId]/plugins/LlmChatPlugin/use-send-query.ts`
- `apps/lexidraw/src/app/documents/[documentId]/context/llm-context.tsx`
- Tools registered via `runtime-tools-provider.tsx` (e.g., `insertMarkdown`).

### Likely root cause

- We pass runtime tools (created via `tool(...)` with `execute`) into the AI SDK `generateText` call. The SDK performs internal multi-step tool execution when `tools` are present, while our client driver also manually executes returned `toolCalls`. This creates two executors in the same turn.
- A subsequent model step can produce another tool call (hence triple execution) before we feed back our summarized results.

### Code reference

```353:360:apps/lexidraw/src/app/documents/[documentId]/context/llm-context.tsx
const result = await generateText({
  model: model as unknown as LanguageModel,
  messages: baseMessages,
  system,
  temperature: temperature ?? activeConfig.temperature,
  tools: tools,
  toolChoice: "auto",
});
```

### Fix plan (minimal, best-practice)

1. Disable internal tool execution for the SDK call; we execute tools manually.

   - Set `maxSteps: 1` on the `generateText` call in `llm-context.tsx` to prevent SDK multi-step execution.
   - Keep `toolChoice: "auto"` so the model produces tool calls, but do not let the SDK run them.

   Proposed change:

   ```diff
   const result = await generateText({
     model,
     messages: baseMessages,
     system,
     temperature,
     tools,
     toolChoice: "auto",
   + maxSteps: 1, // prevent SDK auto step/execution; we execute toolCalls manually
   });
   ```

2. Single executor path per turn (already in place):

   - The client driver (`use-send-query.ts`) iterates `toolCalls` once, awaits each `execute`, then sends one follow-up LLM call with a compact `TOOL_EXECUTION_RESULTS_PASS_1` message.

3. De-dupe safety by `toolCallId`:

   - Track executed `toolCallId`s within the turn to avoid accidental re-exec if the same ID reappears due to retries.

4. Re-entrancy guard (done):
   - `agentInFlightRef` ensures only one agent turn runs at a time.

### Acceptance criteria

- For a single user prompt that yields one `insertMarkdown` tool call, exactly one insertion occurs in the document.
- Logs show one "[agent] Executing 1 tool call(s): insertMarkdown" and one "[insertMarkdown] Starting → Success" pair per turn.
- No pre-driver tool execution occurs before the driver log.

### Rollback

- Remove the `maxSteps: 1` line to restore SDK-driven execution (not recommended).

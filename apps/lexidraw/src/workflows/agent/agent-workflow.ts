import type { ModelMessage } from "ai";
import type { EffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { callPlannerStep } from "./call-planner-step";
import { callLlmStep } from "./call-llm-step";
import { createHook, getWritable, sleep } from "workflow";
import type { AgentEvent } from "@packages/types";
import { getAvailableToolNames } from "~/server/llm/tools/registry";
import { toModelMessages } from "./message-utils";

export type AgentConfig = EffectiveLlmConfig;

export interface AgentWorkflowArgs {
  prompt: string; // Formatted prompt for LLM (includes FORMATTING_INSTRUCTION, JSON_STATE, etc.)
  originalPrompt: string; // Original user prompt for planner (just the user's request)
  documentMarkdown?: string; // Markdown snapshot for planner context
  messages: ModelMessage[];
  system: string;
  config: AgentConfig;
  userId: string;
  documentId: string;
  runId: string;
}

// SSEWriter is defined in call-llm-step.ts
// This will be used in Phase 2 for SSE streaming

// Write a single AgentEvent as NDJSON line to the workflow's output stream
export async function agentWrite(
  writable: WritableStream,
  event: AgentEvent,
): Promise<void> {
  "use step";
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const jsonStr = `${JSON.stringify(event)}\n`;
  await writer.write(encoder.encode(jsonStr));
  writer.releaseLock();
}

// Close the workflow's writable stream
async function agentEnd(writable: WritableStream): Promise<void> {
  "use step";
  await writable.close();
}

/**
 * Agent workflow that orchestrates planner → LLM → tool execution → decision cycles.
 *
 * Phase 4: Full orchestration loop with hooks
 */
export async function agentWorkflow(args: AgentWorkflowArgs): Promise<void> {
  "use workflow";

  const runId = args.runId;
  let eventId = 0;
  const currentMessages: ModelMessage[] = [...args.messages];
  const writable = getWritable();

  // no helper; write inline like the docs

  try {
    // Emit initial heartbeat
    {
      const event: AgentEvent = {
        type: "heartbeat",
        id: String(eventId++),
        runId,
        ts: Date.now(),
      };
      await agentWrite(writable, event);
    }

    // 1) Planner once per run
    const plannerPrompt = args.originalPrompt;
    const plannerResult = await callPlannerStep({
      prompt: plannerPrompt,
      availableTools: getAvailableToolNames(),
      documentMarkdown: args.documentMarkdown,
      max: 6,
      userId: args.userId,
    });

    const allowedTools = plannerResult.tools || [];

    if (currentMessages.length === 0 && args.prompt) {
      currentMessages.push({ role: "user", content: args.prompt });
    }

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
      if (!firstToolCall) {
        const finishEvent: AgentEvent = {
          type: "finish",
          id: String(eventId++),
          runId,
          summary: llmResult.text || undefined,
        };
        await agentWrite(writable, finishEvent);
        await agentEnd(writable);
        return;
      }
      const toolCall = firstToolCall;

      // Append assistant with the tool-call (and optional text)
      const content = llmResult.text
        ? [
            { type: "text" as const, text: llmResult.text },
            {
              type: "tool-call" as const,
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
            },
          ]
        : [
            {
              type: "tool-call" as const,
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              input: toolCall.input,
            },
          ];

      currentMessages.push({
        role: "assistant",
        content,
      } as ModelMessage);

      const hook = createHook<{ toolCallId: string; result: unknown }>();
      const hookToken = hook.token;

      {
        const event: AgentEvent = {
          type: "tool-call",
          id: String(eventId++),
          runId,
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          hookToken,
        };
        await agentWrite(writable, event);
      }

      // Wait for result
      const hookResult = await hook;

      // Append tool result
      currentMessages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: hookResult.toolCallId,
            toolName: toolCall.toolName,
            output: hookResult.result,
          },
        ],
      } as ModelMessage);

      const finishEvent: AgentEvent = {
        type: "finish",
        id: String(eventId++),
        runId,
      };
      await agentWrite(writable, finishEvent);
      await agentEnd(writable);
      return;
    }

    const finishEvent: AgentEvent = {
      type: "finish",
      id: String(eventId++),
      runId,
      summary: llmResult.text || undefined,
    };
    await agentWrite(writable, finishEvent);
    await agentEnd(writable);
    return;
  } catch (error) {
    // Emit error event
    const event: AgentEvent = {
      type: "error",
      id: String(eventId++),
      runId,
      message: error instanceof Error ? error.message : String(error),
      code: "workflow-error",
    };
    await agentWrite(writable, event);
    await agentEnd(writable);
    throw error;
  }
}

export async function ping() {
  "use workflow";
  const w = getWritable<Uint8Array>();
  await writeHello(w);
  await sleep("200ms");
  await agentEnd(w);
}

async function writeHello(w: WritableStream<Uint8Array>) {
  "use step";
  const writer = w.getWriter();
  try {
    await writer.write(new TextEncoder().encode("hello\n"));
  } finally {
    writer.releaseLock();
  }
}

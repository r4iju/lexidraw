import type { ModelMessage } from "ai";
import type { EffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { callPlannerStep } from "./call-planner-step";
import { callLlmStep } from "./call-llm-step";
import { createHook, getWritable } from "workflow";
import type { AgentEvent } from "@packages/types";
import { getAvailableToolNames } from "~/server/llm/tools/registry";
import { toModelMessages } from "./message-utils";

// MVP: Only allow these tools for now
const MVP_TOOL_NAMES = [
  "sendReply",
  "insertTextNode",
  "insertHeadingNode",
  "insertMarkdown",
] as const;

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

    // 1) Planner once per run - limit to MVP tools
    const plannerPrompt = args.originalPrompt;
    const mvpTools = getAvailableToolNames().filter((name) =>
      MVP_TOOL_NAMES.includes(name as (typeof MVP_TOOL_NAMES)[number]),
    );
    const plannerResult = await callPlannerStep({
      prompt: plannerPrompt,
      availableTools: mvpTools,
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

      // Extract summary for finish event
      let summary: string | undefined;
      if (toolCall.toolName === "sendReply") {
        // sendReply returns the message string directly
        if (typeof hookResult.result === "string") {
          summary = hookResult.result;
        } else if (hookResult.result && typeof hookResult.result === "object") {
          const obj = hookResult.result as Record<string, unknown>;
          const textLike =
            (typeof obj.text === "string" && obj.text) ||
            (typeof obj.content === "string" && obj.content) ||
            (typeof obj.message === "string" && obj.message);
          summary = typeof textLike === "string" ? textLike : undefined;
        }
        // Fallback to input message if result extraction failed
        if (!summary && toolCall.input && typeof toolCall.input === "object") {
          const input = toolCall.input as Record<string, unknown>;
          summary =
            typeof input.message === "string" ? input.message : undefined;
        }
      }

      const finishEvent: AgentEvent = {
        type: "finish",
        id: String(eventId++),
        runId,
        summary,
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

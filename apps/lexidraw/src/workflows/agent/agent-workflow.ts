import type { ModelMessage } from "ai";
import type { EffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { callPlannerStep } from "./call-planner-step";
import { callLlmStep } from "./call-llm-step";
import { decisionStep } from "./decision-step";
import { createHook, getWritable } from "workflow";
import type { AgentEvent } from "@packages/types";
import {
  getAvailableToolNames,
  getToolGroup,
} from "~/server/llm/tools/registry";
import {
  appendAssistantToolCall,
  appendToolResult,
  buildDecisionMessages,
} from "./message-serializer";
import type { LanguageModelV2ToolResultOutput } from "@ai-sdk/provider";
import { executeServerTool } from "./execute-server-tool";

export type AgentConfig = EffectiveLlmConfig;

export interface AgentWorkflowArgs {
  prompt: string; // Just the user's prompt
  originalPrompt: string; // Original user prompt for planner (just the user's request)
  documentMarkdown?: string; // Markdown snapshot for planner context
  documentJson?: Record<string, unknown>; // JSON state as separate property
  messages: ModelMessage[];
  config: AgentConfig;
  userId: string;
  documentId: string;
  runId: string;
  serverCodeMode?: boolean;
}

const MAX_CYCLES = 6; // Maximum number of LLM cycles before forcing finish

/**
 * Builds the system prompt for agent mode.
 * Includes available tools and interaction guidelines.
 * No node types section (removed to minimize payload).
 */
function buildSystemPrompt(): string {
  const availableTools = getAvailableToolNames();
  const toolLines =
    availableTools.length === 0
      ? "• No tools available."
      : availableTools.map((t) => `• ${t}`).join("\n");

  return (
    `You are a document‑editing assistant in **Agent Mode**.\n\n` +
    `### Available tools\n${toolLines}\n\n` +
    `### Interaction Guidelines\n` +
    `1. If the request is ambiguous or multi‑step, use **requestClarificationOrPlan**.\n` +
    `2. Call mutation tools with **only** the JSON payload.\n` +
    `3. After all modifications, finish with **summarizeAfterToolCallExecution**.\n` +
    `4. Use **sendReply** only when it's clear the user is not requesting document modification, but rather a response to the chat.`
  ).trim();
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
  let currentMessages: ModelMessage[] = [...args.messages];
  const writable = getWritable();

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

    // Note: args.aborted is checked here but won't change dynamically since args are serialized.
    // Abort handling relies on stream closure - when the client aborts, the stream closes
    // and subsequent writes will fail, causing the workflow to end gracefully.

    // 1) Planner once per run - use full tool registry
    const plannerPrompt = args.originalPrompt;
    let mvpTools = getAvailableToolNames();
    if (args.serverCodeMode) {
      mvpTools = ["executeCode"];
    }
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

    // Build system prompt server-side
    const systemPrompt = buildSystemPrompt();

    // 2) Multi-step loop: LLM → tool execution → decision → continue or finish
    let cycleCount = 0;
    let lastAssistantText: string | undefined;

    while (cycleCount < MAX_CYCLES) {
      cycleCount++;
      console.log(`[agentWorkflow] Cycle ${cycleCount}/${MAX_CYCLES}`, {
        runId,
      });

      // Note: Abort is handled via stream closure. If the client aborts the request,
      // the stream will be closed and subsequent writes will fail, ending the workflow.

      // LLM turn
      const llmResult = await callLlmStep({
        messages: currentMessages,
        system: systemPrompt,
        config: args.config,
        allowedTools,
      });

      // Emit text-delta if there's text
      if (llmResult.text) {
        lastAssistantText = llmResult.text;
        const event: AgentEvent = {
          type: "text-delta",
          id: String(eventId++),
          runId,
          messageId: llmResult.messageId,
          delta: llmResult.text,
        };
        await agentWrite(writable, event);
      }

      // Handle tool calls sequentially (one at a time)
      const toolCalls = llmResult.toolCalls ?? [];
      if (toolCalls.length > 0) {
        // Process each tool call sequentially
        let lastToolCallName: string | undefined;
        let lastToolResultOutput: LanguageModelV2ToolResultOutput | undefined;
        for (const toolCall of toolCalls) {
          // Append assistant tool-call message (with optional assistant text)
          currentMessages = appendAssistantToolCall(currentMessages, {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            input: toolCall.input,
            assistantText: llmResult.text,
          });

          // Check if tool is server-side or client-side
          const toolGroup = getToolGroup(toolCall.toolName);

          if (toolGroup === "server") {
            // Execute server tool directly in workflow (no hook/SSE)
            const serverResult = await executeServerTool({
              name: toolCall.toolName,
              input: toolCall.input as Record<string, unknown>,
              userId: args.userId,
              runId,
            });

            // Append tool result message
            currentMessages = appendToolResult(currentMessages, {
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              result: serverResult,
            });

            // Track last tool call details for decision surrogate
            lastToolCallName = toolCall.toolName;
            lastToolResultOutput = serverResult;
          } else {
            // Client tool: create hook and emit tool-call event
            const hook = createHook<{
              toolCallId: string;
              result: LanguageModelV2ToolResultOutput;
            }>();
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

            // Wait for tool result and append tool message
            const hookResult = await hook;
            currentMessages = appendToolResult(currentMessages, {
              toolCallId: hookResult.toolCallId,
              toolName: toolCall.toolName,
              result: hookResult.result,
            });

            // Track last tool call details for decision surrogate
            lastToolCallName = toolCall.toolName;
            lastToolResultOutput = hookResult.result;
          }
        }

        // After all tool calls complete, decide: continue or finish?
        const surrogateText = formatToolDecisionSurrogate(
          lastToolCallName,
          lastToolResultOutput,
        );
        const decision = await decisionStep({
          messages: buildDecisionMessages(currentMessages, surrogateText),
          system: systemPrompt,
          config: args.config,
          priorAssistantText: undefined,
        });

        if (decision.decision === "summarize") {
          // Finish with summary
          const summary =
            decision.summary ||
            lastAssistantText ||
            extractSummaryFromLastToolCall(currentMessages);
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
        // If planNext, continue the loop
      } else {
        // No tool calls - finish immediately
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
    }

    // Max cycles reached - force finish with error
    const errorEvent: AgentEvent = {
      type: "error",
      id: String(eventId++),
      runId,
      message: `Maximum cycles (${MAX_CYCLES}) reached. Workflow terminated.`,
      code: "max-cycles-exceeded",
    };
    await agentWrite(writable, errorEvent);
    await agentEnd(writable);
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

/**
 * Extract summary from the last tool call result in messages.
 * Used as fallback when decision step doesn't provide a summary.
 */
function extractSummaryFromLastToolCall(
  messages: ModelMessage[],
): string | undefined {
  // Find the last tool result
  // Tool messages have content as string (JSON) and toolCallId
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role === "tool" && typeof msg.content === "string") {
      try {
        const parsed = JSON.parse(msg.content);
        if (typeof parsed === "string") {
          return parsed;
        }
        if (parsed && typeof parsed === "object") {
          const obj = parsed as Record<string, unknown>;
          const textLike =
            (typeof obj.text === "string" && obj.text) ||
            (typeof obj.content === "string" && obj.content) ||
            (typeof obj.message === "string" && obj.message);
          return typeof textLike === "string" ? textLike : undefined;
        }
      } catch {
        // If content is not JSON, treat it as plain string
        return msg.content;
      }
    }
  }
  return undefined;
}

/**
 * Builds a concise surrogate string for the last executed tool call so the
 * decision step has textual context about what just happened.
 */
function formatToolDecisionSurrogate(
  toolName: string | undefined,
  output: LanguageModelV2ToolResultOutput | undefined,
): string | undefined {
  if (!toolName) return undefined;
  if (!output) return `Executed tool ${toolName}.`;

  switch (output.type) {
    case "text": {
      const len = output.value.length;
      return `Executed tool ${toolName} → text(${len} chars).`;
    }
    case "json": {
      const val = output.value as unknown;
      const success =
        typeof val === "object" &&
        val !== null &&
        "success" in (val as Record<string, unknown>)
          ? Boolean((val as { success: unknown }).success)
          : undefined;
      return success !== undefined
        ? `Executed tool ${toolName} → json(success:${success}).`
        : `Executed tool ${toolName} → json.`;
    }
    case "error-text":
      return `Executed tool ${toolName} → error-text.`;
    case "error-json":
      return `Executed tool ${toolName} → error-json.`;
    case "content":
      return `Executed tool ${toolName} → content(${output.value.length} parts).`;
    default:
      return `Executed tool ${toolName}.`;
  }
}

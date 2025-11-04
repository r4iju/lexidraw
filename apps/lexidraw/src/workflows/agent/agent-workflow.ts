import "server-only";

import type { ModelMessage } from "ai";
import type { EffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { callPlannerStep } from "./call-planner-step";
import { callLlmStep } from "./call-llm-step";
import { decisionStep } from "./decision-step";
import { createHook, getWritable } from "workflow";
import type { AgentEvent } from "@packages/types";
import { getAvailableToolNames } from "~/server/llm/tools/registry";

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
export async function agentEnd(writable: WritableStream): Promise<void> {
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

    // Orchestration loop
    const MAX_ITERATIONS = 10;
    let iteration = 0;
    let shouldContinue = true;

    while (shouldContinue && iteration < MAX_ITERATIONS) {
      iteration++;

      console.log(
        "[agentWorkflow] loop:start",
        JSON.stringify({
          runId,
          iteration,
          currentMessages: currentMessages.length,
        }),
      );

      // Call planner to get allowed tools
      // Use originalPrompt for planner (just the user's request, no formatting instructions)
      const plannerPrompt = args.originalPrompt;

      const plannerResult = await callPlannerStep({
        prompt: plannerPrompt,
        availableTools: getAvailableToolNames(),
        documentMarkdown: args.documentMarkdown,
        max: 6,
        userId: args.userId,
      });

      console.log("[agentWorkflow] Planner returned:", {
        tools: plannerResult.tools,
        toolsCount: plannerResult.tools?.length ?? 0,
        correlationId: plannerResult.correlationId,
      });

      const allowedTools = plannerResult.tools || [];
      console.log(
        "[agentWorkflow] planner:allowedTools",
        JSON.stringify({
          runId,
          iteration,
          count: allowedTools.length,
          names: allowedTools,
        }),
      );

      // Ensure we have at least one user message for the first LLM turn
      if (currentMessages.length === 0 && args.prompt) {
        currentMessages.push({ role: "user", content: args.prompt });
      }

      const llmResult = await callLlmStep({
        messages: currentMessages,
        system: args.system,
        config: args.config,
        allowedTools,
      });

      console.log(
        "[agentWorkflow] llm:result",
        JSON.stringify({
          runId,
          iteration,
          textLen: (llmResult.text || "").length,
          toolCalls: llmResult.toolCalls ? llmResult.toolCalls.length : 0,
          messageId: llmResult.messageId,
        }),
      );

      // Emit a single text-delta after step returns (no streaming functions passed to step)
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

      // Note: If model selects 0 tools, the decision step may still summarize and finish

      if (llmResult.toolCalls && llmResult.toolCalls.length > 0) {
        currentMessages.push({
          role: "assistant",
          // content must be a string (even if empty) when toolCalls are present
          content: llmResult.text || "",
          toolCalls: llmResult.toolCalls.map((tc) => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.input,
          })),
        } as ModelMessage);

        console.log("[agentWorkflow] currentMessages", currentMessages);

        // Process each tool call sequentially
        for (const toolCall of llmResult.toolCalls) {
          // Create hook for tool call
          const hook = createHook<{ toolCallId: string; result: unknown }>();

          // Use hook's token for resumption
          const hookToken = hook.token;

          // Emit tool-call event with hook token
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

          // Wait for hook to be resumed with result
          const hookResult = await hook;

          // Append tool result to messages (format as string JSON)
          const toolResultContent =
            typeof hookResult.result === "string"
              ? hookResult.result
              : JSON.stringify(hookResult.result);

          currentMessages.push({
            role: "tool",
            content: toolResultContent,
            toolCallId: hookResult.toolCallId,
          } as unknown as ModelMessage);
        }
      } else {
        // No tool calls - add assistant message
        if (llmResult.text) {
          currentMessages.push({
            role: "assistant",
            content: llmResult.text,
          });
        }
      }

      // Decision step: summarize or planNext
      console.log(
        "[agentWorkflow] decisionStep:input",
        JSON.stringify({
          runId,
          iteration,
          messagesCount: currentMessages.length,
          messages: currentMessages.map((msg) => ({
            role: msg.role,
            hasContent: !!msg.content,
            contentType: typeof msg.content,
            contentLength:
              typeof msg.content === "string" ? msg.content.length : 0,
            hasToolCalls: "toolCalls" in msg && !!msg.toolCalls,
            toolCallsCount:
              "toolCalls" in msg && Array.isArray(msg.toolCalls)
                ? msg.toolCalls.length
                : 0,
            hasToolCallId: "toolCallId" in msg && !!msg.toolCallId,
          })),
        }),
      );
      const decision = await decisionStep({
        messages: currentMessages,
        system: args.system,
        config: args.config,
        priorAssistantText: llmResult.text,
      });

      console.log(
        "[agentWorkflow] decision",
        JSON.stringify({
          runId,
          iteration,
          decision: decision.decision,
          hasSummary: !!decision.summary,
        }),
      );

      if (decision.decision === "summarize") {
        // Emit finish event
        {
          const event: AgentEvent = {
            type: "finish",
            id: String(eventId++),
            runId,
            summary: decision.summary,
          };
          await agentWrite(writable, event);
          await agentEnd(writable);
        }
        shouldContinue = false;
      } else {
        // planNext - continue loop with updated messages
        // The loop will continue with currentMessages containing tool results
      }
    }

    console.log(
      "[agentWorkflow] loop:end",
      JSON.stringify({ runId, iteration, shouldContinue }),
    );

    if (iteration >= MAX_ITERATIONS) {
      const event: AgentEvent = {
        type: "finish",
        id: String(eventId++),
        runId,
        summary: "Reached maximum iterations",
      };
      await agentWrite(writable, event);
      await agentEnd(writable);
    }
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

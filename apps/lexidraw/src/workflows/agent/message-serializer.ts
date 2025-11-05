import "server-only";

import type { ModelMessage } from "ai";

export interface AssistantToolCallArgs {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  assistantText?: string;
}

export interface ToolResultArgs {
  toolCallId: string;
  result: unknown;
}

/**
 * Append a plain assistant text message.
 */
export function appendAssistantText(
  messages: ModelMessage[],
  text: string,
): ModelMessage[] {
  const msg: ModelMessage = {
    role: "assistant",
    content: text,
  };
  return [...messages, msg];
}

/**
 * Append an assistant message that includes a tool-call content part.
 * If assistantText is provided, it is included as a text part before the tool-call.
 */
export function appendAssistantToolCall(
  messages: ModelMessage[],
  args: AssistantToolCallArgs,
): ModelMessage[] {
  const content = args.assistantText
    ? [
        { type: "text" as const, text: args.assistantText },
        {
          type: "tool-call" as const,
          toolCallId: args.toolCallId,
          toolName: args.toolName,
          input: args.input,
        },
      ]
    : [
        {
          type: "tool-call" as const,
          toolCallId: args.toolCallId,
          toolName: args.toolName,
          input: args.input,
        },
      ];

  const msg: ModelMessage = {
    role: "assistant",
    content,
  };
  return [...messages, msg];
}

/**
 * Append a tool result message. The AI SDK expects tool messages with
 * string content (often JSON) and a top-level toolCallId.
 */
export function appendToolResult(
  messages: ModelMessage[],
  args: ToolResultArgs,
): ModelMessage[] {
  const contentString =
    typeof args.result === "string" ? args.result : JSON.stringify(args.result);
  const msg: ModelMessage = {
    role: "tool",
    content: contentString,
    toolCallId: args.toolCallId,
  };
  return [...messages, msg];
}

/**
 * Build messages to pass into the decision step. This function ensures that
 * the array is typed as ModelMessage[] and optionally appends the prior
 * assistant text as a separate assistant message.
 *
 * Note: The decision step itself appends the instruction prompt; we do not
 * add that here to avoid duplication.
 */
export function buildDecisionMessages(
  messages: ModelMessage[],
  priorAssistantText?: string,
): ModelMessage[] {
  if (!priorAssistantText) return messages;
  return appendAssistantText(messages, priorAssistantText);
}

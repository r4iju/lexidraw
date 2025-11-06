import "server-only";

import type { ModelMessage } from "ai";
import {
  isJSONValue,
  type JSONValue,
  type LanguageModelV2ToolResultOutput,
} from "@ai-sdk/provider";
import { z } from "zod";

export interface AssistantToolCallArgs {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  assistantText?: string;
}

export interface ToolResultArgs {
  toolCallId: string;
  toolName: string;
  result: unknown;
}

// Zod schemas to validate LanguageModelV2ToolResultOutput at runtime
const ToolOutputTextSchema = z.object({
  type: z.literal("text"),
  value: z.string(),
});
const ToolOutputJsonSchema = z.object({
  type: z.literal("json"),
  value: z.any(),
});
const ToolOutputErrorTextSchema = z.object({
  type: z.literal("error-text"),
  value: z.string(),
});
const ToolOutputErrorJsonSchema = z.object({
  type: z.literal("error-json"),
  value: z.any(),
});
const ToolOutputContentItemSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({
    type: z.literal("media"),
    data: z.string(),
    mediaType: z.string(),
  }),
]);
const ToolOutputContentSchema = z.object({
  type: z.literal("content"),
  value: z.array(ToolOutputContentItemSchema),
});
const ToolOutputSchema = z.union([
  ToolOutputTextSchema,
  ToolOutputJsonSchema,
  ToolOutputErrorTextSchema,
  ToolOutputErrorJsonSchema,
  ToolOutputContentSchema,
]);

export function toToolOutput(raw: unknown): LanguageModelV2ToolResultOutput {
  // Pass-through if it already matches the expected union
  const parsed = ToolOutputSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data as LanguageModelV2ToolResultOutput;
  }
  // Strings become text output
  if (typeof raw === "string") {
    return { type: "text", value: raw };
  }
  // If it's a valid JSON value, wrap as json output; otherwise, coerce via stringify/parse
  if (isJSONValue(raw)) {
    return { type: "json", value: raw as JSONValue };
  }
  try {
    const value = JSON.parse(JSON.stringify(raw)) as JSONValue;
    return { type: "json", value };
  } catch {
    return {
      type: "error-text",
      value: "Tool returned non-serializable result",
    };
  }
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
  const msg: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: args.toolCallId,
        toolName: args.toolName,
        output: toToolOutput(args.result),
      },
    ],
  };
  return [...messages, msg];
}

/**
 * Build messages to pass into the decision step. This function normalizes
 * messages by:
 * - Dropping all `tool` role messages (generateObject doesn't accept them)
 * - For messages with array content, extracting only `{ type: "text", text }` parts
 * - Skipping messages that become empty after filtering
 * - Optionally appending the prior assistant text as a separate assistant message
 *
 * Note: The decision step itself appends the instruction prompt; we do not
 * add that here to avoid duplication.
 */
export function buildDecisionMessages(
  messages: ModelMessage[],
  priorAssistantText?: string,
): ModelMessage[] {
  const normalized: ModelMessage[] = [];

  for (const msg of messages) {
    // Drop all tool messages
    if (msg.role === "tool") {
      continue;
    }

    // Handle string content (keep as-is)
    if (typeof msg.content === "string") {
      normalized.push({
        role: msg.role,
        content: msg.content,
      });
      continue;
    }

    // Handle array content - extract only text parts
    if (Array.isArray(msg.content)) {
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (
          typeof part === "object" &&
          part !== null &&
          "type" in part &&
          part.type === "text" &&
          "text" in part &&
          typeof part.text === "string"
        ) {
          textParts.push(part.text);
        }
      }

      // Skip messages that have no text content after filtering
      if (textParts.length === 0) {
        continue;
      }

      // Join text parts with newlines
      normalized.push({
        role: msg.role,
        content: textParts.join("\n"),
      });
    }

    // For other content types, skip (shouldn't happen in normal flow)
  }

  // Append priorAssistantText if provided
  if (priorAssistantText) {
    return appendAssistantText(normalized, priorAssistantText);
  }

  return normalized;
}

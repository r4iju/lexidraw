import "server-only";

import type { ModelMessage, LanguageModel } from "ai";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import env from "@packages/env";
import type { EffectiveLlmConfig } from "~/server/llm/get-effective-config";
import type { AgentEvent } from "@packages/types";
import { getAiSdkToolMap } from "~/server/llm/tools/registry";
import { generateUUID } from "~/lib/utils";

export interface CallLlmStepArgs {
  messages: ModelMessage[];
  system: string;
  config: EffectiveLlmConfig;
  allowedTools: string[];
}

export interface ToolCallDescriptor {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface CallLlmStepResult {
  text: string;
  toolCalls?: ToolCallDescriptor[];
  messageId: string;
}

/**
 * SSE writer utility that writes events in the format:
 * id: <eventId>\n
 * event: <type>\n
 * data: <JSON string>\n\n
 */
export class SSEWriter {
  private eventId = 0;
  private encoder = new TextEncoder();
  private controller: ReadableStreamDefaultController<Uint8Array>;

  constructor(controller: ReadableStreamDefaultController<Uint8Array>) {
    this.controller = controller;
  }

  write(event: AgentEvent): void {
    const id = String(this.eventId++);
    const eventWithId = { ...event, id };
    const lines = [
      `id: ${id}`,
      `event: ${event.type}`,
      `data: ${JSON.stringify(eventWithId)}`,
      "",
      "",
    ];
    const chunk = this.encoder.encode(lines.join("\n"));
    this.controller.enqueue(chunk);
  }

  close(): void {
    this.controller.close();
  }
}

export async function callLlmStep(
  args: CallLlmStepArgs,
): Promise<CallLlmStepResult> {
  "use step";

  const { messages, system, config } = args;
  // Note: allowedTools is not used yet - will be used in Phase 4 to map tools

  // Create model instance
  const openaiApiKey = env.OPENAI_API_KEY;
  const googleApiKey = env.GOOGLE_API_KEY;

  let model: ReturnType<
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createGoogleGenerativeAI>
  > | null = null;

  if (config.provider === "openai") {
    if (!openaiApiKey) {
      throw new Error("Missing OpenAI API key");
    }
    const openai = createOpenAI({ apiKey: openaiApiKey });
    model = openai(config.modelId);
  } else if (config.provider === "google") {
    if (!googleApiKey) {
      throw new Error("Missing Google API key");
    }
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    model = google(config.modelId);
  } else {
    throw new Error(`Unsupported provider: ${config.provider}`);
  }

  const messageId = generateUUID();
  let accumulatedText = "";

  // For now, use generateText (non-streaming) since we need to collect tool calls
  // TODO: In Phase 4, we'll use streamText and handle tool calls during streaming
  const isReasoning =
    config.modelId.includes("gpt-5") ||
    config.modelId.includes("o1") ||
    config.modelId.includes("o3");

  console.log(
    "[callLlmStep] start",
    JSON.stringify({
      provider: config.provider,
      modelId: config.modelId,
      isReasoning,
      messages: messages.length,
      systemLen: system.length,
      allowedTools: args.allowedTools?.length ?? 0,
    }),
  );

  const result = await generateText({
    model: model as unknown as LanguageModel,
    messages,
    system,
    ...(isReasoning ? {} : { temperature: config.temperature }),
    maxOutputTokens: config.maxOutputTokens,
    tools: getAiSdkToolMap(args.allowedTools ?? []),
  });

  console.log(
    "[callLlmStep] result",
    JSON.stringify({
      textLen: (result.text || "").length,
      toolCalls: result.toolCalls ? result.toolCalls.length : 0,
      messageId,
    }),
  );

  const text = result.text ?? "";
  accumulatedText = text;

  // Streaming is handled by the workflow after this step returns

  // Extract tool calls from result
  const toolCalls: ToolCallDescriptor[] =
    result.toolCalls?.map((tc) => ({
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: (tc.input ?? {}) as Record<string, unknown>,
    })) ?? [];

  return {
    text: accumulatedText,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    messageId,
  };
}

import "server-only";

import type { ModelMessage } from "ai";
import type { EffectiveLlmConfig } from "~/server/llm/get-effective-config";
import type { AgentEvent } from "@packages/types";

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
  _args: CallLlmStepArgs,
): Promise<CallLlmStepResult> {
  "use step";
  throw new Error(
    "Legacy agent paid steps are disabled. Use the bounded parent operation.",
  );
}

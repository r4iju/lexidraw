import "server-only";

import type { ModelMessage } from "ai";

export type MinimalMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
};

export function toModelMessages(
  messages: ReadonlyArray<ModelMessage | MinimalMessage>,
): ModelMessage[] {
  // For MVP we trust upstream to provide valid shapes; this narrows the type
  return messages as ModelMessage[];
}

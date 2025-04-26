import { createCommand } from "lexical";
import { type ChatToolCall } from "./store";

export const SEND_SELECTION_TO_LLM_COMMAND = createCommand<{
  prompt: string;
  selectionHtml?: string;
}>("SEND_SELECTION_TO_LLM_COMMAND");

export const TOGGLE_LLM_CHAT_COMMAND = createCommand<undefined>(
  "TOGGLE_LLM_CHAT_COMMAND",
);

export type ExecuteLlmToolCallPayload = {
  toolCall: ChatToolCall;
};
export const EXECUTE_LLM_TOOL_CALL_COMMAND =
  createCommand<ExecuteLlmToolCallPayload>("EXECUTE_LLM_TOOL_CALL_COMMAND");

import { useCallback } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { useLLM, type AppToolCall } from "../../context/llm-context";
import { useRuntimeTools } from "./runtime-tools-provider";
import type { ToolChoice, ToolSet } from "ai";
import { useSystemPrompt } from "./use-system-prompt";

// Define a more specific type for messages used in history building
// (Matches the structure in llm-chat-context.tsx)
type HistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: AppToolCall[];
};

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages } = useChatState();
  const { generateChatStream, chatState } = useLLM();
  const runtimeTools = useRuntimeTools();

  const systemPromptBase = "You are a helpful assistant.";
  const systemPrompt = useSystemPrompt(systemPromptBase);

  return useCallback(
    async ({
      prompt,
      editorStateJson,
    }: {
      prompt: string;
      editorStateJson?: string;
    }) => {
      if (!prompt?.trim()) {
        console.warn("attempted to send empty query.");
        return;
      }

      const userMessageId = crypto.randomUUID();
      dispatch({
        type: "push",
        msg: { id: userMessageId, role: "user", content: prompt },
      });

      try {
        // --- Construct the full initial prompt string ---
        const historyToInclude = messages
          .filter((msg: HistoryMessage) => msg.role !== "system")
          .map((msg: HistoryMessage) => {
            const prefix = msg.role === "user" ? "USER:" : "ASSISTANT:";
            let content = msg.content ?? "";
            if (msg.toolCalls) {
              content += `\n(Tool Calls: ${JSON.stringify(msg.toolCalls)})`;
            }
            // We don't include tool results in this history view
            return `${prefix} ${content}`;
          })
          .join("\n\n");

        let fullPrompt = "";
        if (historyToInclude) {
          fullPrompt += `CHAT_HISTORY:\n${historyToInclude}\n\n`;
        }
        fullPrompt += `USER_PROMPT:\n${prompt}`;
        // Add JSON state if in agent mode and available
        if (mode === "agent" && editorStateJson) {
          console.log(" Attaching initial JSON state to prompt.");
          fullPrompt += `\n\nJSON_STATE:\n${editorStateJson}`;
        }
        // --- End Prompt Construction ---

        await generateChatStream({
          prompt: fullPrompt, // Pass the fully constructed prompt
          system: systemPrompt,
          temperature: chatState.temperature,
          maxTokens: chatState.maxTokens,
          tools: mode === "agent" ? runtimeTools : undefined,
          maxSteps: 5,
          repairToolCall: async ({
            toolCall,
            error,
            messages: sdkMessages,
          }) => {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            sdkMessages.push({
              role: "assistant",
              content: `I tried calling \`${toolCall.toolName}\` with ${JSON.stringify(toolCall.args)} but got an error: "${errMsg}". I'll adjust my arguments and try again.`,
            });
            return toolCall;
          },

          // Simplified prepareStep: Only handles tool choice logic
          prepareStep: async ({ stepNumber }: { stepNumber: number }) => {
            console.log(
              `prepareStep ${stepNumber}: Determining tool choice...`,
            );

            let stepOptions: { toolChoice?: ToolChoice<ToolSet> } = {}; // Only return toolChoice
            switch (stepNumber) {
              case 0:
                stepOptions = {
                  toolChoice: {
                    type: "tool",
                    toolName: "requestClarificationOrPlan",
                  },
                };
                break;
              case 1:
              case 2:
              case 3:
                stepOptions = { toolChoice: "auto" };
                break;
              case 4:
                stepOptions = {
                  toolChoice: { type: "tool", toolName: "summarizeExecution" },
                };
                break;
              default:
                console.warn(
                  `Unexpected stepNumber in prepareStep: ${stepNumber}`,
                );
                stepOptions = { toolChoice: "auto" };
            }
            // Return only step-specific config, not the prompt
            return stepOptions;
          },
        });
      } catch (error) {
        console.error(
          "Error in useSendQuery during LLM call or tool processing:",
          error,
        );
        dispatch({
          type: "push",
          msg: {
            id: crypto.randomUUID(),
            role: "system",
            content: "An error occurred while processing your request.",
          },
        });
      }
    },
    [
      dispatch,
      messages,
      mode,
      generateChatStream,
      systemPrompt,
      chatState.temperature,
      chatState.maxTokens,
      runtimeTools,
    ],
  );
};

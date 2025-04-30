import { useCallback } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { useLLM } from "../../context/llm-context";
import { useRuntimeTools } from "./runtime-tools-provider";
import type { ToolChoice, ToolSet } from "ai";
import { useSystemPrompt } from "./use-system-prompt";

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
      editorStateMarkdown,
      editorStateJson,
    }: {
      prompt: string;
      editorStateJson?: string;
      editorStateMarkdown?: string;
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
        const historyToInclude = messages
          .filter((msg) => msg.role !== "system")
          .slice(0, -1)
          .map((msg) => {
            const prefix = msg.role === "user" ? "USER:" : "ASSISTANT:";
            const toolCallContent =
              msg.toolCalls && msg.toolCalls.length > 0
                ? `\n(Tool Call: ${JSON.stringify(msg.toolCalls)})`
                : "";
            return `${prefix} ${msg.content}${toolCallContent}`;
          })
          .join("\n\n");

        let fullPrompt = "";
        if (historyToInclude) {
          fullPrompt += `CHAT_HISTORY:\n${historyToInclude}\n\n`;
        }
        fullPrompt += `USER_PROMPT:\n${prompt}`;
        if (mode === "agent" && editorStateJson) {
          fullPrompt += `\n\nJSON_STATE:\n${editorStateJson}`;
        }
        if (mode === "chat" && editorStateMarkdown) {
          fullPrompt += `\n\nDOCUMENT_STATE:\n${editorStateMarkdown}`;
        }

        await generateChatStream({
          prompt: fullPrompt,
          system: systemPrompt,
          temperature: chatState.temperature,
          maxTokens: chatState.maxTokens,
          tools: mode === "agent" ? runtimeTools : undefined,
          maxSteps: 5,
          repairToolCall: async ({
            toolCall,
            error,
            messages,
            // tools,
            // parameterSchema,
          }) => {
            const errMsg =
              error instanceof Error ? error.message : String(error);
            messages.push({
              role: "assistant",
              content: `I tried calling \`${toolCall.toolName}\` with ${JSON.stringify(toolCall.args)} but got an error: "${errMsg}". I'll adjust my arguments and try again.`,
            });

            return toolCall;
          },
          prepareStep: ({ stepNumber }) => {
            console.log("prepareStep called with stepNumber:", stepNumber);
            let stepOptions: { toolChoice?: ToolChoice<ToolSet> } = {};
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
                stepOptions = {};
            }
            return Promise.resolve(stepOptions);
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

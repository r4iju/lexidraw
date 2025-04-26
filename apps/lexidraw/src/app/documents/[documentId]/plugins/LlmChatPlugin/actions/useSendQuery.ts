import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useDispatchToolCalls } from "../lexical/commandBus";
import { useChatDispatch } from "../context/LlmChatContext";
import { useLLM } from "../../../context/llm-context";
import type { AppToolCall } from "../../../context/llm-context";

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { generateChatStream, chatState } = useLLM();
  const [editor] = useLexicalComposerContext();
  const { dispatchToolCalls } = useDispatchToolCalls(editor);

  return useCallback(
    async (prompt: string, editorStateJson?: string) => {
      if (!prompt?.trim()) {
        console.warn("attempted to send empty query.");
        return;
      }

      const userMessageId = crypto.randomUUID();
      dispatch({
        type: "push",
        msg: { id: userMessageId, role: "user", content: prompt },
      });
      dispatch({ type: "setStreaming", flag: true });

      try {
        const ctx = editorStateJson ? `JSON_STATE:\n${editorStateJson}` : "";
        const fullPrompt = ctx ? `${prompt}\n\n${ctx}` : prompt;

        const { text, toolCalls } = await generateChatStream({
          prompt: fullPrompt,
          temperature: chatState.temperature,
          maxTokens: chatState.maxTokens,
        });

        const assistantMessageId = crypto.randomUUID();
        dispatch({
          type: "push",
          msg: {
            id: assistantMessageId,
            role: "assistant",
            content: text,
            toolCalls: toolCalls as AppToolCall[] | undefined,
          },
        });

        if (toolCalls && toolCalls.length > 0) {
          console.log("Dispatching tool calls from useSendQuery:", toolCalls);
          dispatchToolCalls(toolCalls as AppToolCall[]);
        } else {
          console.log("No tool calls to dispatch.");
        }
      } catch (error) {
        console.error(
          "Error in useSendQuery during LLM call or tool dispatch:",
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
      } finally {
        dispatch({ type: "setStreaming", flag: false });
      }
    },
    [
      dispatch,
      generateChatStream,
      chatState.temperature,
      chatState.maxTokens,
      dispatchToolCalls,
    ],
  );
};

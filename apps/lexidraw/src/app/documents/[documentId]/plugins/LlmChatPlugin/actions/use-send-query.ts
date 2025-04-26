import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useDispatchToolCalls } from "../lexical/commandBus";
import { useChatDispatch, useChatState } from "../context/llm-chat-context";
import { useLLM } from "../../../context/llm-context";
import type { AppToolCall } from "../../../context/llm-context";

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode } = useChatState();
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
        let systemPrompt = "You are a helpful assistant.";
        if (editorStateJson) {
          systemPrompt += `\n\nThe user has provided the current document state as a JSON object below the main prompt, labeled 'JSON_STATE:'.`;
          if (mode === "agent") {
            systemPrompt += `\nWhen you need to modify the document, use the 'editText' tool. This tool requires you to provide the *entire*, updated document state as a single JSON string argument named 'newStateJson'. Ensure the JSON is valid and represents the complete desired state of the document after your edits.`;
          }
        }

        const ctx = editorStateJson ? `JSON_STATE:\n${editorStateJson}` : "";
        const fullPrompt = ctx ? `${prompt}\n\n${ctx}` : prompt;

        const { text, toolCalls } = await generateChatStream({
          prompt: fullPrompt,
          system: systemPrompt,
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
      mode,
      generateChatStream,
      chatState.temperature,
      chatState.maxTokens,
      dispatchToolCalls,
    ],
  );
};

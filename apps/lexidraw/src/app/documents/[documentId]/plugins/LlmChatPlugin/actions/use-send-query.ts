import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useChatDispatch, useChatState } from "../context/llm-chat-context";
import { useLLM } from "../../../context/llm-context";
import { useLexicalTools } from "../lexical/tool-executors";

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode } = useChatState();
  const { generateChatStream, chatState } = useLLM();
  const [editor] = useLexicalComposerContext();
  const { lexicalLlmTools } = useLexicalTools(editor);

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
            systemPrompt += `\nWhen you need to modify the document, use the 'editText' tool.`;
            systemPrompt += `\nProvide the *entire*, updated document state as **a single, valid JSON string** in the 'newStateJson' argument.`;
            systemPrompt += `\n**Important:** The value MUST be a string containing ONLY the stringified JSON for the complete Lexical editor state object (starting with '{"root":...}' and ending with the corresponding closing brace '}').`;
            systemPrompt += `\nDo NOT include any extra characters, commas, keys, text, or explanations before the opening '{' or after the final closing '}' of the main root object.`;
            systemPrompt += `\nEnsure the JSON string itself is perfectly valid according to JSON syntax rules.`;
          }
        }

        const ctx = editorStateJson ? `JSON_STATE:\n${editorStateJson}` : "";
        const fullPrompt = ctx ? `${prompt}\n\n${ctx}` : prompt;

        const { text, toolCalls } = await generateChatStream({
          prompt: fullPrompt,
          system: systemPrompt,
          temperature: chatState.temperature,
          maxTokens: chatState.maxTokens,
          tools: mode === "agent" ? lexicalLlmTools : undefined,
        });

        const assistantMessageId = crypto.randomUUID();
        dispatch({
          type: "push",
          msg: {
            id: assistantMessageId,
            role: "assistant",
            content: text,
            toolCalls: toolCalls,
          },
        });

        console.log(
          "Tool calls returned by generateChatStream (execution handled by SDK):",
          toolCalls,
        );
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
      mode,
      lexicalLlmTools,
    ],
  );
};

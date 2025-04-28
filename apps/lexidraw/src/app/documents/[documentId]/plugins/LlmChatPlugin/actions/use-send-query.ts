import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useChatDispatch, useChatState } from "../context/llm-chat-context";
import { useLLM } from "../../../context/llm-context";
import { useLexicalTools } from "../lexical/tool-executors";
import { useImageInsertion } from "~/hooks/use-image-insertion";

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages } = useChatState();
  const { generateChatStream, chatState } = useLLM();
  const [editor] = useLexicalComposerContext();
  const { searchAndInsertImage } = useImageInsertion();
  const { lexicalLlmTools } = useLexicalTools(editor, searchAndInsertImage);

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
      dispatch({ type: "setStreaming", flag: true });

      try {
        let systemPrompt = "You are a helpful assistant.";
        systemPrompt += `\n\nThe user may provide the current document state below the main prompt.`;
        systemPrompt += `\nThe chat history leading up to the current request may also be provided below, labeled 'CHAT_HISTORY:'.`;

        switch (mode) {
          case "agent":
            systemPrompt += `\n\nThe document state is provided as a JSON object labeled 'JSON_STATE:'.`;
            systemPrompt += `\n\n**Critical Instruction:** To modify the document content based on the user's request and the provided JSON_STATE, you MUST call the 'updateDocumentSemantically' tool.`;
            systemPrompt += `\nDo NOT output the JSON changes as plain text in your response. You MUST invoke the tool.`;
            systemPrompt += `\nThe 'updateDocumentSemantically' tool requires an 'instructions' argument, which is an array of semantic instruction objects executed in order.`;
            systemPrompt += `\nSupported operations: 'formatBlock', 'insertBlock', 'deleteBlock'.`;
            systemPrompt += `\n**Important:** All operations identify target blocks using 'anchorText', which must be some unique text content found within the target block in the JSON_STATE.`;

            systemPrompt += `\n\n--- Operations ---`;

            systemPrompt += `\n\n  **formatBlock**: Changes the type of an existing block.`;
            systemPrompt += `\n    - Requires: 'anchorText' (text within target), 'formatAs' ('paragraph', 'heading', or 'list').`;
            systemPrompt += `\n    - If 'formatAs' is 'heading', requires 'headingTag' ('h1'-'h6').`;
            systemPrompt += `\n    - If 'formatAs' is 'list', requires 'listType' ('bullet', 'number', 'check').`;
            systemPrompt += `\n    - Note: This operation internally inserts a new block with the original text and deletes the old one.`;
            systemPrompt += `\n    - Example (format block with "Old text" as h2): { "operation": "formatBlock", "anchorText": "Old text", "formatAs": "heading", "headingTag": "h2" }`;
            systemPrompt += `\n    - Example (format block with "Item text" as bullet list): { "operation": "formatBlock", "anchorText": "Item text", "formatAs": "list", "listType": "bullet" }`;

            systemPrompt += `\n\n  **insertBlock**: Inserts a new block.`;
            systemPrompt += `\n    - Requires: 'text' (new content), 'blockType' ('paragraph', 'heading', or 'list'), 'relation' ('before', 'after', 'appendRoot').`;
            systemPrompt += `\n    - If 'blockType' is 'heading', requires 'headingTag' ('h1'-'h6').`;
            systemPrompt += `\n    - If 'blockType' is 'list', requires 'listType' ('bullet', 'number', 'check'). The 'text' becomes the content of the first list item.`;
            systemPrompt += `\n    - If 'relation' is 'before' or 'after', requires 'anchorText' (text in the block to insert relative to).`;
            systemPrompt += `\n    - If 'relation' is 'appendRoot', 'anchorText' is ignored.`;
            systemPrompt += `\n    - List Insertion Note: If inserting a list item ('blockType': 'list') relative to another list item of the *same* 'listType', it will be added to that existing list. Otherwise, a new list will be created.`;
            systemPrompt += `\n    - Example (insert paragraph "New para" before block "Some text"): { "operation": "insertBlock", "text": "New para", "blockType": "paragraph", "relation": "before", "anchorText": "Some text" }`;
            systemPrompt += `\n    - Example (append h3 "Conclusion"): { "operation": "insertBlock", "text": "Conclusion", "blockType": "heading", "headingTag": "h3", "relation": "appendRoot" }`;
            systemPrompt += `\n    - Example (insert numbered list item "Step 1" after block "Introduction"): { "operation": "insertBlock", "text": "Step 1", "blockType": "list", "listType": "number", "relation": "after", "anchorText": "Introduction" }`;
            systemPrompt += `\n    - Example (insert another bullet item "Point B" after list item "Point A"): { "operation": "insertBlock", "text": "Point B", "blockType": "list", "listType": "bullet", "relation": "after", "anchorText": "Point A" }`;

            systemPrompt += `\n\n  **deleteBlock**: Deletes an existing block.`;
            systemPrompt += `\n    - Requires: 'anchorText' (text within the block to delete).`;
            systemPrompt += `\n    - Note: If deleting the last item in a list, the entire list structure is removed.`;
            systemPrompt += `\n    - Example (delete block containing "Delete this"): { "operation": "deleteBlock", "anchorText": "Delete this" }`;

            systemPrompt += `\n\n--- Handling Replacements / Formatting ---`;
            systemPrompt += `\n  - To replace content or format a block (like changing paragraph to heading or list), use the **'formatBlock'** operation. Provide the 'anchorText' of the block to change and specify the desired 'formatAs' (and 'headingTag' or 'listType' if needed). The tool handles the insertion and deletion sequence internally.`;
            systemPrompt += `\n  - Example (replace block "Old paragraph" with h2 "New Heading"): { "operation": "formatBlock", "anchorText": "Old paragraph", "formatAs": "heading", "headingTag": "h2" }`;
            systemPrompt += `\n  - Example (change block "Make this a list" into a bullet point): { "operation": "formatBlock", "anchorText": "Make this a list", "formatAs": "list", "listType": "bullet" }`;

            systemPrompt += `\n\n**CRITICAL RESPONSE REQUIREMENT:**`;
            systemPrompt += `\n  - When the user asks for modifications to the document that require using the 'updateDocumentSemantically' tool:`;
            systemPrompt += `\n    - Your initial response requesting the tool MUST contain ONLY the tool call invocation.`;
            systemPrompt += `\n    - Do NOT include any conversational text, explanations, or the JSON structure itself as plain text in that initial response. The ONLY valid output is the tool call.`;
            systemPrompt += `\n    - (After the tool executes successfully, follow the IMPORTANT instruction below to confirm).`;

            systemPrompt += `\n\n**IMPORTANT:** After ANY tool executes successfully (you will receive the result with details/summary), ALWAYS respond with a brief confirmation message to the user summarizing what action you took. Do NOT just return an empty response.`;
            break;
          case "chat":
            systemPrompt += `\n\nThe document state is provided as Markdown labeled 'DOCUMENT_STATE:'.`;
            break;
          default:
            console.warn("Invalid mode in useSendQuery:", mode);
            break;
        }

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
      messages,
    ],
  );
};

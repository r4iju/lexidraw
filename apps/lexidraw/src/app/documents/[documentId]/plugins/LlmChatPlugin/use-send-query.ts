import { useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { useLLM } from "../../context/llm-context";
import { useLexicalTools } from "./tool-executors";
import { useImageInsertion } from "~/hooks/use-image-insertion";
import { useImageGeneration } from "~/hooks/use-image-generation";

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages } = useChatState();
  const { generateChatStream, chatState } = useLLM();
  const [editor] = useLexicalComposerContext();
  const { searchAndInsertImage } = useImageInsertion();
  const { generateAndInsertImage } = useImageGeneration();

  const { lexicalLlmTools } = useLexicalTools({
    editor,
    searchAndInsertImageFunc: searchAndInsertImage,
    generateAndInsertImageFunc: generateAndInsertImage,
  });

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
            // 1. Base Role & Context Info
            systemPrompt += `\n\nThe document state is provided as a JSON object labeled 'JSON_STATE:'. Each node in the JSON has a unique 'key' property.`;

            // 2. Core Task & Available Tools Overview
            systemPrompt += `\n\nYour primary goal is to assist the user with document modifications using tools. The main tools are:`;
            systemPrompt += `\n  - updateDocumentSemantically: For formatting, inserting, and deleting content blocks.`;
            systemPrompt += `\n  - imageGenerationTool: For generating new images from detailed text descriptions.`;
            systemPrompt += `\n  - searchAndInsertImage: For finding and inserting existing images based on a search query.`;

            // 3. updateDocumentSemantically Focus - Critical Instruction
            systemPrompt += `\n\n**Critical Instruction for Modifications:** To modify the document content based on the user's request and the provided JSON_STATE, you MUST call the 'updateDocumentSemantically' tool.`;
            systemPrompt += `\nDo NOT output the JSON changes as plain text in your response.`;

            // 4. updateDocumentSemantically Mechanics
            systemPrompt += `\nThe 'updateDocumentSemantically' tool requires an 'instructions' argument, which is an array of semantic instruction objects executed in order.`;
            systemPrompt += `\nOperations identify target blocks using either 'anchorKey' (the unique node key from JSON_STATE) or 'anchorText' (unique text within the block). **'anchorKey' is preferred if available and unambiguous.** Provide only one anchor per instruction.`;

            // 5. updateDocumentSemantically Detailed Operations
            systemPrompt += `\n\n--- updateDocumentSemantically Operations ---`;
            systemPrompt += `\n\n  **formatBlock**: Changes the type of an existing block.`;
            systemPrompt += `\n    - Requires: ('anchorKey' | 'anchorText'), 'formatAs' ('paragraph', 'heading', or 'list').`;
            systemPrompt += `\n    - If 'formatAs' is 'heading', requires 'headingTag' ('h1'-'h6').`;
            systemPrompt += `\n    - If 'formatAs' is 'list', requires 'listType' ('bullet', 'number', 'check').`;
            systemPrompt += `\n    - Example (format block key "123" as h2): { "operation": "formatBlock", "anchorKey": "123", "formatAs": "heading", "headingTag": "h2" }`;

            systemPrompt += `\n\n  **insertBlock**: Inserts a new block.`;
            systemPrompt += `\n    - Requires: 'text', 'blockType' ('paragraph', 'heading', 'list'), 'relation' ('before', 'after', 'appendRoot').`;
            systemPrompt += `\n    - Optional: 'headingTag', 'listType'.`;
            systemPrompt += `\n    - Requires ('anchorKey' | 'anchorText') if 'relation' is 'before' or 'after'.`;
            systemPrompt += `\n    - Example (insert paragraph "New para" before block key "456"): { "operation": "insertBlock", "text": "New para", "blockType": "paragraph", "relation": "before", "anchorKey": "456" }`;

            systemPrompt += `\n\n  **deleteBlock**: Deletes an existing block.`;
            systemPrompt += `\n    - Requires: ('anchorKey' | 'anchorText') of the block to delete.`;
            systemPrompt += `\n    - Works for any block type identified by key or text.`;
            systemPrompt += `\n    - Example (delete block with key "789"): { "operation": "deleteBlock", "anchorKey": "789" }`;

            // 6. updateDocumentSemantically Replacement Handling
            systemPrompt += `\n\n--- Handling Replacements / Formatting (using updateDocumentSemantically) ---`;
            systemPrompt += `\n  - To replace content or format a block (like changing paragraph to heading or list), use the **'formatBlock'** operation.`;
            systemPrompt += `\n  - Example (replace block key "101" with h2 "New Heading"): { "operation": "formatBlock", "anchorKey": "101", "formatAs": "heading", "headingTag": "h2" }`;

            // 7. Image Tool Details
            systemPrompt += `\n\n--- Image Handling ---`;
            systemPrompt += `\n  - **Generating Images:** Use 'imageGenerationTool' with a detailed 'prompt'.`;
            systemPrompt += `\n    - Create descriptive prompts: Include Style, Subject, Environment, Mood, Color Palette, Lighting.`;
            systemPrompt += `\n    - Example Prompt Structure: "Generate a [Style] image of [Subject] in a [Environment], featuring [Mood], with [Color Palette] and [Lighting]."`;
            systemPrompt += `\n  - **Searching Images:** Use 'searchAndInsertImage' with a 'query' parameter.`;
            systemPrompt += `\n  - **Deleting Images:** Use 'updateDocumentSemantically' with the 'deleteBlock' operation and the image node's 'anchorKey'.`;

            // 8. Interaction Protocol
            systemPrompt += `\n\n--- Interaction Protocol ---`;
            systemPrompt += `\n  - **Clarification:** If the user's request is ambiguous, lacks sufficient detail for a tool call, or could be interpreted multiple ways, **ASK the user clarifying questions** before attempting to call *any* tool. Do not guess.`;
            systemPrompt += `\n  - **Critical Response (Modification Tool):** When calling 'updateDocumentSemantically', your response MUST contain ONLY the tool call invocation. Do not include any other text.`;
            systemPrompt += `\n  - **Confirmation (Post-Execution):** After ANY tool executes successfully (you will receive the result), ALWAYS respond with a brief confirmation message to the user summarizing what action was taken.`;

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
      mode,
      messages,
      generateChatStream,
      chatState.temperature,
      chatState.maxTokens,
      lexicalLlmTools,
    ],
  );
};

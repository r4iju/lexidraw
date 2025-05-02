import { useCallback, useMemo } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { useLLM, type AppToolCall } from "../../context/llm-context";
import { useRuntimeTools } from "./runtime-tools-provider";
import type { ToolChoice, ToolSet } from "ai";
import { useSystemPrompt } from "./use-system-prompt";
// TODO: Implement or import a Lexical -> Markdown conversion utility
// import { $convertToMarkdownString } from '@lexical/markdown'; // Example if using official package
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { EditorState, $getRoot } from "lexical";

// Define a more specific type for messages used in history building
// (Matches the structure in llm-chat-context.tsx)
type HistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: AppToolCall[];
};

// Placeholder for Markdown conversion
// TODO: Replace with actual implementation
function convertEditorStateToMarkdown(editorState: EditorState): string {
  console.warn(
    "[convertEditorStateToMarkdown] Using placeholder implementation. Please implement actual conversion.",
  );
  return editorState.read(() => {
    try {
      // Attempt a very basic text extraction as a fallback
      // Use more specific types where possible
      const root = $getRoot();
      const rootChildren = root.getChildren();
      const textContent = rootChildren
        .map((node) => node.getTextContent())
        .join("\n");

      return textContent.trim() !== ""
        ? textContent
        : "[Unable to generate basic Markdown preview - Empty Document?]";
    } catch (e: unknown) {
      // Type the error
      console.error(
        "[convertEditorStateToMarkdown] Error during placeholder conversion:",
        e,
      ); // Log the error
      return "[Error generating Markdown preview]";
    }
  });
}

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages } = useChatState();
  const { generateChatStream, chatState } = useLLM();
  const runtimeTools = useRuntimeTools();
  const [editor] = useLexicalComposerContext();

  const systemPromptBase = "You are a helpful assistant.";
  const systemPrompt = useSystemPrompt(systemPromptBase);

  // Reinstate separating the sendReply tool for chat mode
  const sendReplyTool = useMemo(() => {
    return runtimeTools.sendReply
      ? { sendReply: runtimeTools.sendReply }
      : undefined;
  }, [runtimeTools.sendReply]);

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
            return `${prefix} ${content}`;
          })
          .join("\n\n");

        let fullPrompt = "";
        if (historyToInclude) {
          fullPrompt += `CHAT_HISTORY:\n${historyToInclude}\n\n`;
        }
        fullPrompt += `USER_PROMPT:\n${prompt}`;

        // Add context based on mode (Markdown for chat, JSON for agent)
        const currentEditorState = editor.getEditorState();
        if (mode === "chat" && currentEditorState) {
          console.log(" Attaching Markdown context to prompt (Chat Mode).");
          const markdownContent =
            convertEditorStateToMarkdown(currentEditorState);
          fullPrompt += `\n\nMARKDOWN_CONTEXT:\n${markdownContent}`;
        } else if (mode === "agent" && editorStateJson) {
          console.log(" Attaching JSON state to prompt (Agent Mode).");
          fullPrompt += `\n\nJSON_STATE:\n${editorStateJson}`;
        }
        // --- End Prompt Construction ---

        // --- Determine tools and prepareStep logic based on mode ---
        const toolsForMode = mode === "chat" ? sendReplyTool : runtimeTools;
        const prepareStepForMode = async ({
          stepNumber,
        }: {
          stepNumber: number;
        }) => {
          console.log(
            `prepareStep ${stepNumber}: Determining tool choice (mode: ${mode})...`,
          );

          let stepOptions: { toolChoice?: ToolChoice<ToolSet> } = {};

          if (mode === "chat") {
            // In chat mode, always force sendReply if available
            if (sendReplyTool) {
              stepOptions = {
                toolChoice: { type: "tool", toolName: "sendReply" },
              };
            } else {
              console.warn(
                "Chat mode selected but sendReplyTool is not available!",
              );
              stepOptions = { toolChoice: "none" }; // Should not happen if tool exists
            }
          } else {
            // Agent mode logic
            switch (stepNumber) {
              case 0:
                // Allow LLM to choose first step (plan/clarify, sendReply, or direct action if simple)
                stepOptions = { toolChoice: "auto" };
                break;
              case 1:
              case 2:
              case 3: // Steps 1, 2, 3 allow auto tool choice
                stepOptions = { toolChoice: "auto" };
                break;
              case 4: // Step 4 forces summary
                stepOptions = {
                  toolChoice: { type: "tool", toolName: "summarizeExecution" },
                };
                break;
              default:
                console.warn(
                  `Unexpected stepNumber in agent prepareStep: ${stepNumber}`,
                );
                stepOptions = { toolChoice: "auto" };
            }
          }
          return stepOptions;
        };
        // --- End Mode-Specific Logic ---

        await generateChatStream({
          prompt: fullPrompt,
          system: systemPrompt,
          temperature: chatState.temperature,
          maxTokens: chatState.maxTokens,
          tools: toolsForMode, // Use the mode-specific tools
          maxSteps: 1, // Always 1 step for chat, agent uses own logic implicitly via prepareStep
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
          prepareStep: prepareStepForMode,
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
      editor,
      sendReplyTool, // Add back sendReplyTool dependency
    ],
  );
};

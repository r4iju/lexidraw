import { useCallback } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { type ToolChoice, type ToolSet } from "ai";
import {
  useLLM,
  type AppToolCall,
  type StreamCallbacks,
  type GenerateChatResponseResult,
} from "../../context/llm-context";
import { useRuntimeTools } from "./runtime-tools-provider";
import { useSystemPrompt } from "./use-system-prompt";
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
  const { generateChatStream, generateChatResponse, chatState } = useLLM();
  const runtimeTools = useRuntimeTools();
  const [editor] = useLexicalComposerContext();

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

        // --- Select generation function based on mode ---
        if (mode === "chat") {
          console.log("Using generateChatStream for chat mode");
          const assistantMessageId = crypto.randomUUID();
          // Add placeholder assistant message for streaming
          dispatch({
            type: "push",
            msg: { id: assistantMessageId, role: "assistant", content: "" },
          });

          const streamCallbacks: StreamCallbacks = {
            onTextUpdate: (textChunk) => {
              // Update the content of the last assistant message incrementally
              dispatch({
                type: "update",
                msg: {
                  id: assistantMessageId,
                  role: "assistant",
                  content: textChunk,
                },
              });
            },
            onFinish: (result) => {
              console.log("Streaming finished:", result);
              // Final update - use simple result (text only)
              dispatch({
                type: "update",
                msg: {
                  id: assistantMessageId,
                  role: "assistant",
                  content: result.text,
                },
              });
            },
            onError: (error) => {
              console.error("Error during chat stream:", error);
              dispatch({
                type: "update", // Update the placeholder message with error info
                msg: {
                  id: assistantMessageId,
                  role: "assistant", // Ensure role is set
                  content: `Error: ${error.message}`,
                },
              });
            },
          };

          await generateChatStream({
            prompt: fullPrompt,
            system: systemPrompt,
            temperature: chatState.temperature,
            maxTokens: chatState.maxTokens,
            maxSteps: 1,
            callbacks: streamCallbacks,
          });
        } else {
          const prepareStepForMode = async ({
            steps,
            stepNumber,
            maxSteps: _maxSteps,
            model: _model,
          }: {
            steps: readonly { toolResults?: AppToolCall[] }[];
            stepNumber: number;
            maxSteps: number;
            model: unknown;
          }): Promise<{ toolChoice?: ToolChoice<ToolSet> }> => {
            console.log(
              `prepareStep ${stepNumber}: Checking previous step results (mode: ${mode})...`,
            );

            const previousStep = steps[stepNumber - 1] || null;
            const previousToolCallName =
              previousStep?.toolResults?.at(-1)?.toolName;
            console.log(
              `prepareStep ${stepNumber}: Previous step results:`,
              previousStep,
              previousToolCallName,
            );

            if (
              previousToolCallName &&
              [
                "summarizeExecution",
                "requestClarificationOrPlan",
                "sendReply",
              ].includes(previousToolCallName)
            ) {
              console.log(
                `Step ${stepNumber}: sendReply, summarizeExecution or requestClarificationOrPlan detected in previous step. Forcing toolChoice: 'none'`,
              );
              const error = new Error("TERMINAL_TOOL_CALL_DETECTED");
              error.name = "ExitError";
              throw error;
            }

            // Allow up to maxSteps - 1 tool calls, then force summarize or none
            const maxToolSteps = 5; // Allow tools up to step 4 (0, 1, 2, 3, 4)
            if (stepNumber >= maxToolSteps) {
              // On the last allowed step, prefer summarizeExecution if available
              if (
                runtimeTools.summarizeExecution &&
                stepNumber === maxToolSteps
              ) {
                console.log(
                  `Step ${stepNumber}: Reached max tool steps, forcing toolChoice: 'summarizeExecution'`,
                );
                return {
                  toolChoice: { type: "tool", toolName: "summarizeExecution" },
                };
              } else {
                console.log(
                  `Step ${stepNumber}: Reached max steps or summarizeExecution unavailable. Forcing toolChoice: 'none'`,
                );
                return { toolChoice: "none" };
              }
            }

            console.log(
              `Step ${stepNumber}: Allowing LLM to choose tools (toolChoice: 'auto')`,
            );
            return { toolChoice: "auto" };
          };

          // Call generateChatResponse for agent mode
          const responseResult: GenerateChatResponseResult =
            await generateChatResponse({
              prompt: fullPrompt,
              system: systemPrompt,
              temperature: chatState.temperature,
              maxTokens: chatState.maxTokens,
              tools: runtimeTools,
              maxSteps: 5,
              prepareStep: prepareStepForMode,
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
            });

          // Dispatch final agent message after response received
          const lastToolName = responseResult.toolResults?.at(-1)?.toolName;
          const alreadyReplied =
            lastToolName === "summarizeExecution" ||
            lastToolName === "requestClarificationOrPlan" ||
            lastToolName === "sendReply";

          // Only push a new assistant message when nothing has replied yet
          if (!alreadyReplied && responseResult.text.trim() !== "") {
            dispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: responseResult.text,
                toolCalls: responseResult.toolCalls,
                toolResults: responseResult.toolResults,
              },
            });
          }
        }
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
      generateChatResponse,
      systemPrompt,
      chatState.temperature,
      chatState.maxTokens,
      runtimeTools,
      editor,
    ],
  );
};

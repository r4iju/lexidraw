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
import { useMarkdownTools } from "../../utils/markdown";

// Define a more specific type for messages used in history building
// (Matches the structure in llm-chat-context.tsx)
type HistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: AppToolCall[];
};

// Utility: if the whole response is a sendReply code-block, unwrap it
function unwrapSendReply(jsonish: string): string | null {
  try {
    // remove ```json fences if present
    const cleaned = jsonish
      .replace(/^\s*```json/i, "")
      .replace(/```\s*$/i, "") // Adjusted regex for trailing fence
      .trim();
    const obj = JSON.parse(cleaned);
    if (
      obj.toolName === "sendReply" &&
      obj.args != null &&
      typeof obj.args.replyText === "string"
    ) {
      return obj.args.replyText;
    }
  } catch {
    /* ignore parse errors */
  }
  return null;
}

// Define the expected parameters for the sendQuery callback
interface SendQueryParams {
  prompt: string;
  editorStateJson?: string;
  files?: File[] | FileList | null; // Added optional file parameter
}

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages, maxAgentSteps } = useChatState();
  const { generateChatStream, generateChatResponse, llmConfig } = useLLM();
  const runtimeTools = useRuntimeTools();
  const [editor] = useLexicalComposerContext();

  const systemPrompt = useSystemPrompt(mode);
  const { convertEditorStateToMarkdown } = useMarkdownTools();

  return useCallback(
    async ({ prompt, editorStateJson, files }: SendQueryParams) => {
      // Use the interface here
      if (!prompt?.trim() && !files) {
        // Check if both prompt and file are absent
        console.warn("attempted to send empty query or file.");
        return;
      }

      const userMessageId = crypto.randomUUID();
      // If a file is present, add its name to the user's message content for display
      const userMessageContent = files
        ? `${prompt} (Files: ${Array.from(files)
            .map((f) => f.name)
            .join(", ")})`
        : prompt;

      dispatch({
        type: "push",
        msg: { id: userMessageId, role: "user", content: userMessageContent },
      });

      // For agent mode, set streaming state for the whole operation
      const agentOperationId = mode === "agent" ? crypto.randomUUID() : null;
      if (mode === "agent" && agentOperationId) {
        dispatch({ type: "startStreaming", id: agentOperationId });
      }

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
        if (files) {
          fullPrompt += `\nATTACHED_FILE_NAMES: ${Array.from(files)
            .map((f) => f.name)
            .join(", ")}`;
          // Note: The actual file content needs to be handled by the API call mechanism (e.g. FormData)
          // This prompt addition is just to inform the LLM about the file's presence and name.
        }

        // Add instruction for Markdown formatting
        fullPrompt += `\n\nFORMATTING_INSTRUCTION:\nStrictly format your final response text using Markdown. Do **not** output JSON or any other structured format. Keep Markdown nesting minimal (nested lists or quotes) and headings small for readability in a chat interface.`;

        // Add context based on mode (Markdown for chat, JSON for agent)
        const currentEditorState = editor.getEditorState();
        if (mode === "chat" && currentEditorState) {
          console.log(" Attaching Markdown context to prompt (Chat Mode).");
          const markdownContent =
            convertEditorStateToMarkdown(currentEditorState);
          fullPrompt += `\n\nMARKDOWN_CONTEXT:\n${markdownContent}`;
        } else if (mode === "agent" && editorStateJson) {
          console.log(
            " Attaching JSON state to prompt (Agent Mode).",
            editorStateJson,
          );
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
          dispatch({ type: "startStreaming", id: assistantMessageId });

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
              const maybeReply = unwrapSendReply(result.text);
              dispatch({
                type: "update",
                msg: {
                  id: assistantMessageId,
                  role: "assistant",
                  content: maybeReply ?? result.text,
                },
              });
              dispatch({ type: "stopStreaming" });
              console.log("Streaming finished:", result);
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
              dispatch({ type: "stopStreaming" });
            },
          };

          await generateChatStream({
            prompt: fullPrompt,
            system: systemPrompt,
            temperature: llmConfig.chat.temperature,
            maxTokens: llmConfig.chat.maxTokens,
            maxSteps: 1,
            callbacks: streamCallbacks,
            files: files,
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
              (previousToolCallName &&
                ["summarizeExecution", "sendReply"].includes(
                  previousToolCallName,
                )) ||
              (previousToolCallName === "requestClarificationOrPlan" &&
                previousStep?.toolResults?.at(-1)?.args?.operation ===
                  "clarify")
            ) {
              console.log(
                `Step ${stepNumber}: sendReply or summarizeExecution or requestClarificationOrPlan detected in previous step. Forcing toolChoice: 'none'`,
              );
              const error = new Error("TERMINAL_TOOL_CALL_DETECTED");
              error.name = "ExitError";
              throw error;
            }

            // Allow up to maxSteps - 1 tool calls, then force summarize or none
            const maxToolSteps = maxAgentSteps; // Use maxAgentSteps from context
            if (stepNumber >= maxToolSteps) {
              // On the last allowed step, prefer summarizeExecution if available
              if (
                runtimeTools.summarizeExecution &&
                stepNumber === maxToolSteps
              ) {
                console.log(
                  `Step ${stepNumber}: Reached max tool steps (${maxToolSteps}), forcing toolChoice: 'summarizeExecution'`,
                );
                return {
                  toolChoice: { type: "tool", toolName: "summarizeExecution" },
                };
              } else {
                console.log(
                  `Step ${stepNumber}: Reached max steps (${maxToolSteps}) or summarizeExecution unavailable. Forcing toolChoice: 'none'`,
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
          // TODO: Update generateChatResponse to handle file uploads
          const responseResult: GenerateChatResponseResult =
            await generateChatResponse({
              prompt: fullPrompt,
              system: systemPrompt,
              temperature: llmConfig.chat.temperature,
              maxTokens: llmConfig.chat.maxTokens,
              tools: runtimeTools,
              maxSteps: maxAgentSteps, // Use maxAgentSteps from context here
              prepareStep: prepareStepForMode,
              files: files,
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

          const lastToolCall = responseResult.toolCalls?.at(-1);
          const lastToolResult = responseResult.toolResults?.find(
            (r) => r.toolCallId === lastToolCall?.toolCallId,
          );

          // Define a type for args known to have replyText for type safety
          type ReplyArgs = { replyText?: unknown };

          // --- Debugging Logs --- Start
          console.log(
            "[Agent Dispatch Logic] Last Tool Call:",
            JSON.stringify(lastToolCall, null, 2),
          );
          console.log(
            "[Agent Dispatch Logic] Last Tool Result:",
            JSON.stringify(lastToolResult, null, 2),
          );
          console.log(
            "[Agent Dispatch Logic] Reply Text Type:",
            typeof (lastToolResult?.args as ReplyArgs | undefined)?.replyText,
          );
          console.log(
            "[Agent Dispatch Logic] Raw Response Text:",
            responseResult.text,
          );
          // --- Debugging Logs --- End

          let dispatchedMessage = false; // Flag to prevent double dispatch

          if (
            lastToolCall?.toolName === "sendReply" &&
            typeof (lastToolResult?.args as ReplyArgs | undefined)
              ?.replyText === "string"
          ) {
            // Handle sendReply: Dispatch the replyText from the tool result
            console.log("Dispatching message from sendReply tool result.");
            dispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: (lastToolResult?.args as ReplyArgs)
                  .replyText as string,
                toolCalls: responseResult.toolCalls, // Include tool info for context if needed
                toolResults: responseResult.toolResults,
              },
            });
            dispatchedMessage = true; // Mark that we dispatched
          }

          // Only dispatch the raw text response if no message was dispatched yet
          // AND no other terminal tool was the last one called.
          if (
            !dispatchedMessage &&
            // Only push a new assistant message if sendReply/other terminal tools didn't run
            // AND there is a final text response from the LLM
            lastToolCall?.toolName !== "summarizeExecution" &&
            lastToolCall?.toolName !== "requestClarificationOrPlan" &&
            responseResult.text.trim() !== ""
          ) {
            console.log("Dispatching standard text response.");
            console.log(
              "[Agent Dispatch Logic] Dispatching raw text because sendReply check failed or was skipped.",
            );
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
      } finally {
        if (mode === "agent" && agentOperationId) {
          dispatch({ type: "stopStreaming" });
        }
      }
    },
    [
      convertEditorStateToMarkdown,
      dispatch,
      messages,
      mode,
      generateChatStream,
      generateChatResponse,
      systemPrompt,
      llmConfig,
      runtimeTools,
      editor,
      maxAgentSteps, // Add maxAgentSteps to dependency array
    ],
  );
};

"use client";
import { useCallback } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import type { ToolChoice, ToolSet, StepResult } from "ai";
import {
  useLLM,
  type AppToolCall,
  type StreamCallbacks,
  type GenerateChatResponseResult,
  type RuntimeToolMap,
} from "../../context/llm-context";
import { useRuntimeTools, useToolMeta } from "./runtime-tools-provider";
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

// Helper types for narrowing tool result shapes locally

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

const MAX_SELECTED_TOOLS = 6;
const DEFAULT_AGENT_TOOL_NAMES: string[] = [
  "requestClarificationOrPlan",
  "sendReply",
  "insertTextNode",
  "insertHeadingNode",
];

// stripCodeFences now defined as a closure inside the hook

// tryParseJson now defined as a closure inside the hook

// Legacy top-level helpers kept for backward compatibility (not used now)
// pickToolsByNames is replaced by pickToolsByNamesMemo inside the hook

// extractReplyTextFromToolResult now defined inside the hook

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
  const { getDisplay } = useToolMeta();

  // Inline helpers as memoized closures
  const stripCodeFences = useCallback((text: string): string => {
    return text
      .replace(/^\s*```json/i, "")
      .replace(/^\s*```javascript/i, "")
      .replace(/^\s*```ts/i, "")
      .replace(/^\s*```/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }, []);

  const tryParseJson = useCallback(
    <T>(text: string): T | null => {
      try {
        return JSON.parse(stripCodeFences(text)) as T;
      } catch {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end !== -1 && end > start) {
          const slice = text.slice(start, end + 1);
          try {
            return JSON.parse(slice) as T;
          } catch {
            return null;
          }
        }
        const aStart = text.indexOf("[");
        const aEnd = text.lastIndexOf("]");
        if (aStart !== -1 && aEnd !== -1 && aEnd > aStart) {
          const slice = text.slice(aStart, aEnd + 1);
          try {
            return JSON.parse(slice) as T;
          } catch {
            return null;
          }
        }
        return null;
      }
    },
    [stripCodeFences],
  );

  const pickToolsByNamesMemo = useCallback(
    (names: string[]): RuntimeToolMap => {
      const entries = names
        .filter((n) => n && typeof n === "string")
        .map((n) => n.trim())
        .filter((n) => n in runtimeTools)
        .slice(0, MAX_SELECTED_TOOLS)
        .map((n) => [n, runtimeTools[n] as unknown]);
      return Object.fromEntries(entries) as unknown as RuntimeToolMap;
    },
    [runtimeTools],
  );

  const extractReplyTextFromToolResult = useCallback(
    (result: unknown): string | null => {
      if (!result || typeof result !== "object") return null;
      const maybeArgs = (result as { args?: unknown }).args;
      if (maybeArgs && typeof maybeArgs === "object") {
        const rec = maybeArgs as Record<string, unknown>;
        const val = rec.replyText;
        if (typeof val === "string") return val;
      }
      return null;
    },
    [],
  );

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
            maxSteps: 1,
            callbacks: streamCallbacks,
            files: files,
          });
        } else {
          // Staged provisioning: planner call -> main call with selected subset
          const availableToolNames = Object.keys(runtimeTools);
          const plannerInstruction =
            "You are a tool selection planner. From the provided list of available tool names, choose at most " +
            String(MAX_SELECTED_TOOLS) +
            ' that best solve the user\'s request. Return ONLY this exact format and nothing else: {"tools": ["name1", "name2"]}. Use names exactly from the list, max ' +
            String(MAX_SELECTED_TOOLS) +
            " items.";

          const plannerPrompt = [
            "AVAILABLE_TOOLS:",
            availableToolNames.join(", "),
            "USER_PROMPT:",
            prompt,
          ].join("\n\n");

          const plannerResult = await generateChatResponse({
            prompt: plannerPrompt,
            system: plannerInstruction,
            temperature: 0,
            toolChoice: "none",
            maxSteps: 0,
          });

          let selectedNames: string[] = [];
          const parsed = tryParseJson<{ tools?: unknown } | string[]>(
            plannerResult.text,
          );
          if (Array.isArray(parsed)) {
            selectedNames = parsed
              .filter((x) => typeof x === "string")
              .slice(0, MAX_SELECTED_TOOLS) as string[];
          } else if (
            parsed &&
            typeof parsed === "object" &&
            "tools" in parsed
          ) {
            const t = (parsed as { tools?: unknown }).tools;
            if (Array.isArray(t)) {
              selectedNames = t
                .filter((x) => typeof x === "string")
                .slice(0, MAX_SELECTED_TOOLS) as string[];
            }
          }

          if (!selectedNames.length) {
            selectedNames = DEFAULT_AGENT_TOOL_NAMES.filter((n) =>
              availableToolNames.includes(n),
            );
          }
          const selectedTools = pickToolsByNamesMemo(selectedNames);
          const selectedToolNames = Object.keys(selectedTools);

          const prepareStepForSelected = async ({
            steps,
            stepNumber,
          }: {
            steps: StepResult<RuntimeToolMap>[];
            stepNumber: number;
          }): Promise<{ toolChoice?: ToolChoice<ToolSet> }> => {
            const previousStep = steps[stepNumber - 1] || null;
            const previousToolCallName = previousStep?.toolResults?.at(-1)
              ?.toolName as string | undefined;
            const prevInput = previousStep?.toolResults?.at(-1)?.input as
              | Record<string, unknown>
              | undefined;
            const prevWasClarify =
              !!prevInput &&
              typeof prevInput === "object" &&
              "operation" in prevInput &&
              (prevInput as Record<string, unknown>).operation === "clarify";
            if (
              (previousToolCallName &&
                ["summarizeExecution", "sendReply"].includes(
                  previousToolCallName,
                )) ||
              (previousToolCallName === "requestClarificationOrPlan" &&
                prevWasClarify)
            ) {
              const error = new Error("TERMINAL_TOOL_CALL_DETECTED");
              error.name = "ExitError";
              throw error;
            }
            // Surface last tool call, if any
            const lastTool = previousStep?.toolCalls?.at(-1);
            if (lastTool?.toolName) {
              const display = getDisplay(
                lastTool.toolName,
                (lastTool as unknown as { input?: Record<string, unknown> })
                  .input,
              );
              if (display) {
                dispatch({
                  type: "push",
                  msg: {
                    id: crypto.randomUUID(),
                    role: "system",
                    content: display,
                  },
                });
              }
            }

            const maxToolSteps = maxAgentSteps;
            if (stepNumber >= maxToolSteps) {
              if (
                selectedToolNames.includes("summarizeExecution") &&
                stepNumber === maxToolSteps
              ) {
                return {
                  toolChoice: {
                    type: "tool",
                    toolName: "summarizeExecution",
                  },
                };
              }
              return { toolChoice: "none" };
            }
            return { toolChoice: "auto" };
          };

          let responseResult: GenerateChatResponseResult;
          try {
            responseResult = await generateChatResponse({
              prompt: fullPrompt,
              system: systemPrompt,
              temperature: llmConfig.agent.temperature,
              tools: selectedTools,
              maxSteps: maxAgentSteps,
              prepareStep: prepareStepForSelected,
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
                  content: `I tried calling \`${toolCall.toolName}\` with ${JSON.stringify((toolCall as unknown as { input?: unknown }).input)} but got an error: "${errMsg}". I'll adjust my arguments and try again.`,
                });
                return toolCall;
              },
              mode: "agent",
            });
          } catch {
            // Retry once with a small expanded default subset
            const fallbackNames = Array.from(
              new Set([
                ...DEFAULT_AGENT_TOOL_NAMES,
                ...selectedToolNames,
                "insertMarkdown",
                "insertLinkNode",
              ]),
            ).slice(0, MAX_SELECTED_TOOLS);
            const fallbackTools = pickToolsByNamesMemo(fallbackNames);
            responseResult = await generateChatResponse({
              prompt: fullPrompt,
              system: systemPrompt,
              temperature: llmConfig.agent.temperature,
              tools: fallbackTools,
              maxSteps: maxAgentSteps,
              prepareStep: prepareStepForSelected,
              files: files,
              mode: "agent",
            });
          }

          const lastToolCall = responseResult.toolCalls?.at(-1);
          const lastToolResult = responseResult.toolResults?.find(
            (r) => r.toolCallId === lastToolCall?.toolCallId,
          );
          let dispatchedMessage = false;
          if (lastToolCall?.toolName) {
            const display = getDisplay(
              lastToolCall.toolName,
              (lastToolCall as unknown as { input?: Record<string, unknown> })
                .input,
            );
            if (display) {
              dispatch({
                type: "push",
                msg: {
                  id: crypto.randomUUID(),
                  role: "system",
                  content: display,
                },
              });
            }
          }
          const replyTextB = extractReplyTextFromToolResult(lastToolResult);
          if (
            lastToolCall?.toolName === "sendReply" &&
            typeof replyTextB === "string"
          ) {
            dispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: replyTextB,
                toolCalls: responseResult.toolCalls,
                toolResults: responseResult.toolResults,
              },
            });
            dispatchedMessage = true;
          }
          if (
            !dispatchedMessage &&
            lastToolCall?.toolName !== "summarizeExecution" &&
            lastToolCall?.toolName !== "requestClarificationOrPlan" &&
            responseResult.text.trim() !== ""
          ) {
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
      maxAgentSteps,
      tryParseJson,
      pickToolsByNamesMemo,
      extractReplyTextFromToolResult,
      getDisplay,
    ],
  );
};

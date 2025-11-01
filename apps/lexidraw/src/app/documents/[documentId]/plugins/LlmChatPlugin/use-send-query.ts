"use client";
import { useCallback } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import {
  useLLM,
  type AppToolCall,
  type StreamCallbacks,
  type RuntimeToolMap,
} from "../../context/llm-context";
import { useRuntimeTools } from "./runtime-tools-provider";
import { useSystemPrompt } from "./use-system-prompt";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useMarkdownTools } from "../../utils/markdown";
import type { ModelMessage } from "ai";

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
interface SendQueryParams {
  prompt: string;
  editorStateJson?: string;
  files?: File[] | FileList | null; // Added optional file parameter
}

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages } = useChatState();
  const { generateChatStream, generateChatResponse, llmConfig } = useLLM();
  const runtimeTools = useRuntimeTools();
  const [editor] = useLexicalComposerContext();

  const systemPrompt = useSystemPrompt(mode);
  const { convertEditorStateToMarkdown } = useMarkdownTools();

  // Inline helpers as memoized closures
  // planner helpers removed; planning handled on server

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
          // planner instruction enforced server-side

          // --- Planner step via server endpoint ---
          let selectedNames: string[] = [];
          let plannerCorrelationId: string | undefined;
          try {
            const plannerRes = await fetch("/api/llm/plan", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt,
                availableTools: availableToolNames,
                max: MAX_SELECTED_TOOLS,
              }),
            });
            if (plannerRes.ok) {
              const data = (await plannerRes.json()) as {
                tools?: unknown;
                correlationId?: string;
              };
              if (Array.isArray(data.tools)) {
                selectedNames = (data.tools as unknown[])
                  .filter((x) => typeof x === "string")
                  .slice(0, MAX_SELECTED_TOOLS) as string[];
              }
              if (typeof data.correlationId === "string") {
                plannerCorrelationId = data.correlationId;
              }
            }
          } catch {
            // fall back below
          }

          if (!selectedNames.length) {
            dispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "system",
                content:
                  "Planner failed to select tools. Please refine the request.",
              },
            });
            return;
          }
          const selectedTools = pickToolsByNamesMemo(selectedNames);
          const selectedToolNames = Object.keys(selectedTools);

          // Client-orchestrated agent flow (feature-flagged) — call through llm-context
          const clientOrch = true;
          if (clientOrch) {
            const messagesForAgent: ModelMessage[] = [
              { role: "user", content: fullPrompt },
            ];

            // First pass
            const result1 = await generateChatResponse({
              mode: "agent",
              messages: messagesForAgent,
              system: systemPrompt,
              temperature: llmConfig.agent.temperature,
              tools: selectedTools,
              prompt: "",
            });
            // Execute at most one round of tool calls, then feed back
            const toolCalls1 = result1.toolCalls ?? [];
            // Only surface assistant text if there were no tool calls
            if (toolCalls1.length === 0 && (result1.text ?? "").trim() !== "") {
              dispatch({
                type: "push",
                msg: {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: result1.text,
                },
              });
            }
            if (toolCalls1.length > 0) {
              const executed: Array<{
                toolCallId: string;
                toolName: string;
                ok: boolean;
                error?: string;
                summary?: string;
              }> = [];

              for (const c of toolCalls1) {
                const toolImpl = (
                  selectedTools as unknown as Record<string, unknown>
                )[c.toolName] as unknown as {
                  inputSchema?: unknown;
                  execute?: (
                    args: Record<string, unknown>,
                  ) => Promise<
                    | { success: true; content?: Record<string, unknown> }
                    | { success: false; error?: string }
                  >;
                };
                if (!toolImpl || typeof toolImpl.execute !== "function") {
                  executed.push({
                    toolCallId: c.toolCallId,
                    toolName: c.toolName,
                    ok: false,
                    error: `Tool '${c.toolName}' not available`,
                  });
                  continue;
                }
                // Minimal arg mapping for Gemini sendReply
                const raw =
                  (c as unknown as { input?: Record<string, unknown> }).input ||
                  {};
                const mappedArgs =
                  c.toolName === "sendReply" && typeof raw.message === "string"
                    ? { replyText: raw.message }
                    : raw;
                try {
                  const res = await toolImpl.execute(mappedArgs);
                  executed.push({
                    toolCallId: c.toolCallId,
                    toolName: c.toolName,
                    ok: !!res?.success,
                    error: (res as any)?.error,
                    summary: (res as any)?.content?.summary,
                  });
                } catch (e) {
                  executed.push({
                    toolCallId: c.toolCallId,
                    toolName: c.toolName,
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                  });
                }
              }

              // Feed results back once
              const summaryLines = executed
                .map(
                  (r) =>
                    `- ${r.toolName} (${r.toolCallId}): ${r.ok ? "ok" : `error: ${r.error ?? ""}`}${
                      r.summary ? ` summary: ${r.summary}` : ""
                    }`,
                )
                .join("\n");

              const followupMessages: ModelMessage[] = [
                ...messagesForAgent,
                ...(result1.text?.trim()
                  ? ([
                      { role: "assistant", content: result1.text },
                    ] as ModelMessage[])
                  : ([] as ModelMessage[])),
                {
                  role: "assistant",
                  content: `TOOL_EXECUTION_RESULTS_PASS_1:\n${summaryLines}`,
                },
              ];

              const result2 = await generateChatResponse({
                mode: "agent",
                messages: followupMessages,
                system: systemPrompt,
                temperature: llmConfig.agent.temperature,
                tools: selectedTools,
                prompt: "",
              });
              if ((result2.text ?? "").trim() !== "") {
                dispatch({
                  type: "push",
                  msg: {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: result2.text,
                  },
                });
              }
            }

            return;
          }

          // Fallback to server-agent single pass
          const agentRes = await fetch("/api/llm/agent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system: systemPrompt,
              prompt: fullPrompt,
              temperature: llmConfig.agent.temperature,
              allowedToolNames: selectedToolNames,
              correlationId: plannerCorrelationId,
            }),
          });
          if (!agentRes.ok) throw new Error(`Agent HTTP ${agentRes.status}`);
          const data = (await agentRes.json()) as { text?: string };
          const agentText = data.text ?? "";
          if (agentText.trim() !== "") {
            dispatch({
              type: "push",
              msg: {
                id: crypto.randomUUID(),
                role: "assistant",
                content: agentText,
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
      pickToolsByNamesMemo,
    ],
  );
};

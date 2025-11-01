"use client";
import { useCallback, useRef } from "react";
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
import { generateUUID } from "~/lib/utils";

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

  // Prevent duplicate agent turns from concurrent triggers
  const agentInFlightRef = useRef(false);

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

      const userMessageId = generateUUID();
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
      const agentOperationId = mode === "agent" ? generateUUID() : null;
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

          const assistantMessageId = generateUUID();
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
          const chatOnly = new Set(["sendReply", "requestClarificationOrPlan"]);
          const availableToolNames = Object.keys(runtimeTools).filter(
            (n) => !chatOnly.has(n),
          );
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
                id: generateUUID(),
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
            if (agentInFlightRef.current) {
              console.warn(
                "[agent] Turn already in-flight. Ignoring duplicate trigger.",
              );
              return;
            }
            agentInFlightRef.current = true;
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
                  id: generateUUID(),
                  role: "assistant",
                  content: result1.text,
                },
              });
            }
            if (toolCalls1.length > 0) {
              const executedIds = new Set<string>();
              const executed: Array<{
                toolCallId: string;
                toolName: string;
                ok: boolean;
                error?: string;
                summary?: string;
              }> = [];

              console.log(
                `[agent] Executing ${toolCalls1.length} tool call(s): ${toolCalls1
                  .map((c) => c.toolName)
                  .join(", ")}`,
              );

              for (const c of toolCalls1) {
                if (executedIds.has(c.toolCallId)) {
                  console.warn(
                    `[agent] Skipping duplicate toolCallId ${c.toolCallId} (${c.toolName})`,
                  );
                  continue;
                }
                executedIds.add(c.toolCallId);
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
                  const argsPreview = (() => {
                    try {
                      const s = JSON.stringify(mappedArgs);
                      return s.length > 500 ? `${s.slice(0, 500)}…` : s;
                    } catch {
                      return "[unserializable]";
                    }
                  })();
                  console.log(`[tool:${c.toolName}] START`, {
                    toolCallId: c.toolCallId,
                    argsPreview,
                  });
                  const res = (await toolImpl.execute(mappedArgs)) as
                    | { success: true; content?: { summary?: string } }
                    | { success: false; error?: string };
                  if (res.success) {
                    executed.push({
                      toolCallId: c.toolCallId,
                      toolName: c.toolName,
                      ok: true,
                      summary: res.content?.summary,
                    });
                    console.log(`[tool:${c.toolName}] OK`, {
                      toolCallId: c.toolCallId,
                      summary: res.content?.summary,
                    });
                  } else {
                    executed.push({
                      toolCallId: c.toolCallId,
                      toolName: c.toolName,
                      ok: false,
                      error: res.error,
                    });
                    console.warn(`[tool:${c.toolName}] ERROR`, {
                      toolCallId: c.toolCallId,
                      error: res.error,
                    });
                  }
                } catch (e) {
                  executed.push({
                    toolCallId: c.toolCallId,
                    toolName: c.toolName,
                    ok: false,
                    error: e instanceof Error ? e.message : String(e),
                  });
                  console.error(`[tool:${c.toolName}] EXCEPTION`, {
                    toolCallId: c.toolCallId,
                    error: e instanceof Error ? e.message : String(e),
                  });
                }
              }

              // Check if execution was successful
              const allSucceeded = executed.every((r) => r.ok);
              const hasErrors = executed.some((r) => !r.ok);

              // Decision step: After successful execution, offer summarize or plan next step
              if (allSucceeded && executed.length > 0) {
                // Create decision tools (only summarize and plan)
                const decisionTools = pickToolsByNamesMemo([
                  "summarizeAfterToolCallExecution",
                  "planNextToolSelection",
                ]);

                // Build execution summary
                const executionSummary = executed
                  .map(
                    (r) =>
                      `${r.toolName}${r.summary ? `: ${r.summary}` : " (completed)"}`,
                  )
                  .join("\n");

                // Decision turn prompt
                const decisionPrompt = `Execution completed successfully. ${executed.length} tool(s) executed.

EXECUTION_SUMMARY:
${executionSummary}

IMPORTANT: Do NOT re-execute the tools that were just run. The execution is complete.

Choose exactly one action:
1. Call summarizeAfterToolCallExecution to provide a summary to the user
2. Call planNextToolSelection to plan and execute the next step

Do not repeat the prior execution or call content-editing tools.`;

                const decisionMessages: ModelMessage[] = [
                  ...messagesForAgent,
                  ...(result1.text?.trim()
                    ? ([
                        { role: "assistant", content: result1.text },
                      ] as ModelMessage[])
                    : ([] as ModelMessage[])),
                  {
                    role: "user",
                    content: decisionPrompt,
                  },
                ];

                // Decision turn - max 2 cycles
                let decisionCycleCount = 0;
                const MAX_DECISION_CYCLES = 2;
                let currentMessages = decisionMessages;
                let continueLoop = true;

                while (
                  continueLoop &&
                  decisionCycleCount < MAX_DECISION_CYCLES
                ) {
                  decisionCycleCount++;
                  console.log(
                    `[agent] Decision step cycle ${decisionCycleCount}/${MAX_DECISION_CYCLES}`,
                  );

                  const decisionResult = await generateChatResponse({
                    mode: "agent",
                    messages: currentMessages,
                    system:
                      systemPrompt +
                      "\n\nYou are in a decision step. Choose exactly one: summarizeAfterToolCallExecution OR planNextToolSelection.",
                    temperature: llmConfig.agent.temperature,
                    tools: decisionTools,
                    prompt: "",
                  });

                  const decisionToolCalls = decisionResult.toolCalls ?? [];

                  if (decisionToolCalls.length === 0) {
                    // No tool call - assume summarize intent
                    if ((decisionResult.text ?? "").trim() !== "") {
                      dispatch({
                        type: "push",
                        msg: {
                          id: generateUUID(),
                          role: "assistant",
                          content: decisionResult.text,
                        },
                      });
                    }
                    continueLoop = false;
                    break;
                  }

                  // Execute decision tool
                  for (const decisionCall of decisionToolCalls) {
                    const decisionToolImpl = (
                      decisionTools as unknown as Record<string, unknown>
                    )[decisionCall.toolName] as unknown as {
                      execute?: (
                        args: Record<string, unknown>,
                      ) => Promise<
                        | { success: true; content?: Record<string, unknown> }
                        | { success: false; error?: string }
                      >;
                    };

                    if (
                      !decisionToolImpl ||
                      typeof decisionToolImpl.execute !== "function"
                    ) {
                      console.warn(
                        `[decision] Tool '${decisionCall.toolName}' not available`,
                      );
                      continue;
                    }

                    const raw =
                      (
                        decisionCall as unknown as {
                          input?: Record<string, unknown>;
                        }
                      ).input || {};
                    let mappedArgs =
                      decisionCall.toolName === "sendReply" &&
                      typeof raw.message === "string"
                        ? { replyText: raw.message }
                        : (raw as Record<string, unknown>);

                    // If planner was chosen, provide available tool names explicitly
                    if (decisionCall.toolName === "planNextToolSelection") {
                      const chatOnly = new Set([
                        "sendReply",
                        "requestClarificationOrPlan",
                        "summarizeAfterToolCallExecution",
                        "planNextToolSelection",
                      ]);
                      const availableToolNames = Object.keys(runtimeTools).filter(
                        (n) => !chatOnly.has(n),
                      );
                      mappedArgs = {
                        ...mappedArgs,
                        availableTools: availableToolNames,
                        max:
                          typeof (mappedArgs as { max?: unknown }).max ===
                          "number"
                            ? (mappedArgs as { max?: number }).max
                            : MAX_SELECTED_TOOLS,
                      } as Record<string, unknown>;
                    }

                    try {
                      const decisionRes = (await decisionToolImpl.execute(
                        mappedArgs,
                      )) as
                        | {
                            success: true;
                            content?: {
                              summary?: string;
                              tools?: string[];
                              correlationId?: string;
                            };
                          }
                        | { success: false; error?: string };

                      if (
                        decisionCall.toolName ===
                        "summarizeAfterToolCallExecution"
                      ) {
                        // Summarize chosen - done
                        console.log("[decision] Summarize chosen");
                        continueLoop = false;
                        break;
                      } else if (
                        decisionCall.toolName === "planNextToolSelection"
                      ) {
                        // Plan chosen - run next agent pass
                        if (decisionRes.success && decisionRes.content?.tools) {
                          const nextTools = decisionRes.content.tools;
                          const correlationId =
                            decisionRes.content.correlationId;
                          console.log("[decision] Plan chosen", {
                            tools: nextTools,
                            correlationId,
                            decisionCycle: decisionCycleCount,
                          });

                          // Pick next tools
                          const nextSelectedTools =
                            pickToolsByNamesMemo(nextTools);
                          const nextSelectedToolNames =
                            Object.keys(nextSelectedTools);

                          if (nextSelectedToolNames.length === 0) {
                            // Empty tools - end with summarize
                            dispatch({
                              type: "push",
                              msg: {
                                id: generateUUID(),
                                role: "system",
                                content:
                                  "Planner returned no tools. Refining objective or ending.",
                              },
                            });
                            continueLoop = false;
                            break;
                          }

                          // Build next step prompt
                          const nextStepPrompt = decisionRes.content.summary
                            ? decisionRes.content.summary
                            : "Continue with the next step";

                          // Run next agent pass
                          const nextMessages: ModelMessage[] = [
                            ...currentMessages,
                            {
                              role: "assistant",
                              content: `Planning next step: ${nextStepPrompt}`,
                            },
                            {
                              role: "user",
                              content: nextStepPrompt,
                            },
                          ];

                          const nextResult = await generateChatResponse({
                            mode: "agent",
                            messages: nextMessages,
                            system: systemPrompt,
                            temperature: llmConfig.agent.temperature,
                            tools: nextSelectedTools,
                            prompt: "",
                          });

                          const nextToolCalls = nextResult.toolCalls ?? [];

                          if (nextToolCalls.length === 0) {
                            // No tools - done
                            if ((nextResult.text ?? "").trim() !== "") {
                              dispatch({
                                type: "push",
                                msg: {
                                  id: generateUUID(),
                                  role: "assistant",
                                  content: nextResult.text,
                                },
                              });
                            }
                            continueLoop = false;
                            break;
                          }

                          // Execute next tools
                          const nextExecuted: Array<{
                            toolCallId: string;
                            toolName: string;
                            ok: boolean;
                            error?: string;
                            summary?: string;
                          }> = [];

                          for (const nextCall of nextToolCalls) {
                            const nextToolImpl = (
                              nextSelectedTools as unknown as Record<
                                string,
                                unknown
                              >
                            )[nextCall.toolName] as unknown as {
                              execute?: (
                                args: Record<string, unknown>,
                              ) => Promise<
                                | {
                                    success: true;
                                    content?: { summary?: string };
                                  }
                                | { success: false; error?: string }
                              >;
                            };

                            if (
                              !nextToolImpl ||
                              typeof nextToolImpl.execute !== "function"
                            ) {
                              nextExecuted.push({
                                toolCallId: nextCall.toolCallId,
                                toolName: nextCall.toolName,
                                ok: false,
                                error: `Tool '${nextCall.toolName}' not available`,
                              });
                              continue;
                            }

                            const nextRaw =
                              (
                                nextCall as unknown as {
                                  input?: Record<string, unknown>;
                                }
                              ).input || {};
                            const nextMappedArgs =
                              nextCall.toolName === "sendReply" &&
                              typeof nextRaw.message === "string"
                                ? { replyText: nextRaw.message }
                                : nextRaw;

                            try {
                              const nextRes = (await nextToolImpl.execute(
                                nextMappedArgs,
                              )) as
                                | {
                                    success: true;
                                    content?: { summary?: string };
                                  }
                                | { success: false; error?: string };

                              nextExecuted.push({
                                toolCallId: nextCall.toolCallId,
                                toolName: nextCall.toolName,
                                ok: nextRes.success,
                                error: nextRes.success
                                  ? undefined
                                  : nextRes.error,
                                summary: nextRes.success
                                  ? nextRes.content?.summary
                                  : undefined,
                              });
                            } catch (e) {
                              nextExecuted.push({
                                toolCallId: nextCall.toolCallId,
                                toolName: nextCall.toolName,
                                ok: false,
                                error:
                                  e instanceof Error ? e.message : String(e),
                              });
                            }
                          }

                          // Update messages for next decision cycle
                          const nextSummary = nextExecuted
                            .map(
                              (r) =>
                                `${r.toolName}: ${r.ok ? "ok" : `error: ${r.error ?? ""}`}${
                                  r.summary ? ` summary: ${r.summary}` : ""
                                }`,
                            )
                            .join("\n");

                          currentMessages = [
                            ...nextMessages,
                            {
                              role: "assistant",
                              content: `Next step executed:\n${nextSummary}`,
                            },
                            {
                              role: "user",
                              content: decisionPrompt,
                            },
                          ];

                          // Continue loop for next decision
                        } else {
                          // Plan failed
                          const errorMessage = decisionRes.success
                            ? "Planner failed. Ending execution."
                            :
                              decisionRes.error || "Planner failed. Ending execution.";
                          dispatch({
                            type: "push",
                            msg: {
                              id: generateUUID(),
                              role: "system",
                              content: errorMessage,
                            },
                          });
                          continueLoop = false;
                          break;
                        }
                      }
                    } catch (e) {
                      console.error(
                        `[decision] Error executing ${decisionCall.toolName}:`,
                        e,
                      );
                      continueLoop = false;
                      break;
                    }
                  }
                }

                if (decisionCycleCount >= MAX_DECISION_CYCLES) {
                  console.log(
                    "[decision] Reached max decision cycles, stopping",
                  );
                }
              } else if (hasErrors) {
                // On error, skip summarize and go straight to planning (include error details)
                const errorSummary = executed
                  .filter((r) => !r.ok)
                  .map((r) => `${r.toolName}: ${r.error ?? "unknown error"}`)
                  .join("\n");

                dispatch({
                  type: "push",
                  msg: {
                    id: generateUUID(),
                    role: "system",
                    content: `Execution had errors:\n${errorSummary}\n\nPlease refine your request.`,
                  },
                });
              }

              // If no tools executed or all failed, show result text if any
              if (executed.length === 0 && (result1.text ?? "").trim() !== "") {
                dispatch({
                  type: "push",
                  msg: {
                    id: generateUUID(),
                    role: "assistant",
                    content: result1.text,
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
                id: generateUUID(),
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
            id: generateUUID(),
            role: "system",
            content: "An error occurred while processing your request.",
          },
        });
      } finally {
        if (mode === "agent") {
          agentInFlightRef.current = false;
        }
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

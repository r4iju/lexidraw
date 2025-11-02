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

  // --- Helper: Build full prompt string ---
  const buildPromptString = useCallback(
    (args: {
      prompt: string;
      files?: File[] | FileList | null;
      editorStateJson?: string;
    }): string => {
      const { prompt, files, editorStateJson } = args;

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
      }

      // Strict markdown formatting instruction for final response text
      fullPrompt +=
        "\n\nFORMATTING_INSTRUCTION:\nStrictly format your final response text using Markdown. Do **not** output JSON or any other structured format. Keep Markdown nesting minimal (nested lists or quotes) and headings small for readability in a chat interface.";

      // Add context based on mode (Markdown for chat, JSON for agent)
      const currentEditorState = editor.getEditorState();
      if (mode === "chat" && currentEditorState) {
        const markdownContent =
          convertEditorStateToMarkdown(currentEditorState);
        fullPrompt += `\n\nMARKDOWN_CONTEXT:\n${markdownContent}`;
      } else if (mode === "agent" && editorStateJson) {
        fullPrompt += `\n\nJSON_STATE:\n${editorStateJson}`;
      }

      return fullPrompt;
    },
    [convertEditorStateToMarkdown, editor, messages, mode],
  );

  // --- Helper: Planner selection via server ---
  const selectToolsForAgent = useCallback(
    async (args: {
      prompt: string;
    }): Promise<{
      selectedNames: string[];
      correlationId?: string;
    }> => {
      const chatOnly = new Set(["sendReply", "requestClarificationOrPlan"]);
      const availableToolNames = Object.keys(runtimeTools).filter(
        (n) => !chatOnly.has(n),
      );

      let selectedNames: string[] = [];
      let correlationId: string | undefined;
      try {
        const plannerRes = await fetch("/api/llm/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: args.prompt,
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
            correlationId = data.correlationId;
          }
        }
      } catch {
        // return empty selection on error
      }

      return { selectedNames, correlationId };
    },
    [runtimeTools],
  );

  // --- Helper: Decision cycle after an execution pass ---
  const handleDecisionCycle = useCallback(
    async (args: {
      initialMessages: ModelMessage[];
      priorAssistantText?: string;
    }): Promise<void> => {
      const { initialMessages, priorAssistantText } = args;

      // Create decision tools (only summarize and plan)
      const decisionTools = pickToolsByNamesMemo([
        "summarizeAfterToolCallExecution",
        "planNextToolSelection",
      ]);

      // Build decision messages
      const baseDecisionMessages: ModelMessage[] = [
        ...initialMessages,
        ...(priorAssistantText?.trim()
          ? ([
              { role: "assistant", content: priorAssistantText },
            ] as ModelMessage[])
          : ([] as ModelMessage[])),
      ];

      const decisionPrompt = `Choose exactly one action next:\n1) summarizeAfterToolCallExecution\n2) planNextToolSelection`;

      const MAX_DECISION_CYCLES = 2;
      let decisionCycleCount = 0;
      let currentMessages: ModelMessage[] = [
        ...baseDecisionMessages,
        { role: "user", content: decisionPrompt } as ModelMessage,
      ];
      let continueLoop = true;

      while (continueLoop && decisionCycleCount < MAX_DECISION_CYCLES) {
        decisionCycleCount++;

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
          // No tool call - assume summarize intent and surface any text
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

        // If summarize was called, SDK already executed it (tools are live). We're done.
        const summarizeCall = decisionToolCalls.find(
          (c) => c.toolName === "summarizeAfterToolCallExecution",
        );
        if (summarizeCall) {
          continueLoop = false;
          break;
        }

        // If planNextToolSelection was called, we need the planned tools list.
        const planCall = decisionToolCalls.find(
          (c) => c.toolName === "planNextToolSelection",
        );
        if (planCall) {
          // Re-execute the plan tool to obtain its returned tool list (SDK does not expose outputs)
          const decisionToolImpl = (
            decisionTools as unknown as Record<string, unknown>
          ).planNextToolSelection as unknown as {
            execute?: (args: Record<string, unknown>) => Promise<
              | {
                  success: true;
                  content?: {
                    summary?: string;
                    tools?: string[];
                    correlationId?: string;
                  };
                }
              | { success: false; error?: string }
            >;
          };

          if (
            !decisionToolImpl ||
            typeof decisionToolImpl.execute !== "function"
          ) {
            console.warn("[decision] planNextToolSelection tool not available");
            continueLoop = false;
            break;
          }

          // Provide available tool names explicitly (exclude chat-only & decision tools)
          const chatOnly = new Set([
            "sendReply",
            "requestClarificationOrPlan",
            "summarizeAfterToolCallExecution",
            "planNextToolSelection",
          ]);
          const availableToolNames = Object.keys(runtimeTools).filter(
            (n) => !chatOnly.has(n),
          );

          const raw =
            (planCall as unknown as { input?: Record<string, unknown> })
              .input || {};
          const mappedArgs = {
            ...(raw as Record<string, unknown>),
            availableTools: availableToolNames,
            max:
              typeof (raw as { max?: unknown }).max === "number"
                ? (raw as { max?: number }).max
                : MAX_SELECTED_TOOLS,
          } as Record<string, unknown>;

          const decisionRes = await decisionToolImpl.execute(mappedArgs);
          if (!decisionRes.success || !decisionRes.content?.tools?.length) {
            const errorMessage = decisionRes.success
              ? "Planner failed. Ending execution."
              : decisionRes.error || "Planner failed. Ending execution.";
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

          const nextTools = decisionRes.content.tools;
          const nextSelectedTools = pickToolsByNamesMemo(nextTools);
          const nextSelectedToolNames = Object.keys(nextSelectedTools);
          if (nextSelectedToolNames.length === 0) {
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

          // Run next agent pass with selected tools
          const nextMessages: ModelMessage[] = [
            ...currentMessages,
            {
              role: "assistant",
              content: `Planning next step: ${nextStepPrompt}`,
            } as ModelMessage,
            { role: "user", content: nextStepPrompt } as ModelMessage,
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

          // Update messages for next decision cycle with an execution note
          currentMessages = [
            ...nextMessages,
            {
              role: "assistant",
              content: `Next step executed (${nextToolCalls.length} tool call(s)).`,
            } as ModelMessage,
            { role: "user", content: decisionPrompt } as ModelMessage,
          ];
        }
      }

      if (decisionCycleCount >= MAX_DECISION_CYCLES) {
        console.log("[decision] Reached max decision cycles, stopping");
      }
    },
    [
      dispatch,
      generateChatResponse,
      llmConfig.agent.temperature,
      pickToolsByNamesMemo,
      runtimeTools,
      systemPrompt,
    ],
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
        const fullPrompt = buildPromptString({
          prompt,
          files,
          editorStateJson,
        });

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
          const { selectedNames } = await selectToolsForAgent({ prompt });

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
              // Tools have already been executed by the SDK when maxSteps: 1 is set.
              // Proceed to decision cycle (summarize vs plan)
              await handleDecisionCycle({
                initialMessages: messagesForAgent,
                priorAssistantText: result1.text,
              });
            }

            return;
          }

          // Server-agent fallback removed per refactor plan
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
      dispatch,
      mode,
      generateChatStream,
      generateChatResponse,
      systemPrompt,
      llmConfig,
      pickToolsByNamesMemo,
      buildPromptString,
      selectToolsForAgent,
      handleDecisionCycle,
    ],
  );
};

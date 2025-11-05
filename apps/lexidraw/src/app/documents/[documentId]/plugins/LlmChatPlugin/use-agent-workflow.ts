"use client";

import { useCallback, useRef, useState } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { useRuntimeTools } from "./runtime-tools-provider";
import type { AgentEvent, ToolCallbackBody } from "@packages/types";
import { generateUUID } from "~/lib/utils";
import { useParams } from "next/navigation";
import type { ModelMessage } from "ai";
import type { AppToolCall, AppToolResult } from "../../context/llm-context";
import type { ChatDispatch } from "./llm-chat-context";

interface UseAgentWorkflowOptions {
  onError?: (error: Error) => void;
}

interface AgentWorkflowState {
  isRunning: boolean;
  canCancel: boolean;
  currentToolCallId: string | null;
  currentToolName: string | null;
}

/**
 * NDJSON parser: reads newline-delimited JSON lines from stream
 */
class NDJSONParser {
  private buffer = "";
  private seenIds = new Set<string>();

  parseChunk(chunk: string): AgentEvent[] {
    this.buffer += chunk;
    const events: AgentEvent[] = [];
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as AgentEvent;
        // Validate AgentEvent shape
        if (event.type && event.id && event.runId) {
          const dedupeKey = `${event.runId}:${event.id}`;
          if (!this.seenIds.has(dedupeKey)) {
            this.seenIds.add(dedupeKey);
            events.push(event);
          }
        }
      } catch {
        // Skip malformed JSON lines
      }
    }

    return events;
  }

  reset(): void {
    this.buffer = "";
    this.seenIds.clear();
  }
}

export function useAgentWorkflow(options?: UseAgentWorkflowOptions) {
  const dispatch = useChatDispatch();
  const { messages } = useChatState();
  const runtimeTools = useRuntimeTools();
  const params = useParams();
  const documentId = params?.documentId as string | undefined;

  const abortControllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<AgentWorkflowState>({
    isRunning: false,
    canCancel: false,
    currentToolCallId: null,
    currentToolName: null,
  });

  const executeTool = useCallback(
    async (
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<unknown> => {
      const tool = runtimeTools[toolName];
      if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      // Check if tool has execute method
      const toolImpl = tool as unknown as {
        execute?: (args: Record<string, unknown>) => Promise<unknown>;
        inputSchema?: unknown;
      };

      if (!toolImpl.execute || typeof toolImpl.execute !== "function") {
        throw new Error(`Tool '${toolName}' does not have an execute function`);
      }

      // Execute tool with editor context
      const result = await toolImpl.execute(input);
      return result;
    },
    [runtimeTools],
  );

  const sendToolCallback = useCallback(
    async (hookToken: string, toolCallId: string, result: unknown) => {
      const body: ToolCallbackBody = {
        hookToken,
        toolCallId,
        result,
      };

      const response = await fetch("/api/llm/agent/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Callback failed");
        throw new Error(`Tool callback failed: ${errorText}`);
      }
    },
    [],
  );

  /**
   * Type guard to check if an object has a success property.
   */
  const hasSuccessProperty = useCallback(
    (obj: unknown): obj is { success: boolean } => {
      return typeof obj === "object" && obj !== null && "success" in obj;
    },
    [],
  );

  /**
   * Normalizes tool result to match expected format.
   */
  const normalizeToolResult = useCallback(
    (
      result: unknown,
      toolCallId: string,
    ): AppToolResult & { toolCallId: string; ok: boolean } => {
      // Check if result already has success flag (from tool return)
      if (hasSuccessProperty(result)) {
        return {
          toolCallId,
          ok: Boolean(result.success),
          result,
        };
      }
      // For string results (like sendReply), treat as success
      return {
        toolCallId,
        ok: true,
        result,
      };
    },
    [hasSuccessProperty],
  );

  /**
   * Creates an error tool result with proper typing.
   */
  const createErrorToolResult = useCallback(
    (
      toolCallId: string,
      error: string,
    ): AppToolResult & { toolCallId: string; ok: false } => {
      return {
        toolCallId,
        ok: false,
        result: {
          error,
        },
      };
    },
    [],
  );

  /**
   * Updates a message with tool call info and result.
   */
  const updateMessageWithToolResult = useCallback(
    (
      dispatch: ChatDispatch,
      messageId: string,
      toolCall: AppToolCall,
      result: AppToolResult & { toolCallId: string; ok: boolean },
    ): void => {
      dispatch({
        type: "update",
        msg: {
          id: messageId,
          role: "assistant",
          toolCalls: [toolCall],
          toolResults: [result],
        },
      });
    },
    [],
  );

  const runAgentWorkflow = useCallback(
    async (args: {
      prompt: string; // Just the user's prompt
      originalPrompt?: string; // Original user prompt for planner
      documentMarkdown?: string; // Markdown snapshot for planner
      documentJson?: Record<string, unknown>; // JSON state as separate property
      files?: File[] | FileList | null;
    }) => {
      if (!documentId) {
        throw new Error("documentId is required");
      }

      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setState({
        isRunning: true,
        canCancel: true,
        currentToolCallId: null,
        currentToolName: null,
      });

      // Build messages array
      const historyMessages: ModelMessage[] = messages
        .filter((msg) => msg.role !== "system")
        .map((msg) => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        }));

      // Create assistant message for streaming
      const assistantMessageId = generateUUID();
      dispatch({
        type: "push",
        msg: {
          id: assistantMessageId,
          role: "assistant",
          content: "",
        },
      });
      dispatch({ type: "startStreaming", id: assistantMessageId });

      let accumulatedText = "";
      let currentRunId: string | null = null;
      const parser = new NDJSONParser();

      try {
        // Prepare request body
        const requestBody = {
          prompt: args.prompt, // Just the user's prompt
          originalPrompt: args.originalPrompt, // Original prompt for planner
          documentMarkdown: args.documentMarkdown, // Markdown snapshot for planner
          documentJson: args.documentJson, // JSON state as separate property
          messages: historyMessages,
          documentId,
        };

        // Start SSE stream
        const response = await fetch("/api/llm/agent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text().catch(() => "Request failed");
          throw new Error(`Agent workflow failed: ${errorText}`);
        }

        // Read stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const events = parser.parseChunk(chunk);

          for (const event of events) {
            if (!currentRunId) {
              currentRunId = event.runId;
            }

            // Handle different event types
            if (event.type === "text-delta") {
              accumulatedText += event.delta;
              dispatch({
                type: "update",
                msg: {
                  id: assistantMessageId,
                  role: "assistant",
                  content: accumulatedText,
                },
              });
            } else if (event.type === "tool-call") {
              // Update state to show tool execution
              setState((prev) => ({
                ...prev,
                currentToolCallId: event.toolCallId,
                currentToolName: event.toolName,
              }));

              // Execute tool locally
              try {
                const result = await executeTool(event.toolName, event.input);

                // Send result to callback
                if (event.hookToken) {
                  await sendToolCallback(
                    event.hookToken,
                    event.toolCallId,
                    result,
                  );
                }

                // Normalize result to match expected format
                const normalizedResult = normalizeToolResult(
                  result,
                  event.toolCallId,
                );

                // Update UI with tool call info and result
                updateMessageWithToolResult(
                  dispatch,
                  assistantMessageId,
                  {
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    input: event.input,
                  },
                  normalizedResult,
                );
              } catch (error) {
                console.error(
                  `[agent] Tool execution failed: ${event.toolName}`,
                  error,
                );
                // Send error result to callback
                if (event.hookToken) {
                  try {
                    await sendToolCallback(event.hookToken, event.toolCallId, {
                      success: false,
                      error:
                        error instanceof Error ? error.message : String(error),
                    });
                  } catch {
                    // Ignore callback errors
                  }
                }

                // Update UI with error result
                const errorResult = createErrorToolResult(
                  event.toolCallId,
                  error instanceof Error ? error.message : String(error),
                );
                updateMessageWithToolResult(
                  dispatch,
                  assistantMessageId,
                  {
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    input: event.input,
                  },
                  errorResult,
                );
              } finally {
                setState((prev) => ({
                  ...prev,
                  currentToolCallId: null,
                  currentToolName: null,
                }));
              }
            } else if (event.type === "finish") {
              dispatch({ type: "stopStreaming" });
              setState({
                isRunning: false,
                canCancel: false,
                currentToolCallId: null,
                currentToolName: null,
              });

              // Update final message if summary provided
              if (event.summary) {
                dispatch({
                  type: "update",
                  msg: {
                    id: assistantMessageId,
                    role: "assistant",
                    content: event.summary,
                  },
                });
              }
              return;
            } else if (event.type === "error") {
              dispatch({ type: "stopStreaming" });
              dispatch({
                type: "update",
                msg: {
                  id: assistantMessageId,
                  role: "assistant",
                  content: `Error: ${event.message}`,
                },
              });
              setState({
                isRunning: false,
                canCancel: false,
                currentToolCallId: null,
                currentToolName: null,
              });

              const error = new Error(event.message);
              options?.onError?.(error);
              throw error;
            }
            // Ignore heartbeat events (they're just keep-alive)
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          dispatch({ type: "stopStreaming" });
          dispatch({
            type: "update",
            msg: {
              id: assistantMessageId,
              role: "assistant",
              content: "Operation cancelled",
            },
          });
        } else {
          dispatch({ type: "stopStreaming" });
          const err = error instanceof Error ? error : new Error(String(error));
          dispatch({
            type: "update",
            msg: {
              id: assistantMessageId,
              role: "assistant",
              content: `Error: ${err.message}`,
            },
          });
          options?.onError?.(err);
        }
        setState({
          isRunning: false,
          canCancel: false,
          currentToolCallId: null,
          currentToolName: null,
        });
      } finally {
        parser.reset();
      }
    },
    [
      documentId,
      dispatch,
      messages,
      executeTool,
      sendToolCallback,
      options,
      createErrorToolResult,
      normalizeToolResult,
      updateMessageWithToolResult,
    ],
  );

  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setState({
        isRunning: false,
        canCancel: false,
        currentToolCallId: null,
        currentToolName: null,
      });
    }
  }, []);

  return {
    runAgentWorkflow,
    cancel,
    state,
  };
}

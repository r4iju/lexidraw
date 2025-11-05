"use client";
import { useCallback, useRef } from "react";
import { useChatDispatch, useChatState } from "./llm-chat-context";
import { useLLM, type StreamCallbacks } from "../../context/llm-context";
import { useSystemPrompt } from "./use-system-prompt";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useMarkdownTools } from "../../utils/markdown";
import { generateUUID } from "~/lib/utils";
import { useAgentWorkflow } from "./use-agent-workflow";

// Define a more specific type for messages used in history building
// (Matches the structure in llm-chat-context.tsx)
type HistoryMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }>;
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

interface SendQueryParams {
  prompt: string;
  editorStateJson?: string;
  files?: File[] | FileList | null; // Added optional file parameter
}

export const useSendQuery = () => {
  const dispatch = useChatDispatch();
  const { mode, messages } = useChatState();
  const { generateChatStream, llmConfig } = useLLM();
  const [editor] = useLexicalComposerContext();

  const systemPrompt = useSystemPrompt(mode);
  const { convertEditorStateToMarkdown } = useMarkdownTools();

  // Server-orchestrated agent workflow hook
  const { runAgentWorkflow } = useAgentWorkflow({
    onError: (error) => {
      console.error("[agent] Workflow error:", error);
    },
  });

  // Prevent duplicate agent turns from concurrent triggers
  const agentInFlightRef = useRef(false);

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

      // Add context based on mode (Markdown for chat, JSON for agent)
      const currentEditorState = editor.getEditorState();
      if (mode === "chat" && currentEditorState) {
        // Strict markdown formatting instruction for final response text (chat mode only)
        fullPrompt +=
          "\n\nFORMATTING_INSTRUCTION:\nStrictly format your final response text using Markdown. Do **not** output JSON or any other structured format. Keep Markdown nesting minimal (nested lists or quotes) and headings small for readability in a chat interface.";
        const markdownContent =
          convertEditorStateToMarkdown(currentEditorState);
        fullPrompt += `\n\nMARKDOWN_CONTEXT:\n${markdownContent}`;
      }
      // For agent mode, JSON state is passed separately as documentJson

      return fullPrompt;
    },
    [convertEditorStateToMarkdown, editor, messages, mode],
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

      // Streaming state for agent mode is handled by useAgentWorkflow hook

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
          // Server-orchestrated agent workflow
          if (agentInFlightRef.current) {
            console.warn(
              "[agent] Turn already in-flight. Ignoring duplicate trigger.",
            );
            return;
          }
          agentInFlightRef.current = true;

          try {
            const currentEditorState = editor.getEditorState();
            const documentMarkdown =
              convertEditorStateToMarkdown(currentEditorState);
            // Parse editorStateJson string to JSON object for documentJson
            const documentJson = editorStateJson
              ? (JSON.parse(editorStateJson) as Record<string, unknown>)
              : undefined;
            await runAgentWorkflow({
              prompt, // Just the user's prompt (not formatted)
              originalPrompt: prompt, // Original user prompt for planner
              documentMarkdown, // Markdown snapshot for planner
              documentJson, // JSON state as separate property
              files,
            });
          } finally {
            agentInFlightRef.current = false;
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
        // Agent workflow cleanup is handled by runAgentWorkflow
        if (mode === "agent") {
          agentInFlightRef.current = false;
        }
      }
    },
    [
      dispatch,
      mode,
      generateChatStream,
      systemPrompt,
      buildPromptString,
      runAgentWorkflow,
      llmConfig.chat.temperature,
      convertEditorStateToMarkdown,
      editor,
    ],
  );
};

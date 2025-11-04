import React, { createContext, useCallback, useReducer } from "react";
import type { AppToolCall, AppToolResult } from "../../context/llm-context";

export type ChatState = {
  messages: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    toolCalls?: AppToolCall[];
    toolResults?: AppToolResult[];
  }[];
  streaming: boolean;
  sidebarOpen: boolean;
  mode: "chat" | "agent" | "debug" | "slide-agent";
  streamingMessageId: string | null;
  maxAgentSteps: number;
};

export type Action =
  | { type: "push"; msg: ChatState["messages"][number] }
  | { type: "toggleSidebar" }
  | { type: "setMode"; mode: ChatState["mode"] }
  | { type: "reset" }
  | { type: "removeMessage"; id: string }
  | { type: "setMaxAgentSteps"; steps: number }
  | { type: "startStreaming"; id: string }
  | { type: "stopStreaming" }
  | {
      type: "update";
      msg: Partial<ChatState["messages"][number]> & { id: string };
    };

const initial: ChatState = {
  messages: [],
  streaming: false,
  sidebarOpen: false,
  mode: "agent",
  streamingMessageId: null,
  maxAgentSteps: 5,
};

export type ChatDispatch = React.Dispatch<Action>;

export const ChatStateCtx = createContext<ChatState | undefined>(undefined);
export const ChatDispatchCtx = createContext<
  React.Dispatch<Action> | undefined
>(undefined);

export const LlmChatProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  console.log("🔄 LlmChatProvider re-rendered");

  /**
   * Merges tool calls arrays using Map-based deduplication for O(n) complexity.
   * Incoming tool calls override existing ones with the same toolCallId.
   */
  const mergeToolCalls = useCallback(
    (existing: AppToolCall[], incoming: AppToolCall[]): AppToolCall[] => {
      const existingMap = new Map(existing.map((tc) => [tc.toolCallId, tc]));
      for (const newTc of incoming) {
        existingMap.set(newTc.toolCallId, newTc);
      }
      return Array.from(existingMap.values());
    },
    [],
  );

  /**
   * Merges tool results arrays using Map-based deduplication for O(n) complexity.
   * Incoming tool results override existing ones with the same toolCallId.
   */
  const mergeToolResults = useCallback(
    (existing: AppToolResult[], incoming: AppToolResult[]): AppToolResult[] => {
      const existingMap = new Map(
        existing.map((tr) => [(tr as { toolCallId: string }).toolCallId, tr]),
      );
      for (const newTr of incoming) {
        const toolCallId = (newTr as { toolCallId: string }).toolCallId;
        existingMap.set(toolCallId, newTr);
      }
      return Array.from(existingMap.values());
    },
    [],
  );

  const reducer = useCallback(
    (s: ChatState, a: Action): ChatState => {
      switch (a.type) {
        case "push": {
          if (s.messages.some((m) => m.id === a.msg.id)) {
            console.warn("Attempted to push duplicate message:", a.msg);
            return s;
          }
          const newMessage = {
            ...a.msg,
            toolCalls: a.msg.toolCalls ?? [],
            toolResults: a.msg.toolResults ?? [],
          };
          return { ...s, messages: [...s.messages, newMessage] };
        }
        case "toggleSidebar":
          return { ...s, sidebarOpen: !s.sidebarOpen };
        case "setMode":
          if (
            a.mode !== "chat" &&
            a.mode !== "agent" &&
            a.mode !== "debug" &&
            a.mode !== "slide-agent"
          ) {
            console.warn("Invalid mode set:", a.mode);
            return s;
          }
          return { ...s, mode: a.mode };
        case "setMaxAgentSteps":
          if (a.steps >= 1 && a.steps <= 25) {
            return { ...s, maxAgentSteps: a.steps };
          }
          return s;
        case "reset":
          return {
            ...initial,
            maxAgentSteps: s.maxAgentSteps,
            sidebarOpen: s.sidebarOpen,
            streamingMessageId: null,
          };
        case "startStreaming":
          return { ...s, streaming: true, streamingMessageId: a.id };
        case "stopStreaming":
          return { ...s, streaming: false, streamingMessageId: null };
        case "removeMessage": {
          const messages = s.messages.filter((msg) => msg.id !== a.id);
          return { ...s, messages };
        }
        case "update": {
          if (!a.msg.id) {
            console.warn("Update action requires message ID:", a.msg);
            return s;
          }
          const updatedMessages = s.messages.map((msg) => {
            if (msg.id === a.msg.id) {
              const existingToolCalls = msg.toolCalls ?? [];
              const newToolCalls = a.msg.toolCalls ?? [];
              const mergedToolCalls = mergeToolCalls(
                existingToolCalls,
                newToolCalls,
              );

              const existingToolResults = msg.toolResults ?? [];
              const newToolResults = a.msg.toolResults ?? [];
              const mergedToolResults = mergeToolResults(
                existingToolResults,
                newToolResults,
              );

              return {
                ...msg,
                ...a.msg,
                toolCalls:
                  mergedToolCalls.length > 0 ? mergedToolCalls : undefined,
                toolResults:
                  mergedToolResults.length > 0 ? mergedToolResults : undefined,
              };
            }
            return msg;
          });
          return { ...s, messages: updatedMessages };
        }
        default: {
          const unhandledAction = a as Action;
          console.warn("Unhandled action type:", unhandledAction?.type);
          return s;
        }
      }
    },
    [mergeToolCalls, mergeToolResults],
  );

  const [state, dispatch] = useReducer(reducer, initial);

  return (
    <ChatStateCtx.Provider value={state}>
      <ChatDispatchCtx.Provider value={dispatch}>
        {children}
      </ChatDispatchCtx.Provider>
    </ChatStateCtx.Provider>
  );
};

export const useChatState = (): ChatState => {
  const ctx = React.useContext(ChatStateCtx);
  if (ctx === undefined) {
    throw new Error("useChatState must be used within a LlmChatProvider");
  }
  return ctx;
};

export const useChatDispatch = (): React.Dispatch<Action> => {
  const ctx = React.useContext(ChatDispatchCtx);
  if (ctx === undefined) {
    throw new Error("useChatDispatch must be used within a LlmChatProvider");
  }
  return ctx;
};

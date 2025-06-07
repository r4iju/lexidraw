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
  const reducer = useCallback((s: ChatState, a: Action): ChatState => {
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
            return { ...msg, ...a.msg };
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
  }, []);

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

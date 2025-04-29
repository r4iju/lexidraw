import React, { createContext, useCallback, useReducer } from "react";
import type { AppToolCall } from "../../context/llm-context";

export type ChatState = {
  messages: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    toolCalls?: AppToolCall[];
  }[];
  streaming: boolean;
  sidebarOpen: boolean;
  mode: "chat" | "agent";
};

type Action =
  | { type: "push"; msg: ChatState["messages"][number] }
  | { type: "setStreaming"; flag: boolean }
  | { type: "toggleSidebar" }
  | { type: "setMode"; mode: ChatState["mode"] }
  | { type: "reset" };

const initial: ChatState = {
  messages: [],
  streaming: false,
  sidebarOpen: false,
  mode: "agent",
};

export const ChatStateCtx = createContext<ChatState | undefined>(undefined);
export const ChatDispatchCtx = createContext<
  React.Dispatch<Action> | undefined
>(undefined);

export const LlmChatProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const reducer = useCallback((s: ChatState, a: Action): ChatState => {
    switch (a.type) {
      case "push":
        // prevent duplicates
        if (s.messages.some((m) => m.id === a.msg.id)) {
          console.warn("Attempted to push duplicate message:", a.msg);
          return s;
        }
        return { ...s, messages: [...s.messages, a.msg] };
      case "setStreaming":
        return { ...s, streaming: a.flag };
      case "toggleSidebar":
        return { ...s, sidebarOpen: !s.sidebarOpen };
      case "setMode":
        // ensure valid mode
        if (a.mode !== "chat" && a.mode !== "agent") {
          console.warn("Invalid mode set:", a.mode);
          return s;
        }
        return { ...s, mode: a.mode };
      case "reset":
        return {
          ...initial,
          sidebarOpen: s.sidebarOpen, // keep sidebar state on reset
          messages: [],
        };
      default: {
        // default case for type safety
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

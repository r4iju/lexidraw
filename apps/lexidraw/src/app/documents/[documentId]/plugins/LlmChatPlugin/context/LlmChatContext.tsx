import React, { createContext, useCallback, useReducer } from "react";

export type ToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type ChatState = {
  messages: {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    toolCalls?: ToolCall[];
  }[];
  streaming: boolean;
  sidebarOpen: boolean;
  mode: "chat" | "agent";
};

// Action type remains the same
type Action =
  | { type: "push"; msg: ChatState["messages"][number] }
  | { type: "setStreaming"; flag: boolean }
  | { type: "toggleSidebar" }
  | { type: "setMode"; mode: ChatState["mode"] };

// Initial state remains the same
const initial: ChatState = {
  messages: [],
  streaming: false,
  sidebarOpen: false,
  mode: "chat",
};

// Context definitions (ChatStateCtx and ChatDispatchCtx remain)
export const ChatStateCtx = createContext<ChatState | undefined>(undefined);
export const ChatDispatchCtx = createContext<
  React.Dispatch<Action> | undefined
>(undefined);

// Removed ChatServiceCtx
// export const ChatServiceCtx = createContext<LlmClient | undefined>(undefined);

export const LlmChatProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const reducer = useCallback((s: ChatState, a: Action): ChatState => {
    switch (a.type) {
      case "push":
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
        if (a.mode !== "chat" && a.mode !== "agent") {
          console.warn("Invalid mode set:", a.mode);
          return s;
        }
        return { ...s, mode: a.mode };
      default: {
        // Scope the declaration within the case block
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

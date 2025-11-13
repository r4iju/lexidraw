import React, {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useReducer,
} from "react";
import type { AppToolCall, AppToolResult } from "../../context/llm-context";
import { useEntityId } from "~/hooks/use-entity-id";
import { useDebounce } from "~/lib/client-utils";
import { loadMessages, saveMessages } from "./storage/local-chat-storage";

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
  | { type: "setMessages"; messages: ChatState["messages"] }
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
  const documentId = useEntityId();
  const prevModeRef = useRef<ChatState["mode"] | null>(null);
  const prevMessagesRef = useRef<ChatState["messages"]>([]);
  const prevDocumentIdRef = useRef<string | undefined>(undefined);

  // Initialize state with loaded messages if available (lazy initialization)
  const initializeState = (): ChatState => {
    if (typeof window === "undefined") {
      return initial;
    }
    // documentId might not be available on first render, so we'll load in effect
    // But if it is available, load synchronously
    if (documentId) {
      const loaded = loadMessages(documentId, initial.mode);
      return {
        ...initial,
        messages: loaded,
      };
    }
    return initial;
  };

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
            ...s,
            messages: [],
            streaming: false,
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
        case "setMessages":
          return { ...s, messages: a.messages };
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

  const [state, dispatch] = useReducer(reducer, initializeState());
  const isLoadingRef = useRef(false);

  // Debounced save for messages (500ms delay)
  const saveMessagesFn = useCallback(
    (
      docId: string,
      mode: ChatState["mode"],
      messages: ChatState["messages"],
    ) => {
      saveMessages(docId, mode, messages);
    },
    [],
  );
  const { run: saveMessagesDebounced, cancel: cancelSaveMessages } =
    useDebounce(saveMessagesFn as (...args: unknown[]) => void, 500);

  // Load messages on mount/documentId change (if not already loaded by initializeState)
  useEffect(() => {
    if (!documentId) return;

    const documentIdChanged = prevDocumentIdRef.current !== documentId;
    const currentMessages = state.messages;
    const currentMode = state.mode;

    if (prevModeRef.current === null) {
      // First mount - check if initializeState already loaded
      if (currentMessages.length > 0) {
        // Already loaded by initializeState, just sync refs
        prevMessagesRef.current = currentMessages;
        prevModeRef.current = currentMode;
      } else {
        // Not loaded yet, load now
        isLoadingRef.current = true;
        const loaded = loadMessages(documentId, currentMode);
        if (loaded.length > 0) {
          dispatch({ type: "setMessages", messages: loaded });
          prevMessagesRef.current = loaded;
        } else {
          prevMessagesRef.current = [];
        }
        prevModeRef.current = currentMode;
        isLoadingRef.current = false;
      }
      prevDocumentIdRef.current = documentId;
    } else if (documentIdChanged) {
      // documentId changed - load new messages
      isLoadingRef.current = true;
      const loaded = loadMessages(documentId, currentMode);
      if (loaded.length > 0) {
        dispatch({ type: "setMessages", messages: loaded });
        prevMessagesRef.current = loaded;
      } else {
        dispatch({ type: "setMessages", messages: [] });
        prevMessagesRef.current = [];
      }
      prevModeRef.current = currentMode;
      prevDocumentIdRef.current = documentId;
      isLoadingRef.current = false;
    }
  }, [documentId, state.messages, state.mode]); // state.messages/mode needed for first mount check

  // Handle mode changes: save previous mode, load new mode
  useEffect(() => {
    if (!documentId) return;
    const prevMode = prevModeRef.current;

    // Skip on initial mount (handled by documentId effect)
    if (prevMode === null) {
      prevModeRef.current = state.mode;
      return;
    }

    // Save previous mode's messages immediately if mode changed
    if (prevMode !== state.mode && prevMessagesRef.current.length > 0) {
      cancelSaveMessages(); // Cancel any pending debounced save
      saveMessages(documentId, prevMode, prevMessagesRef.current);
    }

    // Load new mode's messages
    isLoadingRef.current = true;
    const loaded = loadMessages(documentId, state.mode);
    if (loaded.length > 0) {
      dispatch({ type: "setMessages", messages: loaded });
      prevMessagesRef.current = loaded;
    } else {
      dispatch({ type: "setMessages", messages: [] });
      prevMessagesRef.current = [];
    }
    prevModeRef.current = state.mode;
    isLoadingRef.current = false;
  }, [documentId, state.mode, cancelSaveMessages]);

  // Save messages with debounce when they change (skip if loading)
  useEffect(() => {
    if (!documentId || isLoadingRef.current) return;
    // Skip on initial mount
    if (prevModeRef.current === null) return;

    // Update ref for next save
    prevMessagesRef.current = state.messages;

    // Save with debounce
    saveMessagesDebounced(documentId, state.mode, state.messages);
  }, [documentId, state.mode, state.messages, saveMessagesDebounced]);

  // Cleanup: save current state on unmount
  useEffect(() => {
    return () => {
      if (!documentId) return;
      cancelSaveMessages();
      if (prevMessagesRef.current.length > 0) {
        saveMessages(
          documentId,
          prevModeRef.current ?? state.mode,
          prevMessagesRef.current,
        );
      }
    };
  }, [documentId, cancelSaveMessages, state.mode]);

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

import React, {
  createContext,
  useState,
  useContext,
  useCallback,
  PropsWithChildren,
} from "react";
import { useLLM } from "../../context/llm-context";

type ToolCall = {
  name: string;
  args: Record<string, unknown>;
};

export type ChatMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { id: string; role: "system"; content: string };

export type ChatMode = "chat" | "edit" | "agent";

interface LlmChatContextType {
  messages: ChatMessage[];
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  isStreaming: boolean;
  sendQuery: (payload: {
    prompt: string;
    selectionHtml?: string;
  }) => Promise<void>;
  appendStreaming: (chunk: string) => void;
  finishStreaming: (fullText: string, calls?: ToolCall[]) => void;
}

const LlmChatContext = createContext<LlmChatContextType | null>(null);

const buildContext = (selectionHtml: string | undefined): string => {
  console.log("Building context with selection:", selectionHtml);
  return selectionHtml
    ? `Context based on: ${selectionHtml.substring(0, 100)}...`
    : "";
};

const buildPrompt = (args: {
  prompt: string;
  ctx: string;
  mode: ChatMode;
}): string => {
  console.log("Building prompt with args:", args);
  return `${args.prompt}

${args.ctx}`;
};

export const LlmChatProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const { generate } = useLLM();

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const sendQuery = useCallback(
    async ({
      prompt,
      selectionHtml,
    }: {
      prompt: string;
      selectionHtml?: string;
    }) => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
      };
      setMessages((prevMessages) => [...prevMessages, userMsg]);
      setIsStreaming(true);

      try {
        const ctx = buildContext(selectionHtml);
        const fullPrompt = buildPrompt({ prompt, ctx, mode });
        const result = await generate({
          prompt: fullPrompt,
        });

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result, // Assuming result is string content
          // TODO: Parse tool calls from result if applicable
        };
        setMessages((prevMessages) => [...prevMessages, assistantMsg]);
      } catch (error) {
        console.error("Error sending query:", error);
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "system",
          content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
        setMessages((prevMessages) => [...prevMessages, errorMsg]);
      } finally {
        setIsStreaming(false);
      }
    },
    [generate, mode],
  );

  const appendStreaming = useCallback((chunk: string) => {
    setMessages((prevMessages) => {
      const last = prevMessages.at(-1);
      if (!last || last.role !== "assistant") {
        console.warn(
          "appendStreaming called but last message is not assistant.",
        );
        return prevMessages;
      }
      const currentContent = last.content || "";
      const updatedMessages = [...prevMessages];
      updatedMessages[updatedMessages.length - 1] = {
        ...last,
        content: currentContent + chunk,
      };
      return updatedMessages;
    });
  }, []);

  const finishStreaming = useCallback(
    (fullText: string, calls?: ToolCall[]) => {
      setMessages((prevMessages) => {
        const last = prevMessages.at(-1);
        if (!last || last.role !== "assistant") {
          console.warn(
            "finishStreaming called but last message is not assistant.",
          );
          return prevMessages; // Or handle error appropriately
        }
        const updatedMessages = [...prevMessages];
        updatedMessages[updatedMessages.length - 1] = {
          ...last,
          content: fullText,
          toolCalls: calls, // Add tool calls
        };
        return updatedMessages;
      });
      setIsStreaming(false); // Ensure streaming is set to false
    },
    [],
  ); // No dependencies

  const contextValue: LlmChatContextType = {
    messages,
    mode,
    setMode,
    isSidebarOpen,
    toggleSidebar,
    isStreaming,
    sendQuery,
    appendStreaming,
    finishStreaming,
  };

  return (
    <LlmChatContext.Provider value={contextValue}>
      {children}
    </LlmChatContext.Provider>
  );
};

// Custom hook to use the context
export const useLlmChat = (): LlmChatContextType => {
  const context = useContext(LlmChatContext);
  if (!context) {
    throw new Error("useLlmChat must be used within a LlmChatProvider");
  }
  return context;
};

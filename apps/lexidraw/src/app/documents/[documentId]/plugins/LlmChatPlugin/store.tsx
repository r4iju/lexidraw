import React, {
  createContext,
  useState,
  useContext,
  useCallback,
  PropsWithChildren,
} from "react";
import { useLLM, type AppToolCall } from "../../context/llm-context";

export type ChatToolCall = AppToolCall;

export type ChatMessage =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      toolCalls?: ChatToolCall[];
    }
  | { id: string; role: "system"; content: string };

export type ChatMode = "chat" | "agent";

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
  }) => Promise<ChatToolCall[] | undefined>;
  appendStreaming: (chunk: string) => void;
  finishStreaming: (fullText: string, calls?: ChatToolCall[]) => void;
}

const LlmChatContext = createContext<LlmChatContextType | null>(null);

export const LlmChatProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<ChatMode>("chat");
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const { generate } = useLLM();

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const buildContext = useCallback(
    (lexicalJsonStateString: string | undefined): string => {
      console.log(
        "Building context with Lexical JSON state preview:",
        lexicalJsonStateString
          ? `${lexicalJsonStateString.substring(0, 100)}...`
          : "(none)",
      );
      return lexicalJsonStateString
        ? `Context:\n---\nLexical JSON State:\n${lexicalJsonStateString}\n---`
        : "Context: (No editor state provided)";
    },
    [],
  );

  const buildPrompt = useCallback(
    (args: { prompt: string; ctx: string; mode: ChatMode }): string => {
      return `${args.prompt}\n\n${args.ctx}`;
    },
    [],
  );

  const getEditedText = useCallback(
    async (
      instructions: string,
      originalJsonState: string,
    ): Promise<string | null> => {
      console.log("Performing second LLM call for structured edit...", {
        instructions,
      });
      try {
        const systemPrompt =
          "You are an editor assistant. You will be given instructions and a Lexical editor state represented as a JSON string. " +
          "Apply the instructions to modify the editor state. " +
          "Output *only* the complete, modified Lexical editor state as a valid JSON string, enclosed in a single JSON code block. " +
          "Do not include any other explanatory text, preamble, or markdown formatting outside the JSON code block.";

        const promptForEdit = `${instructions}\n\nLexical JSON State to Edit:\n\`\`\`json\n${originalJsonState}\n\`\`\`\n\n${systemPrompt}`;

        const editResult = await generate({
          prompt: promptForEdit,
          system: systemPrompt,
        });

        let modifiedJsonState: string | null = null;
        const jsonMatch = editResult.text?.match(/```json\n(.*)\n```/s);
        if (jsonMatch && jsonMatch[1]) {
          modifiedJsonState = jsonMatch[1].trim();
          try {
            JSON.parse(modifiedJsonState);
            console.log("Second LLM call successful, valid JSON received.");
            return modifiedJsonState;
          } catch (parseError) {
            console.error(
              "Second LLM call returned text in JSON block, but failed to parse:",
              parseError,
              modifiedJsonState,
            );
            return null;
          }
        } else {
          console.warn(
            "Second LLM call did not return expected JSON block format.",
            editResult.text,
          );
          try {
            if (editResult.text) {
              JSON.parse(editResult.text);
              console.log(
                "Second LLM call successful, parsed entire response as JSON.",
              );
              return editResult.text;
            }
          } catch {
            /* Ignore if parsing whole text fails */
          }
          return null;
        }
      } catch (error) {
        console.error("Error during getEditedText structured LLM call:", error);
        return null;
      }
    },
    [generate],
  );

  const sendQuery = useCallback(
    async ({
      prompt,
      selectionHtml,
    }: {
      prompt: string;
      selectionHtml?: string;
    }): Promise<ChatToolCall[] | undefined> => {
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: prompt,
      };
      setMessages((prevMessages) => [...prevMessages, userMsg]);
      setIsStreaming(true);

      let finalToolCalls: ChatToolCall[] | undefined = undefined;

      try {
        const ctx = buildContext(selectionHtml);
        const fullPrompt = buildPrompt({ prompt, ctx, mode });

        const initialResult = await generate({
          prompt: fullPrompt,
        });

        const assistantText = initialResult.text;
        let originalToolCalls = initialResult.toolCalls;

        const contextJsonState = selectionHtml;

        const editTextCalls =
          originalToolCalls?.filter((c) => c.toolName === "editText") || [];

        if (editTextCalls.length > 0 && contextJsonState) {
          console.log("Detected editText calls, attempting consolidation...");
          const correctedJsonState = await getEditedText(
            prompt,
            contextJsonState,
          );

          if (correctedJsonState !== null) {
            console.log(
              "Consolidated edit successful. Creating single replace command.",
            );
            finalToolCalls = [
              {
                toolCallId: `consolidated-${crypto.randomUUID()}`,
                toolName: "editText",
                args: {
                  newStateJson: correctedJsonState,
                  instructions: prompt,
                },
              },
            ];
            originalToolCalls = undefined;
          } else {
            console.warn(
              "Consolidated edit failed. Discarding original tool calls.",
            );
            finalToolCalls = undefined;
            originalToolCalls = undefined;
          }
        } else {
          finalToolCalls = originalToolCalls;
        }

        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantText,
          toolCalls: finalToolCalls,
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

      return finalToolCalls;
    },
    [generate, mode, getEditedText, buildContext, buildPrompt],
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
    (fullText: string, calls?: ChatToolCall[]) => {
      setMessages((prevMessages) => {
        const last = prevMessages.at(-1);
        if (!last || last.role !== "assistant") {
          console.warn(
            "finishStreaming called but last message is not assistant.",
          );
          return prevMessages;
        }
        const updatedMessages = [...prevMessages];
        updatedMessages[updatedMessages.length - 1] = {
          ...last,
          content: fullText,
          toolCalls: calls,
        };
        return updatedMessages;
      });
      setIsStreaming(false);
    },
    [],
  );

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

export const useLlmChat = (): LlmChatContextType => {
  const context = useContext(LlmChatContext);
  if (!context) {
    throw new Error("useLlmChat must be used within a LlmChatProvider");
  }
  return context;
};

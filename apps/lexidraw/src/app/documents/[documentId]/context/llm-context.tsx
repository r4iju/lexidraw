"use client";

import { createContext, useContext } from "react";
import type { PropsWithChildren } from "react";

import type {
  LanguageModel,
  StepResult,
  tool,
  ToolCallRepairFunction,
  ToolChoice,
  ModelMessage,
} from "ai";
import type {
  LlmBaseConfigSchema,
  StoredLlmConfig,
} from "~/server/api/routers/config";
import type { z } from "zod";

export type RuntimeToolMap = Record<string, ReturnType<typeof tool>>;

export type LlmMode = "autocomplete" | "chat" | "agent";

export type AppToolCall = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type AppToolResult = Record<string, unknown>;

export type StreamCallbacks = {
  onTextUpdate?: (text: string) => void;
  onFinish?: (result: GenerateChatStreamResult) => void;
  onError?: (error: Error) => void;
};

export type GenerateChatStreamResult = {
  text: string;
};

export type GenerateChatResponseResult = {
  text: string;
  toolCalls?: AppToolCall[];
  toolResults?: AppToolResult[];
};

export type LLMBaseState = z.infer<typeof LlmBaseConfigSchema>;
type LLMConfig = {
  chat: LLMBaseState;
  autocomplete: LLMBaseState;
  agent: LLMBaseState;
};

export type ChatLLMState = {
  isError: boolean;
  text: string;
  error: string | null;
  toolCalls?: AppToolCall[];
  toolResults?: AppToolResult[];
  isStreaming: boolean;
};

export type AutocompleteLLMState = {
  isError: boolean;
  text: string;
  error: string | null;
  isLoading: boolean;
};

export type LLMOptions = {
  prompt: string;
  messages?: ModelMessage[];
  system?: string;
  temperature?: number;
  signal?: AbortSignal;
  tools?: RuntimeToolMap;
  maxSteps?: number;
  toolChoice?: ToolChoice<RuntimeToolMap>;
  files?: File[] | FileList | null;
};

// Model list removed; model selection is server-controlled

type LLMContextValue = {
  llmConfig: LLMConfig;
  updateLlmConfig: (
    config: Partial<{
      chat: Partial<LLMBaseState>;
      autocomplete: Partial<LLMBaseState>;
      agent: Partial<LLMBaseState>;
    }>,
    options?: { mode?: "chat" | "autocomplete" | "agent" },
  ) => void;
  autocompleteState: AutocompleteLLMState;
  generateChatResponse: (
    options: LLMOptions & {
      mode?: "chat" | "agent";
      files?: File[] | FileList | null;
      repairToolCall?: ToolCallRepairFunction<RuntimeToolMap>;
      toolChoice?: ToolChoice<RuntimeToolMap>;
      prepareStep?: (options: {
        steps: StepResult<RuntimeToolMap>[];
        stepNumber: number;
        model: LanguageModel;
        messages: ModelMessage[];
      }) => Promise<{
        model?: LanguageModel;
        toolChoice?: ToolChoice<RuntimeToolMap>;
        activeTools?: Array<keyof RuntimeToolMap>;
        system?: string;
        messages?: ModelMessage[];
      }>;
    },
  ) => Promise<GenerateChatResponseResult>;
  generateChatStream: (
    options: Omit<LLMOptions, "tools" | "toolChoice"> & {
      callbacks: StreamCallbacks;
      files?: File[] | FileList | null;
    },
  ) => Promise<void>;
  chatState: ChatLLMState;
};

const LLMContext = createContext<LLMContextValue | null>(null);

type LLMProviderProps = PropsWithChildren<{
  initialConfig: StoredLlmConfig;
}>;

export const LEGACY_CHAT_UNAVAILABLE =
  "Chat is unavailable while AI Power is being updated. Use supported writing suggestions or document actions. Your saved chat history and documents are preserved.";

export function LLMProvider({ children, initialConfig }: LLMProviderProps) {
  return (
    <LLMContext.Provider
      value={{
        llmConfig: initialConfig,
        updateLlmConfig: () => {
          throw new Error(
            "Use AI Power. Legacy model settings are unavailable.",
          );
        },
        autocompleteState: {
          isError: false,
          text: "",
          error: null,
          isLoading: false,
        },
        chatState: {
          isError: false,
          text: "",
          error: null,
          isStreaming: false,
        },
        generateChatResponse: async () => {
          throw new Error(LEGACY_CHAT_UNAVAILABLE);
        },
        generateChatStream: async ({ callbacks }) => {
          callbacks.onError?.(new Error(LEGACY_CHAT_UNAVAILABLE));
        },
      }}
    >
      {children}
    </LLMContext.Provider>
  );
}

export function useLLM() {
  const ctx = useContext(LLMContext);
  if (!ctx) {
    throw new Error("useLLM must be used inside an <LLMProvider />");
  }
  return ctx;
}

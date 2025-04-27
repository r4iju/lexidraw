"use client";

import React, {
  createContext,
  useCallback,
  useState,
  useContext,
  type PropsWithChildren,
  useRef,
  useEffect,
} from "react";

import {
  generateText,
  streamText,
  ToolCallRepairFunction,
  ToolSet,
  type Tool,
} from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

import { useSession } from "next-auth/react";

// Define types for different LLM modes
export type LlmMode = "autocomplete" | "chat";

export type AppToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

// Base state common to both modes
export type LLMBaseState = {
  modelId: string;
  provider: string;
  temperature: number;
  maxTokens: number;
};

// Specific state for chat mode (includes streaming/tool state)
export type ChatLLMState = LLMBaseState & {
  isError: boolean;
  text: string; // Accumulated text from stream
  error: string | null;
  toolCalls?: AppToolCall[]; // Store tool calls from stream
  isStreaming: boolean; // Track if currently streaming
};

// Specific state for autocomplete mode
export type AutocompleteLLMState = LLMBaseState & {
  isError: boolean;
  text: string; // Generated text (non-streamed)
  error: string | null;
  isLoading: boolean; // Track if generation is in progress
};

export type LLMOptions = {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: Record<string, Tool>;
};

export type GenerateChatResult = {
  text: string;
  toolCalls?: AppToolCall[];
};

type LLMContextValue = {
  // Autocomplete specific
  generateAutocomplete: (options: LLMOptions) => Promise<string>;
  autocompleteState: AutocompleteLLMState;
  setAutocompleteLlmOptions: (options: Partial<LLMBaseState>) => void;

  // Chat specific
  generateChatStream: (
    options: LLMOptions & {
      experimental_repairToolCall?: ToolCallRepairFunction<ToolSet>;
    },
  ) => Promise<GenerateChatResult>;
  chatState: ChatLLMState;
  setChatLlmOptions: (options: Partial<LLMBaseState>) => void;

  // Shared
  availableModels: typeof LlmModelList;
  getProviderInstance: (
    providerName: string,
  ) =>
    | ReturnType<typeof createGoogleGenerativeAI>
    | ReturnType<typeof createOpenAI>
    | null;
};

export const LlmModelList = [
  {
    modelId: "gpt-4.1-nano",
    provider: "openai",
    name: "GPT-4.1 Nano",
    description: "The smallest and fastest GPT model",
  },
  {
    modelId: "gpt-4.1-mini",
    provider: "openai",
    name: "GPT-4.1 Mini",
    description: "A fast GPT model",
  },
  {
    modelId: "gpt-4.1",
    provider: "openai",
    name: "GPT-4.1",
    description: "The latest and most powerful GPT model",
  },
  {
    modelId: "gemini-2.0-flash-lite",
    provider: "google",
    name: "Gemini 2.0 Flash Lite",
    description:
      "A Gemini 2.0 Flash model optimized for cost efficiency and low latency",
  },
  {
    modelId: "gemini-2.0-flash",
    provider: "google",
    name: "Gemini 2.0 Flash",
    description:
      "Next generation features, speed, thinking, realtime streaming, and multimodal generation",
  },
  {
    modelId: "gemini-2.0-pro-exp-02-05",
    provider: "google",
    name: "Gemini 2.0 Pro Exp",
    description: "The most powerful Gemini 2.0 model",
  },
  {
    modelId: "gemini-2.5-pro-exp-03-25",
    provider: "google",
    name: "Gemini 2.5 Pro Exp",
    description: "The most powerful Gemini 2.5 model",
  },
] as const;

const LLMContext = createContext<LLMContextValue | null>(null);

export function LLMProvider({ children }: PropsWithChildren<unknown>) {
  const { data: session } = useSession();

  // State for Autocomplete
  const [autocompleteState, setAutocompleteState] =
    useState<AutocompleteLLMState>({
      modelId: "gemini-2.0-flash-lite",
      provider: "google",
      temperature: 0.3,
      maxTokens: 500,
      isError: false,
      text: "",
      error: null,
      isLoading: false,
    });

  // State for Chat
  const [chatState, setChatState] = useState<ChatLLMState>({
    modelId: "gemini-2.0-flash",
    provider: "google",
    temperature: 0.7,
    maxTokens: 100_000,
    isError: false,
    text: "",
    error: null,
    isStreaming: false,
    toolCalls: undefined,
  });

  // Store provider instances in refs to avoid re-creation
  const providerInstances = useRef<
    Record<
      string,
      ReturnType<typeof createGoogleGenerativeAI | typeof createOpenAI>
    >
  >({});

  const createProviderInstanceInternal = useCallback(
    (providerName: string) => {
      if (!session) {
        console.error(
          "[LLMContext] Session not available for provider creation.",
        );
        return null;
      }
      // Return cached instance if available
      if (providerInstances.current[providerName]) {
        return providerInstances.current[providerName];
      }

      let instance: ReturnType<
        typeof createGoogleGenerativeAI | typeof createOpenAI
      > | null = null;
      switch (providerName) {
        case "google":
          instance = createGoogleGenerativeAI({
            apiKey: session?.user.config.llm.googleApiKey,
          });
          break;
        case "openai":
          instance = createOpenAI({
            apiKey: session?.user.config.llm.openaiApiKey,
          });
          break;
        default:
          console.warn("Unsupported LLM provider:", providerName);
          return null;
      }

      if (instance) {
        providerInstances.current[providerName] = instance; // Cache the instance
      }
      return instance;
    },
    [session], // Depend only on session
  );

  // Expose the function to get providers
  const getProviderInstance = useCallback(
    (providerName: string) => {
      return createProviderInstanceInternal(providerName);
    },
    [createProviderInstanceInternal],
  );

  // Use the internal creator for the default providers
  const autocompleteProvider =
    useRef<ReturnType<typeof createProviderInstanceInternal>>(null);
  const chatProvider =
    useRef<ReturnType<typeof createProviderInstanceInternal>>(null);

  useEffect(() => {
    // Check if provider exists before assigning
    const createdAutocompleteProvider = createProviderInstanceInternal(
      autocompleteState.provider,
    );
    if (createdAutocompleteProvider) {
      autocompleteProvider.current = createdAutocompleteProvider;
    }
    const createdChatProvider = createProviderInstanceInternal(
      chatState.provider,
    );
    if (createdChatProvider) {
      chatProvider.current = createdChatProvider;
    }
  }, [
    createProviderInstanceInternal,
    autocompleteState.provider,
    chatState.provider,
  ]);

  const generateAutocomplete = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
      signal,
    }: LLMOptions): Promise<string> => {
      if (!autocompleteProvider.current) {
        console.error("[LLMContext] Autocomplete provider not initialized");
        setAutocompleteState((prev) => ({
          ...prev,
          isError: true,
          error: "Autocomplete provider not initialized",
          isLoading: false,
        }));
        return "";
      }

      if (signal?.aborted) {
        return "";
      }

      setAutocompleteState((prev) => ({
        ...prev,
        isLoading: true,
        isError: false,
        error: null,
      }));
      try {
        const result = await generateText({
          model: autocompleteProvider.current(autocompleteState.modelId),
          prompt,
          system,
          temperature: temperature ?? autocompleteState.temperature,
          maxTokens: maxTokens ?? autocompleteState.maxTokens,
          abortSignal: signal,
        });

        setAutocompleteState((prev) => ({
          ...prev,
          isError: false,
          text: result.text,
          error: null,
          isLoading: false,
        }));

        return result.text;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          setAutocompleteState((prev) => ({ ...prev, isLoading: false }));
          return "";
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        setAutocompleteState((prev) => ({
          ...prev,
          isError: true,
          text: "",
          error: errorMsg,
          isLoading: false,
        }));
        return "";
      }
    },
    [
      autocompleteProvider,
      autocompleteState.modelId,
      autocompleteState.temperature,
      autocompleteState.maxTokens,
    ],
  );

  const generateChatStream = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
      signal,
      tools,
    }: Omit<
      LLMOptions,
      "experimental_repairToolCall"
    >): Promise<GenerateChatResult> => {
      let accumulatedText = "";
      const capturedToolCalls: AppToolCall[] = [];

      if (!chatProvider.current) {
        console.error("Chat provider not initialized");
        setChatState((prev) => ({
          ...prev,
          isError: true,
          error: "Chat provider not initialized",
          isStreaming: false,
        }));
        return { text: "", toolCalls: undefined };
      }

      setChatState((prev) => ({
        ...prev,
        isStreaming: true,
        isError: false,
        error: null,
        text: "", // Reset text on new stream
        toolCalls: undefined,
      }));

      try {
        const result = await streamText({
          model: chatProvider.current(chatState.modelId),
          prompt,
          system,
          temperature: temperature ?? chatState.temperature,
          maxTokens: maxTokens ?? chatState.maxTokens,
          abortSignal: signal,
          tools: tools,
          experimental_repairToolCall: async (options) => {
            console.warn("[LLMContext] Attempting tool call repair:", {
              toolCall: options.toolCall,
              error: options.error,
            });
            // Basic repair attempt: return the original tool call data.
            // More sophisticated repair (e.g., JSON fixing) could be added here.
            return options.toolCall; // Return directly, implicitly wrapped in Promise
          },
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              accumulatedText += part.textDelta;
              // Update state incrementally for streaming effect
              setChatState((prev) => ({ ...prev, text: accumulatedText }));
              break;
            case "tool-call":
              capturedToolCalls.push({
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                args: part.args,
              });
              break;
            case "error":
              console.error("Streaming error:", part.error);
              throw part.error; // Propagate error to catch block
            case "finish":
              console.log("Stream finished:", part.finishReason);
              break;
          }
        }

        const finalToolCalls =
          capturedToolCalls.length > 0 ? capturedToolCalls : undefined;

        setChatState((prev) => ({
          ...prev,
          isError: false,
          text: accumulatedText,
          error: null,
          toolCalls: finalToolCalls,
          isStreaming: false,
        }));

        return { text: accumulatedText, toolCalls: finalToolCalls };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          setChatState((prev) => ({ ...prev, isStreaming: false }));
          return { text: accumulatedText, toolCalls: undefined }; // Return accumulated text up to abort
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        setChatState((prev) => ({
          ...prev,
          isError: true,
          text: accumulatedText, // Keep accumulated text on error
          error: errorMsg,
          isStreaming: false,
        }));
        // Decide if you want to return partial results on error
        return { text: accumulatedText, toolCalls: undefined };
      }
    },
    [
      chatProvider,
      chatState.modelId,
      chatState.temperature,
      chatState.maxTokens,
    ],
  );

  // --- Setters for Options ---
  const setAutocompleteLlmOptions = useCallback(
    (options: Partial<LLMBaseState>) => {
      // Check if provider needs to change
      if (
        session &&
        options.provider &&
        options.provider !== autocompleteState.provider
      ) {
        autocompleteProvider.current = createProviderInstanceInternal(
          options.provider,
        );
      }
      setAutocompleteState((prev) => ({
        ...prev,
        ...options,
        isError: false,
        error: null,
      })); // Reset error state on option change
    },
    [session, autocompleteState.provider, createProviderInstanceInternal],
  );

  const setChatLlmOptions = useCallback(
    (options: Partial<LLMBaseState>) => {
      // Check if provider needs to change
      if (
        session &&
        options.provider &&
        options.provider !== chatState.provider
      ) {
        chatProvider.current = createProviderInstanceInternal(options.provider);
      }
      setChatState((prev) => ({
        ...prev,
        ...options,
        isError: false,
        error: null,
      })); // Reset error state on option change
    },
    [session, chatState.provider, createProviderInstanceInternal],
  );

  return (
    <LLMContext.Provider
      value={{
        generateAutocomplete,
        autocompleteState,
        setAutocompleteLlmOptions,
        generateChatStream,
        chatState,
        setChatLlmOptions,
        availableModels: LlmModelList,
        getProviderInstance,
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

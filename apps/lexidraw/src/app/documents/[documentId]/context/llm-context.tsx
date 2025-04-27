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
import { api } from "~/trpc/react";
import type {
  LlmBaseConfigSchema,
  StoredLlmConfig,
  PartialLlmConfig,
} from "~/server/api/routers/config";
import { type z } from "zod";

export type LlmMode = "autocomplete" | "chat";

export type AppToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type LLMBaseState = z.infer<typeof LlmBaseConfigSchema>;

export type ChatLLMState = LLMBaseState & {
  isError: boolean;
  text: string;
  error: string | null;
  toolCalls?: AppToolCall[];
  isStreaming: boolean;
};

export type AutocompleteLLMState = LLMBaseState & {
  isError: boolean;
  text: string;
  error: string | null;
  isLoading: boolean;
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

type LLMContextValue = {
  generateAutocomplete: (options: LLMOptions) => Promise<string>;
  autocompleteState: AutocompleteLLMState;
  setAutocompleteLlmOptions: (options: Partial<LLMBaseState>) => void;
  generateChatStream: (
    options: LLMOptions & {
      experimental_repairToolCall?: ToolCallRepairFunction<ToolSet>;
    },
  ) => Promise<GenerateChatResult>;
  chatState: ChatLLMState;
  setChatLlmOptions: (options: Partial<LLMBaseState>) => void;
  availableModels: typeof LlmModelList;
  getProviderInstance: (
    providerName: string,
  ) =>
    | ReturnType<typeof createGoogleGenerativeAI>
    | ReturnType<typeof createOpenAI>
    | null;
};

const LLMContext = createContext<LLMContextValue | null>(null);

type LLMProviderProps = PropsWithChildren<{
  initialConfig: StoredLlmConfig;
}>;

export function LLMProvider({ children, initialConfig }: LLMProviderProps) {
  const updateLlmConfigMutation = api.config.updateLlmConfig.useMutation({
    onSuccess: async (updatedConfig) => {
      console.log(
        "[LLMContext] Config updated successfully (mutation):",
        updatedConfig,
      );
      setAutocompleteState((prev) => ({
        ...prev,
        ...(updatedConfig.autocomplete ?? initialConfig.autocomplete),
      }));
      setChatState((prev) => ({
        ...prev,
        ...(updatedConfig.chat ?? initialConfig.chat),
      }));
    },
    onError: (error) => {
      console.error("Failed to update LLM config:", error);
    },
  });

  const [autocompleteState, setAutocompleteState] =
    useState<AutocompleteLLMState>({
      ...initialConfig.autocomplete,
      isError: false,
      text: "",
      error: null,
      isLoading: false,
    });

  const [chatState, setChatState] = useState<ChatLLMState>({
    ...initialConfig.chat,
    isError: false,
    text: "",
    error: null,
    isStreaming: false,
    toolCalls: undefined,
  });

  useEffect(() => {
    if (initialConfig) {
      if (initialConfig.autocomplete) {
        setAutocompleteState((prev) => ({
          ...prev,
          ...initialConfig.autocomplete,
        }));
      }
      if (initialConfig.chat) {
        setChatState((prev) => ({
          ...prev,
          ...initialConfig.chat,
        }));
      }
    }
  }, [initialConfig]);

  const providerInstances = useRef<
    Record<
      string,
      ReturnType<typeof createGoogleGenerativeAI | typeof createOpenAI>
    >
  >({});

  const createProviderInstanceInternal = useCallback(
    (providerName: string) => {
      if (!initialConfig) {
        console.error("[LLMContext] Config not loaded for API key access.");
        return null;
      }
      const googleApiKey = initialConfig.googleApiKey;
      const openaiApiKey = initialConfig.openaiApiKey;

      if (providerInstances.current[providerName]) {
        return providerInstances.current[providerName];
      }

      let instance: ReturnType<
        typeof createGoogleGenerativeAI | typeof createOpenAI
      > | null = null;
      switch (providerName) {
        case "google":
          if (!googleApiKey) {
            console.warn("[LLMContext] Google API key not configured.");
            return null;
          }
          instance = createGoogleGenerativeAI({ apiKey: googleApiKey });
          break;
        case "openai":
          if (!openaiApiKey) {
            console.warn("[LLMContext] OpenAI API key not configured.");
            return null;
          }
          instance = createOpenAI({ apiKey: openaiApiKey });
          break;
        default:
          console.warn("Unsupported LLM provider:", providerName);
          return null;
      }

      if (instance) {
        providerInstances.current[providerName] = instance;
      }
      return instance;
    },
    [initialConfig],
  );

  const getProviderInstance = useCallback(
    (providerName: string) => {
      return createProviderInstanceInternal(providerName);
    },
    [createProviderInstanceInternal],
  );

  const autocompleteProvider =
    useRef<ReturnType<typeof createProviderInstanceInternal>>(null);
  const chatProvider =
    useRef<ReturnType<typeof createProviderInstanceInternal>>(null);

  useEffect(() => {
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
      if (!autocompleteState.enabled || !autocompleteProvider.current) {
        console.warn("[LLMContext] Autocomplete provider not loaded.");
        return "";
      }
      if (signal?.aborted) return "";
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
    [autocompleteProvider, autocompleteState],
  );

  const generateChatStream = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
      signal,
      tools,
      experimental_repairToolCall,
      maxSteps,
    }: Omit<LLMOptions, "experimental_repairToolCall"> & {
      experimental_repairToolCall?: ToolCallRepairFunction<ToolSet>;
      maxSteps?: number;
    }): Promise<GenerateChatResult> => {
      if (!chatState.enabled || !chatProvider.current) {
        console.warn("[LLMContext] Chat provider not loaded.");
        return { text: "", toolCalls: undefined };
      }

      let accumulatedText = "";
      const capturedToolCalls: AppToolCall[] = [];
      setChatState((prev) => ({
        ...prev,
        isStreaming: true,
        isError: false,
        error: null,
        text: "",
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
          maxSteps: maxSteps ?? 5,
          tools: tools,
          experimental_repairToolCall: experimental_repairToolCall,
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              accumulatedText += part.textDelta;
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
              throw part.error;
            case "finish":
              console.log(
                "Stream finished:",
                part.finishReason,
                "Usage:",
                part.usage,
              );
              break;
          }
        }

        const finalToolCalls =
          capturedToolCalls.length > 0 ? capturedToolCalls : undefined;

        const finalText = accumulatedText.trim();

        setChatState((prev) => ({
          ...prev,
          isError: false,
          text: finalText,
          error: null,
          toolCalls: finalToolCalls,
          isStreaming: false,
        }));

        return { text: finalText, toolCalls: finalToolCalls };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          setChatState((prev) => ({
            ...prev,
            text: accumulatedText,
            isStreaming: false,
          }));
          return { text: accumulatedText, toolCalls: undefined };
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        setChatState((prev) => ({
          ...prev,
          isError: true,
          text: accumulatedText,
          error: errorMsg,
          isStreaming: false,
        }));
        return { text: accumulatedText, toolCalls: undefined };
      }
    },
    [chatProvider, chatState],
  );

  const saveConfiguration = useCallback(
    (updatedConfig: {
      chatConfig?: Partial<LLMBaseState>;
      autocompleteConfig?: Partial<LLMBaseState>;
    }) => {
      const payload: PartialLlmConfig = {};

      if (updatedConfig.chatConfig) {
        payload.chat = {
          ...chatState,
          ...updatedConfig.chatConfig,
        };
      }

      if (updatedConfig.autocompleteConfig) {
        payload.autocomplete = {
          ...autocompleteState,
          ...updatedConfig.autocompleteConfig,
        };
      }

      if (Object.keys(payload).length > 0) {
        console.log("[LLMContext] Saving LLM configuration update:", payload);
        updateLlmConfigMutation.mutate(payload);
      }
    },
    [updateLlmConfigMutation, chatState, autocompleteState],
  );

  const setAutocompleteLlmOptions = useCallback(
    (options: Partial<LLMBaseState>) => {
      if (options.provider && options.provider !== autocompleteState.provider) {
        autocompleteProvider.current = createProviderInstanceInternal(
          options.provider,
        );
      }

      setAutocompleteState((prev) => ({
        ...prev,
        ...options,
        isError: false,
        error: null,
      }));

      saveConfiguration({ autocompleteConfig: options });
    },
    [
      autocompleteState.provider,
      createProviderInstanceInternal,
      saveConfiguration,
    ],
  );

  const setChatLlmOptions = useCallback(
    (options: Partial<LLMBaseState>) => {
      if (options.provider && options.provider !== chatState.provider) {
        chatProvider.current = createProviderInstanceInternal(options.provider);
      }

      setChatState((prev) => ({
        ...prev,
        ...options,
        isError: false,
        error: null,
      }));

      saveConfiguration({ chatConfig: options });
    },
    [chatState.provider, createProviderInstanceInternal, saveConfiguration],
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

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
  LanguageModel,
  StepResult,
  tool,
  ToolCallRepairFunction,
  ToolChoice,
  ToolSet,
  streamText,
  type TextStreamPart,
  type FinishReason,
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

export type RuntimeToolMap = Record<string, ReturnType<typeof tool>>;

export type LlmMode = "autocomplete" | "chat";

export type AppToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type AppToolResult = Record<string, unknown>;

export type StreamTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type StreamCallbacks = {
  onTextUpdate?: (text: string) => void;
  onFinish?: (result: GenerateChatStreamResult) => void;
  onError?: (error: Error) => void;
};

export type FinalStreamResult = {
  finishReason: FinishReason;
  usage: StreamTokenUsage;
  text: string;
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
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  tools?: RuntimeToolMap;
  maxSteps?: number;
  toolChoice?: ToolChoice<ToolSet>;
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
    modelId: "gemini-2.5-flash-preview-04-17",
    provider: "google",
    name: "Gemini 2.5 Flash Preview",
    description:
      "Next generation features, speed, thinking, realtime streaming, and multimodal generation",
  },
  {
    modelId: "gemini-2.5-pro-exp-03-25",
    provider: "google",
    name: "Gemini 2.5 Pro Exp",
    description: "Free but powerful Gemini 2.5 model",
  },
  {
    modelId: "gemini-2.5-pro-preview-03-25",
    provider: "google",
    name: "Gemini 2.5 Pro Preview",
    description: "The most powerful Gemini 2.5 model",
  },
] as const;

type LLMContextValue = {
  llmConfig: LLMConfig;
  setLlmConfiguration: (
    config: Partial<{
      chat: Partial<LLMBaseState>;
      autocomplete: Partial<LLMBaseState>;
    }>,
  ) => void;
  generateAutocomplete: (options: LLMOptions) => Promise<string>;
  autocompleteState: AutocompleteLLMState;
  setAutocompleteLlmOptions: (options: Partial<LLMBaseState>) => void;
  generateChatResponse: (
    options: LLMOptions & {
      repairToolCall?: ToolCallRepairFunction<ToolSet>;
      toolChoice?: ToolChoice<ToolSet>;
      prepareStep?: (options: {
        steps: StepResult<ToolSet>[];
        stepNumber: number;
        maxSteps: number;
        model: LanguageModel;
      }) => Promise<{
        model?: LanguageModel;
        toolChoice?: ToolChoice<ToolSet>;
      }>;
    },
  ) => Promise<GenerateChatResponseResult>;
  generateChatStream: (
    options: Omit<LLMOptions, "tools" | "toolChoice"> & {
      callbacks: StreamCallbacks;
    },
  ) => Promise<void>;
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

  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    chat: initialConfig.chat,
    autocomplete: initialConfig.autocomplete,
  });

  const setLlmConfiguration = useCallback(
    (
      config: Partial<{
        chat: Partial<LLMBaseState>;
        autocomplete: Partial<LLMBaseState>;
      }>,
    ) => {
      setLlmConfig((prev) => ({
        ...prev,
        ...config,
        chat: { ...prev.chat, ...config.chat },
        autocomplete: { ...prev.autocomplete, ...config.autocomplete },
      }));
    },
    [setLlmConfig],
  );

  const [autocompleteState, setAutocompleteState] =
    useState<AutocompleteLLMState>({
      isError: false,
      text: "",
      error: null,
      isLoading: false,
    } satisfies AutocompleteLLMState);

  const [chatState, setChatState] = useState<ChatLLMState>({
    isError: false,
    text: "",
    error: null,
    isStreaming: false,
    toolCalls: [],
    toolResults: [],
  } satisfies ChatLLMState);

  const providerInstances = useRef<
    Record<
      string,
      ReturnType<typeof createGoogleGenerativeAI | typeof createOpenAI>
    >
  >({});

  const createProviderInstanceInternal = useCallback(
    (providerName: string) => {
      console.log("[LLMContext] Creating provider instance for:", providerName);
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
      llmConfig.autocomplete.provider,
    );
    if (createdAutocompleteProvider) {
      autocompleteProvider.current = createdAutocompleteProvider;
    }
    const createdChatProvider = createProviderInstanceInternal(
      llmConfig.chat.provider,
    );
    if (createdChatProvider) {
      chatProvider.current = createdChatProvider;
    }
  }, [
    createProviderInstanceInternal,
    llmConfig.autocomplete.provider,
    llmConfig.chat.provider,
  ]);

  const generateAutocomplete = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
      signal,
    }: LLMOptions): Promise<string> => {
      if (!llmConfig.autocomplete.enabled || !autocompleteProvider.current) {
        console.warn("[LLMContext] Autocomplete provider not loaded.");
        return "";
      }
      if (signal?.aborted) {
        console.log("[LLMContext generateAutocomplete] signal aborted");
        return "";
      }
      setAutocompleteState((prev) => {
        return {
          ...prev,
          isLoading: true,
          isError: false,
          error: null,
        };
      });
      try {
        const result = await generateText({
          model: autocompleteProvider.current(llmConfig.autocomplete.modelId),
          prompt,
          system,
          temperature: temperature ?? llmConfig.autocomplete.temperature,
          maxTokens: maxTokens ?? llmConfig.autocomplete.maxTokens,
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
        // To exit autocomplete
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
    [
      llmConfig.autocomplete.enabled,
      llmConfig.autocomplete.maxTokens,
      llmConfig.autocomplete.modelId,
      llmConfig.autocomplete.temperature,
    ],
  );

  const generateChatResponse = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
      signal,
      tools,
      prepareStep,
      repairToolCall,
      toolChoice,
      maxSteps,
    }: LLMOptions & {
      repairToolCall?: ToolCallRepairFunction<ToolSet>;
      prepareStep?: (options: {
        steps: StepResult<ToolSet>[];
        stepNumber: number;
        maxSteps: number;
        model: LanguageModel;
      }) => Promise<{
        model?: LanguageModel;
        toolChoice?: ToolChoice<ToolSet>;
      }>;
    }): Promise<GenerateChatResponseResult> => {
      if (!llmConfig.chat.enabled || !chatProvider.current) {
        console.warn("[LLMContext] Chat provider not loaded.");
        return { text: "", toolCalls: undefined, toolResults: undefined };
      }

      setChatState((prev) => ({
        ...prev,
        isStreaming: true,
        isError: false,
        error: null,
        text: "",
        toolCalls: undefined,
      }));

      try {
        const result = await generateText({
          experimental_prepareStep: prepareStep,
          experimental_repairToolCall: repairToolCall,
          model: chatProvider.current(llmConfig.chat.modelId),
          prompt,
          system,
          temperature: temperature ?? llmConfig.chat.temperature,
          maxTokens: maxTokens ?? llmConfig.chat.maxTokens,
          abortSignal: signal,
          tools: tools,
          maxSteps: maxSteps,
          toolChoice: toolChoice,
        });

        setChatState((prev) => ({
          ...prev,
          isError: false,
          text: result.text,
          error: null,
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
          isStreaming: false,
        }));

        return {
          text: result.text,
          toolCalls: result.toolCalls,
          toolResults: result.toolResults,
        };
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          ["AbortError", "ExitError"].includes(err.name)
        ) {
          setChatState((prev) => ({
            ...prev,
            text: "",
            isStreaming: false,
          }));
          return { text: "", toolCalls: undefined, toolResults: undefined };
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        setChatState((prev) => ({
          ...prev,
          isError: true,
          error: errorMsg,
          isStreaming: false,
        }));
        return { text: "", toolCalls: undefined, toolResults: undefined };
      }
    },
    [chatProvider, llmConfig.chat],
  );

  const generateChatStream = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
      signal,
      maxSteps,
      callbacks,
    }: Omit<LLMOptions, "tools" | "toolChoice"> & {
      callbacks: StreamCallbacks;
    }): Promise<void> => {
      if (!llmConfig.chat.enabled || !chatProvider.current) {
        console.warn("[LLMContext] Chat provider not loaded.");
        callbacks.onError?.(new Error("Chat provider not loaded."));
        return;
      }

      setChatState((prev) => ({
        ...prev,
        isStreaming: true,
        isError: false,
        error: null,
        text: "",
        toolCalls: undefined,
      }));

      let accumulatedText = "";
      let finalResultData: FinalStreamResult | null = null;
      let finalGenerateStreamResult: GenerateChatStreamResult | null = null;

      try {
        const result = await streamText({
          model: chatProvider.current(llmConfig.chat.modelId),
          prompt,
          system,
          temperature: temperature ?? llmConfig.chat.temperature,
          maxTokens: maxTokens ?? llmConfig.chat.maxTokens,
          abortSignal: signal,
          maxSteps: maxSteps,
        });

        for await (const delta of result.fullStream) {
          switch (delta.type) {
            case "text-delta": {
              accumulatedText += delta.textDelta;
              callbacks.onTextUpdate?.(accumulatedText);
              break;
            }
            case "finish": {
              const finishDelta = delta as Extract<
                TextStreamPart<ToolSet>,
                { type: "finish" }
              >;
              finalResultData = {
                finishReason: finishDelta.finishReason,
                usage: finishDelta.usage,
                text: accumulatedText,
              };
              break;
            }
            case "error": {
              const errorDelta = delta as Extract<
                TextStreamPart<ToolSet>,
                { type: "error" }
              >;
              throw errorDelta.error;
            }
            // Explicitly ignore tool calls/results in basic text streaming
            case "tool-call":
              console.warn(
                `[LLMContext] Unexpected delta type 'tool-call' received during generateChatStream. Ignoring.`,
              );
              break;
          }
        }

        const awaitedText = await result.text;

        if (finalResultData) {
          finalResultData.text = awaitedText ?? finalResultData.text;
        } else {
          const finalReason = await result.finishReason;
          const finalUsage = await result.usage;
          if (finalReason !== "error") {
            finalResultData = {
              finishReason: finalReason,
              usage: finalUsage,
              text: awaitedText,
            };
          }
        }

        if (finalResultData) {
          finalGenerateStreamResult = {
            text: finalResultData.text,
          };
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          console.log("[LLMContext] Stream aborted.");
        } else {
          const error = err instanceof Error ? err : new Error(String(err));
          console.error("[LLMContext] Error during chat stream:", error);
          setChatState((prev) => ({
            ...prev,
            isError: true,
            error: error.message,
          }));
          callbacks.onError?.(error);
        }
      } finally {
        setChatState((prev) => ({
          ...prev,
          isStreaming: false,
          text: finalGenerateStreamResult?.text ?? accumulatedText,
          toolCalls: undefined,
          toolResults: undefined,
        }));
        if (finalGenerateStreamResult) {
          callbacks.onFinish?.(finalGenerateStreamResult);
        }
      }
    },
    [chatProvider, llmConfig.chat],
  );

  const saveConfiguration = useCallback(
    (updatedConfig: {
      chatConfig?: Partial<LLMBaseState>;
      autocompleteConfig?: Partial<LLMBaseState>;
    }) => {
      const payload: PartialLlmConfig = {};

      if (updatedConfig.chatConfig) {
        payload.chat = {
          enabled: llmConfig.chat.enabled,
          modelId: llmConfig.chat.modelId,
          provider: llmConfig.chat.provider,
          temperature: llmConfig.chat.temperature,
          maxTokens: llmConfig.chat.maxTokens,
        };
      }

      if (updatedConfig.autocompleteConfig) {
        payload.autocomplete = {
          enabled: llmConfig.autocomplete.enabled,
          modelId: llmConfig.autocomplete.modelId,
          provider: llmConfig.autocomplete.provider,
          temperature: llmConfig.autocomplete.temperature,
          maxTokens: llmConfig.autocomplete.maxTokens,
        };
      }

      if (Object.keys(payload).length > 0) {
        console.log("[LLMContext] Saving LLM configuration update:", payload);
        updateLlmConfigMutation.mutate(payload);
      }
    },
    [updateLlmConfigMutation, llmConfig],
  );

  const setAutocompleteLlmOptions = useCallback(
    (options: Partial<LLMBaseState>) => {
      if (
        options.provider &&
        options.provider !== llmConfig.autocomplete.provider
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
      }));

      saveConfiguration({ autocompleteConfig: options });
    },
    [
      llmConfig.autocomplete.provider,
      createProviderInstanceInternal,
      saveConfiguration,
    ],
  );

  const setChatLlmOptions = useCallback(
    (options: Partial<LLMBaseState>) => {
      if (options.provider && options.provider !== llmConfig.chat.provider) {
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
    [
      llmConfig.chat.provider,
      createProviderInstanceInternal,
      saveConfiguration,
    ],
  );

  return (
    <LLMContext.Provider
      value={{
        llmConfig,
        setLlmConfiguration,
        generateAutocomplete,
        autocompleteState,
        setAutocompleteLlmOptions,
        generateChatResponse,
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

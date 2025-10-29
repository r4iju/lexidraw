"use client";

import {
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
  type LanguageModel,
  type StepResult,
  type tool,
  type ToolCallRepairFunction,
  type ToolChoice,
  // Note: avoid ToolSet in generics to match RuntimeToolMap usage
  streamText,
  type TextStreamPart,
  type FinishReason,
  type FilePart,
  type TextPart,
  type ModelMessage,
  type LanguageModelUsage,
  stepCountIs,
} from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { api } from "~/trpc/react";
import type {
  LlmBaseConfigSchema,
  StoredLlmConfig,
  PartialLlmConfig,
} from "~/server/api/routers/config";
import type { z } from "zod";
import { useDebounce } from "~/lib/client-utils";

export type RuntimeToolMap = Record<string, ReturnType<typeof tool>>;

export type LlmMode = "autocomplete" | "chat" | "agent";

export type AppToolCall = {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
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
  usage: LanguageModelUsage;
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
  maxOutputTokens?: number;
  signal?: AbortSignal;
  tools?: RuntimeToolMap;
  maxSteps?: number;
  toolChoice?: ToolChoice<RuntimeToolMap>;
  files?: File[] | FileList | null;
};

const LlmModelList = [
  // OpenAI - GA
  {
    modelId: "gpt-5",
    provider: "openai",
    name: "GPT-5",
    description: "OpenAI flagship multimodal model (GA)",
  },
  {
    modelId: "gpt-5-mini",
    provider: "openai",
    name: "GPT-5 Mini",
    description: "Smaller, faster GPT-5 tier (GA)",
  },
  {
    modelId: "gpt-5-nano",
    provider: "openai",
    name: "GPT-5 Nano",
    description: "Lowest-latency GPT-5 tier (GA)",
  },

  // Google Gemini - GA
  {
    modelId: "gemini-2.5-pro",
    provider: "google",
    name: "Gemini 2.5 Pro",
    description: "Most capable Gemini 2.5 model (GA)",
  },
  {
    modelId: "gemini-2.5-flash",
    provider: "google",
    name: "Gemini 2.5 Flash",
    description: "Fast, cost-efficient Gemini 2.5 (GA)",
  },
  {
    modelId: "gemini-2.5-flash-lite",
    provider: "google",
    name: "Gemini 2.5 Flash Lite",
    description: "Lowest-cost Gemini 2.5 (GA)",
  },
  {
    modelId: "gemini-2.0-flash",
    provider: "google",
    name: "Gemini 2.0 Flash",
    description: "Gemini 2.0 Flash (GA)",
  },
] as const;

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
  generateAutocomplete: (options: LLMOptions) => Promise<string>;
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
      setLlmConfig((prev) => ({
        chat: updatedConfig.chat
          ? { ...prev.chat, ...updatedConfig.chat }
          : prev.chat,
        autocomplete: updatedConfig.autocomplete
          ? { ...prev.autocomplete, ...updatedConfig.autocomplete }
          : prev.autocomplete,
        agent: updatedConfig.agent
          ? { ...prev.agent, ...updatedConfig.agent }
          : prev.agent,
      }));
    },
    onError: (error) => {
      console.error("Failed to update LLM config:", error);
    },
  });

  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    chat: initialConfig.chat,
    autocomplete: initialConfig.autocomplete,
    agent:
      (initialConfig as Partial<StoredLlmConfig>).agent ?? initialConfig.chat,
  });

  const saveConfiguration = useCallback(
    (updatedConfig: {
      chatConfig?: Partial<LLMBaseState>;
      autocompleteConfig?: Partial<LLMBaseState>;
      agentConfig?: Partial<LLMBaseState>;
    }) => {
      const payload: PartialLlmConfig = {};

      if (updatedConfig.chatConfig) {
        payload.chat = {
          modelId: llmConfig.chat.modelId,
          provider: llmConfig.chat.provider,
          temperature: llmConfig.chat.temperature,
          maxOutputTokens: llmConfig.chat.maxOutputTokens,
        };
      }

      if (updatedConfig.autocompleteConfig) {
        payload.autocomplete = {
          modelId: llmConfig.autocomplete.modelId,
          provider: llmConfig.autocomplete.provider,
          temperature: llmConfig.autocomplete.temperature,
          maxOutputTokens: llmConfig.autocomplete.maxOutputTokens,
        };
      }

      if (updatedConfig.agentConfig) {
        payload.agent = {
          modelId: llmConfig.agent.modelId,
          provider: llmConfig.agent.provider,
          temperature: llmConfig.agent.temperature,
          maxOutputTokens: llmConfig.agent.maxOutputTokens,
        } as Partial<LLMBaseState>;
      }

      if (Object.keys(payload).length > 0) {
        console.log("[LLMContext] Saving LLM configuration update:", payload);
        updateLlmConfigMutation.mutate(payload);
      }
    },
    [updateLlmConfigMutation, llmConfig],
  );

  const debouncedSaveConfiguration = useDebounce(
    ((updatedConfig: {
      chatConfig?: Partial<LLMBaseState>;
      autocompleteConfig?: Partial<LLMBaseState>;
    }) => saveConfiguration(updatedConfig)) as (...args: unknown[]) => void,
    2000,
  );

  const updateLlmConfig = useCallback(
    (
      config: Partial<{
        chat: Partial<LLMBaseState>;
        autocomplete: Partial<LLMBaseState>;
        agent: Partial<LLMBaseState>;
      }>,
      _options?: { mode?: "chat" | "autocomplete" | "agent" },
    ) => {
      setLlmConfig((prev) => {
        // Start with the previous state
        const nextState = { ...prev };

        // Apply chat updates if provided
        if (config.chat) {
          nextState.chat = { ...prev.chat, ...config.chat };
        }

        // Apply autocomplete updates if provided
        if (config.autocomplete) {
          nextState.autocomplete = {
            ...prev.autocomplete,
            ...config.autocomplete,
          };
        }

        // Apply agent updates if provided
        if (config.agent) {
          nextState.agent = {
            ...prev.agent,
            ...config.agent,
          };
        }

        // Token caps now enforced on the server; no client-side capping

        return nextState;
      });

      debouncedSaveConfiguration.run({
        chatConfig: config.chat,
        autocompleteConfig: config.autocomplete,
        agentConfig: config.agent,
      });
    },
    [debouncedSaveConfiguration],
  );

  const [autocompleteState] = useState<AutocompleteLLMState>({
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
  const agentProvider =
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
    const createdAgentProvider = createProviderInstanceInternal(
      llmConfig.agent.provider,
    );
    if (createdAgentProvider) {
      agentProvider.current = createdAgentProvider;
    }
  }, [
    createProviderInstanceInternal,
    llmConfig.autocomplete.provider,
    llmConfig.chat.provider,
    llmConfig.agent.provider,
  ]);

  const generateAutocomplete = useCallback(
    async ({ signal }: LLMOptions): Promise<string> => {
      console.warn(
        "[LLMContext] generateAutocomplete is deprecated. Use useAutocompleteEngine().",
      );
      if (signal?.aborted) return "";
      return "";
    },
    [],
  );

  const toFileParts = useCallback(
    async (files?: File[] | FileList | null): Promise<FilePart[]> => {
      if (!files || files.length === 0) {
        return [];
      }
      const filePartsArray: FilePart[] = [];
      for (const file of Array.from(files)) {
        const buffer = await file.arrayBuffer(); // Read file content as ArrayBuffer
        filePartsArray.push({
          type: "file" as const,
          data: new Uint8Array(buffer), // Convert ArrayBuffer to Uint8Array
          mediaType: file.type || "application/octet-stream",
          filename: file.name,
        });
      }
      return filePartsArray;
    },
    [],
  );

  const buildPrompt = useCallback(
    async (
      { prompt }: { prompt: string },
      files?: File[] | FileList | null,
    ): Promise<{ messages: ModelMessage[] } | { prompt: string }> => {
      if (files?.length) {
        const fileParts = await toFileParts(files);
        const parts: (TextPart | FilePart)[] = [
          { type: "text", text: prompt },
          ...fileParts,
        ];

        const messages: ModelMessage[] = [{ role: "user", content: parts }];
        return { messages };
      }
      return { prompt };
    },
    [toFileParts],
  );

  const generateChatResponse = useCallback(
    async ({
      prompt = "",
      messages,
      system = "",
      temperature,
      maxOutputTokens,
      signal,
      tools,
      prepareStep,
      repairToolCall,
      toolChoice,
      maxSteps,
      files,
      mode,
    }: LLMOptions & {
      mode?: "chat" | "agent";
      files?: File[] | FileList | null;
      repairToolCall?: ToolCallRepairFunction<RuntimeToolMap>;
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
    }): Promise<GenerateChatResponseResult> => {
      const useAgent = mode === "agent";
      const activeProvider = useAgent
        ? agentProvider.current
        : chatProvider.current;
      const activeConfig = useAgent ? llmConfig.agent : llmConfig.chat;

      if (!activeProvider) {
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
        let inputConfig: { prompt?: string; messages?: ModelMessage[] };

        if (messages?.length) {
          inputConfig = { messages };
        } else {
          // falls back to old behaviour (prompt + optional files)
          inputConfig = await buildPrompt({ prompt }, files);
        }

        const result = await generateText({
          prepareStep: prepareStep,
          experimental_repairToolCall: repairToolCall,
          model: activeProvider(
            activeConfig.modelId,
          ) as unknown as LanguageModel,
          ...(inputConfig.messages
            ? { messages: inputConfig.messages }
            : { prompt: inputConfig.prompt ?? "" }),
          system,
          temperature: temperature ?? activeConfig.temperature,
          maxOutputTokens: maxOutputTokens ?? activeConfig.maxOutputTokens,
          abortSignal: signal,
          tools: tools,
          stopWhen: stepCountIs(maxSteps ?? 0),
          toolChoice: toolChoice,
        });

        setChatState((prev) => ({
          ...prev,
          isError: false,
          text: result.text,
          error: null,
          toolCalls: (result.toolCalls ?? []).map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: (c as unknown as { input: Record<string, unknown> }).input,
          })),
          toolResults: (result.toolResults ?? []).map(
            (r) => r as unknown as AppToolResult,
          ),
          isStreaming: false,
        }));

        return {
          text: result.text,
          toolCalls: (result.toolCalls ?? []).map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: (c as unknown as { input: Record<string, unknown> }).input,
          })),
          toolResults: (result.toolResults ?? []).map(
            (r) => r as unknown as AppToolResult,
          ),
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
    [buildPrompt, llmConfig.chat, llmConfig.agent],
  );

  const generateChatStream = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxOutputTokens,
      signal,
      maxSteps,
      callbacks,
      files,
    }: Omit<LLMOptions, "tools" | "toolChoice"> & {
      callbacks: StreamCallbacks;
      files?: File[] | FileList | null;
    }): Promise<void> => {
      if (!chatProvider.current) {
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
        const promptConfig = await buildPrompt({ prompt }, files);
        const result = streamText({
          model: chatProvider.current(
            llmConfig.chat.modelId,
          ) as unknown as LanguageModel,

          ...promptConfig,
          system,
          temperature: temperature ?? llmConfig.chat.temperature,
          maxOutputTokens: maxOutputTokens ?? llmConfig.chat.maxOutputTokens,
          abortSignal: signal,
          stopWhen: stepCountIs(maxSteps ?? 0),
        });

        for await (const delta of result.fullStream) {
          switch (delta.type) {
            case "text-delta": {
              accumulatedText += delta.text;
              callbacks.onTextUpdate?.(accumulatedText);
              break;
            }
            case "finish": {
              const finishDelta = delta as Extract<
                TextStreamPart<RuntimeToolMap>,
                { type: "finish" }
              >;
              finalResultData = {
                finishReason: finishDelta.finishReason,
                usage: finishDelta.totalUsage,
                text: accumulatedText,
              };
              break;
            }
            case "error": {
              const errorDelta = delta as Extract<
                TextStreamPart<RuntimeToolMap>,
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
    [
      buildPrompt,
      llmConfig.chat.maxOutputTokens,
      llmConfig.chat.modelId,
      llmConfig.chat.temperature,
    ],
  );

  return (
    <LLMContext.Provider
      value={{
        llmConfig,
        updateLlmConfig,
        generateAutocomplete,
        autocompleteState,
        generateChatResponse,
        generateChatStream,
        chatState,
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

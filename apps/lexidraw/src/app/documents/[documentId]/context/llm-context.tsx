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

import type {
  LanguageModel,
  StepResult,
  tool,
  ToolCallRepairFunction,
  ToolChoice,
  ModelMessage,
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

  // Legacy file-based prompt builder has moved server-side (SSE endpoint handles files)

  const generateChatResponse = useCallback(
    async ({
      prompt = "",
      messages,
      system = "",
      temperature,
      maxOutputTokens,
      signal,
      tools,
      prepareStep: _prepareStep,
      repairToolCall: _repairToolCall,
      toolChoice: _toolChoice,
      maxSteps: _maxSteps,
      files: _files,
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
      const activeConfig = useAgent ? llmConfig.agent : llmConfig.chat;

      setChatState((prev) => ({
        ...prev,
        isStreaming: true,
        isError: false,
        error: null,
        text: "",
        toolCalls: undefined,
      }));

      try {
        // Chat without tools → call server JSON route
        if (!useAgent && !tools) {
          const resp = await fetch("/api/llm/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              messages,
              system,
              temperature: temperature ?? activeConfig.temperature,
              maxOutputTokens: maxOutputTokens ?? activeConfig.maxOutputTokens,
              mode: "chat",
            }),
            signal,
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "Generation error");
            throw new Error(errText || "Generation error");
          }
          const json = (await resp.json()) as { text?: string };
          const text = (json?.text ?? "").toString();
          setChatState((prev) => ({
            ...prev,
            isError: false,
            text,
            error: null,
            isStreaming: false,
          }));
          return { text };
        }

        // Agent or tools present → call server agent route
        const toolNames = Object.keys(tools ?? {});
        const resp = await fetch("/api/llm/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            messages,
            system,
            temperature: temperature ?? activeConfig.temperature,
            maxOutputTokens: maxOutputTokens ?? activeConfig.maxOutputTokens,
            tools: toolNames,
          }),
          signal,
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => "Agent error");
          throw new Error(errText || "Agent error");
        }
        const json = (await resp.json()) as {
          text?: string;
          toolCalls?: Array<{
            toolCallId: string;
            toolName: string;
            input?: Record<string, unknown>;
          }>;
        };
        const text = (json?.text ?? "").toString();

        setChatState((prev) => ({
          ...prev,
          isError: false,
          text,
          error: null,
          toolCalls: (json.toolCalls ?? []).map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input ?? {},
          })),
          isStreaming: false,
        }));

        return {
          text,
          toolCalls: (json.toolCalls ?? []).map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input ?? {},
          })),
          toolResults: undefined,
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
    [llmConfig.chat, llmConfig.agent],
  );

  const generateChatStream = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxOutputTokens,
      signal,
      maxSteps: _maxSteps, // ignored in server route for now
      callbacks,
      files,
    }: Omit<LLMOptions, "tools" | "toolChoice"> & {
      callbacks: StreamCallbacks;
      files?: File[] | FileList | null;
    }): Promise<void> => {
      setChatState((prev) => ({
        ...prev,
        isStreaming: true,
        isError: false,
        error: null,
        text: "",
        toolCalls: undefined,
      }));

      let accumulatedText = "";
      let finished = false;

      try {
        // Build request body
        const hasFiles = files && files.length > 0;
        let resp: Response;
        if (hasFiles) {
          const form = new FormData();
          form.set("prompt", prompt ?? "");
          form.set("system", system ?? "");
          form.set(
            "temperature",
            String(temperature ?? llmConfig.chat.temperature),
          );
          form.set(
            "maxOutputTokens",
            String(maxOutputTokens ?? llmConfig.chat.maxOutputTokens),
          );
          for (const f of Array.from(files as FileList | File[])) {
            form.append("files", f as File);
          }
          resp = await fetch("/api/llm/stream", {
            method: "POST",
            body: form,
            signal,
          });
        } else {
          resp = await fetch("/api/llm/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              system,
              temperature: temperature ?? llmConfig.chat.temperature,
              maxOutputTokens:
                maxOutputTokens ?? llmConfig.chat.maxOutputTokens,
            }),
            signal,
          });
        }

        if (!resp.ok || !resp.body) {
          const errText = await resp.text().catch(() => "Stream error");
          throw new Error(errText || "Stream error");
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split(/\r?\n/);
          for (const line of lines) {
            if (!line) continue;
            if (line.startsWith("data: ")) {
              const textDelta = line.slice(6);
              accumulatedText += textDelta;
              callbacks.onTextUpdate?.(accumulatedText);
            } else if (line.startsWith("event: finish")) {
              finished = true;
            }
          }
        }

        setChatState((prev) => ({
          ...prev,
          isError: false,
          text: accumulatedText,
          error: null,
          isStreaming: false,
        }));

        callbacks.onFinish?.({ text: accumulatedText });
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
          text: accumulatedText,
          toolCalls: undefined,
          toolResults: undefined,
        }));
        if (!finished) {
          callbacks.onFinish?.({ text: accumulatedText });
        }
      }
    },
    [llmConfig.chat.maxOutputTokens, llmConfig.chat.temperature],
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

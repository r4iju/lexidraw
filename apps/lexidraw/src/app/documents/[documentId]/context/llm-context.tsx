"use client";

import { createContext, useCallback, useState, useContext } from "react";
import type { PropsWithChildren } from "react";

import {
  generateText,
  type LanguageModel,
  type StepResult,
  type tool,
  type ToolCallRepairFunction,
  type ToolChoice,
  type ModelMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
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
        };
      }

      if (updatedConfig.autocompleteConfig) {
        payload.autocomplete = {
          modelId: llmConfig.autocomplete.modelId,
          provider: llmConfig.autocomplete.provider,
          temperature: llmConfig.autocomplete.temperature,
        };
      }

      if (updatedConfig.agentConfig) {
        payload.agent = {
          modelId: llmConfig.agent.modelId,
          provider: llmConfig.agent.provider,
          temperature: llmConfig.agent.temperature,
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

  // Removed client provider instances; server proxies are authoritative

  const generateChatResponse = useCallback(
    async ({
      prompt = "",
      messages,
      system = "",
      temperature,
      tools,
      prepareStep: _prepareStep,
      repairToolCall: _repairToolCall,
      toolChoice: _toolChoice,
      maxSteps,
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

      // Instantiate provider client-side with proxy baseURL
      let model: ReturnType<
        | ReturnType<typeof createOpenAI>
        | ReturnType<typeof createGoogleGenerativeAI>
      > | null = null;
      const provider = llmConfig.agent.provider;
      const modelId = llmConfig.agent.modelId;
      if (provider === "openai") {
        const openai = createOpenAI({
          baseURL: "/api/llm/proxy/openai",
          apiKey: "proxy",
        });
        model = openai(modelId);
      } else if (provider === "google") {
        const google = createGoogleGenerativeAI({
          baseURL: "/api/llm/proxy/google",
          apiKey: "proxy",
        });
        model = google(modelId);
      } else {
        throw new Error("Unsupported provider for client orchestration");
      }

      const baseMessages: ModelMessage[] = (messages ?? []).length
        ? (messages as ModelMessage[])
        : ([{ role: "user", content: prompt }] as ModelMessage[]);

      const genOptions = {
        model: model as unknown as LanguageModel,
        messages: baseMessages,
        system,
        temperature: temperature ?? activeConfig.temperature,
        tools: tools as unknown as RuntimeToolMap,
        toolChoice: "auto",
        maxSteps,
      } as unknown as Parameters<typeof generateText>[0];
      console.log("[agent] generateText (client) → sending", {
        toolCount: Object.keys(tools ?? {}).length,
        toolNames: Object.keys(tools ?? {}),
        maxSteps,
      });
      const result = await generateText(genOptions);
      console.log("[agent] generateText (client) ← result", {
        toolCallsCount: (result.toolCalls ?? []).length,
        toolCalls: (result.toolCalls ?? []).map((c) => ({
          id: c.toolCallId,
          name: c.toolName,
        })),
        textLength: (result?.text ?? "").length,
      });

      const text = (result?.text ?? "").toString();
      const toolCalls = (result.toolCalls ?? []).map((c) => {
        const rawInput = c.input;
        return {
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: rawInput ?? {},
        } as AppToolCall;
      });
      setChatState((prev) => ({
        ...prev,
        isError: false,
        text,
        error: null,
        isStreaming: false,
      }));
      return { text, toolCalls, toolResults: undefined };

      // Agent or tools present → call server agent route (fallback)
    },
    [llmConfig.chat, llmConfig.agent],
  );

  const generateChatStream = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      signal,
      callbacks,
      files,
    }: Omit<LLMOptions, "tools" | "toolChoice" | "maxSteps"> & {
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
    [llmConfig.chat.temperature],
  );

  return (
    <LLMContext.Provider
      value={{
        llmConfig,
        updateLlmConfig,
        autocompleteState,
        generateChatResponse,
        generateChatStream,
        chatState,
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

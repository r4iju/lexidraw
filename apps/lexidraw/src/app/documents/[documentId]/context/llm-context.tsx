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

import { streamText, tool, type Tool } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { throttle } from "@packages/lib";
import { useSession } from "next-auth/react";
import { z } from "zod";

export type AppToolCall = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type LLMState = {
  modelId: string;
  provider: string;
  temperature: number;
  maxTokens: number;
  isError: boolean;
  text: string;
  error: string | null;
};

export type LLMOptions = {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

// --- Custom Hook for Tool Definitions ---
function useLlmTools() {
  // Define tools inside the hook
  const tools = {
    editText: tool({
      description:
        "Edit the document based on user instructions. Provide the *entire* modified document state as a JSON string in the newStateJson argument.",
      parameters: z.object({
        newStateJson: z
          .string()
          .describe(
            "The complete, modified Lexical editor state as a valid JSON string.",
          ),
        instructions: z
          .string()
          .describe(
            "Specific instructions used for the edit (e.g., fix grammar, shorten, expand). Optional reference.",
          )
          .optional(),
      }),
    }),
  } satisfies Record<string, Tool>;
  return tools;
}
// ---------------------------------------

export type GenerateResult = {
  text: string;
  toolCalls?: AppToolCall[];
};

type LLMContextValue = {
  generate: (options: LLMOptions) => Promise<GenerateResult>;
  llmState: LLMState;
  setLlmState: React.Dispatch<React.SetStateAction<LLMState>>;
  setLlmOptions: (options: Partial<LLMState>) => void;
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

  const [llmState, setLlmState] = useState<LLMState>({
    modelId: "gemini-2.0-flash",
    provider: "google",
    temperature: 0.3,
    maxTokens: 10240,
    isError: false,
    text: "",
    error: null,
  });

  const provider = useRef<
    | ReturnType<typeof createGoogleGenerativeAI>
    | ReturnType<typeof createOpenAI>
  >(null);

  // Use the custom hook to get tools
  const llmTools = useLlmTools();

  const generate = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
      signal,
    }: LLMOptions): Promise<GenerateResult> => {
      let accumulatedText = "";
      const capturedToolCalls: AppToolCall[] = [];

      try {
        if (!provider.current) {
          throw new Error("Provider not initialized");
        }
        const result = await streamText({
          model: provider.current(llmState.modelId),
          prompt,
          system,
          temperature: temperature ?? llmState.temperature,
          maxTokens: maxTokens ?? llmState.maxTokens,
          abortSignal: signal,
          tools: llmTools, // Use tools from the hook
        });

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "text-delta":
              accumulatedText += part.textDelta;
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
              console.log("Stream finished:", part.finishReason);
              break;
          }
        }

        const finalToolCalls =
          capturedToolCalls.length > 0 ? capturedToolCalls : undefined;

        setLlmState((prev) => ({
          ...prev,
          isError: false,
          text: accumulatedText,
          error: null,
        }));

        return { text: accumulatedText, toolCalls: finalToolCalls };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return { text: "", toolCalls: undefined };
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        setLlmState((prev) => ({
          ...prev,
          isError: true,
          text: "",
          error: errorMsg,
        }));
        return { text: "", toolCalls: undefined };
      }
    },
    [
      provider,
      llmState.modelId,
      llmState.temperature,
      llmState.maxTokens,
      llmTools,
    ],
  );

  const setLlmOptions = (options: Partial<LLMState>) => {
    if (options.provider && options.provider !== llmState.provider) {
      switch (options.provider) {
        case "google":
          provider.current = createGoogleGenerativeAI({
            apiKey: session?.user.config.llm.googleApiKey,
          });
          break;
        case "openai":
          provider.current = createOpenAI({
            apiKey: session?.user.config.llm.openaiApiKey,
          });
          break;
      }
    }
    setLlmState((prev) => ({ ...prev, ...options }));
  };

  useEffect(() => {
    switch (llmState.provider) {
      case "google":
        provider.current = createGoogleGenerativeAI({
          apiKey: session?.user.config.llm.googleApiKey,
        });
        break;
      case "openai":
        provider.current = createOpenAI({
          apiKey: session?.user.config.llm.openaiApiKey,
        });
        break;
      default:
        console.error("Invalid provider:", llmState.provider);
    }
  }, [
    llmState.provider,
    session?.user.config.llm.googleApiKey,
    session?.user.config.llm.openaiApiKey,
  ]);

  return (
    <LLMContext.Provider
      value={{ generate, llmState, setLlmState, setLlmOptions }}
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

export function useThrottledLlm({ trottleMs = 3000 }: { trottleMs?: number }) {
  const { generate } = useLLM();

  const throttledSendQuery = throttle(generate, trottleMs, {
    leading: false,
    trailing: true,
  });

  return throttledSendQuery;
}

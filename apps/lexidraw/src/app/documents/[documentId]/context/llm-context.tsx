"use client";

import React, {
  createContext,
  useCallback,
  useState,
  useContext,
  type PropsWithChildren,
  useRef,
} from "react";

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { throttle } from "@packages/lib";
import { useSession } from "next-auth/react";

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

type LLMContextValue = {
  generate: (options: LLMOptions) => Promise<string>;
  llmState: LLMState;
  setLlmState: React.Dispatch<React.SetStateAction<LLMState>>;
  setLlmOptions: (options: Partial<LLMState>) => void;
};

export const LlmModelList = [
  {
    modelId: "gpt-4o",
    provider: "openai",
    name: "GPT-4o",
    description: "The latest and most powerful GPT model",
  },
  {
    modelId: "gpt-4o-mini",
    provider: "openai",
    name: "GPT-4o Mini",
    description: "The smaller and faster GPT model",
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
    maxTokens: 50,
    isError: false,
    text: "",
    error: null,
  });

  const provider = useRef<
    | ReturnType<typeof createGoogleGenerativeAI>
    | ReturnType<typeof createOpenAI>
  >(
    createGoogleGenerativeAI({
      apiKey: session?.user.config.llm.googleApiKey,
    }),
  );

  const generate = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
      signal,
    }: LLMOptions): Promise<string> => {
      try {
        const result = await generateText({
          model: provider.current(llmState.modelId),
          prompt,
          system,
          temperature: temperature ?? llmState.temperature,
          maxTokens: maxTokens ?? llmState.maxTokens,
          abortSignal: signal,
        });

        setLlmState((prev) => ({
          ...prev,
          isError: false,
          text: result.text,
          error: null,
        }));

        return result.text;
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return "";
        }

        const errorMsg = err instanceof Error ? err.message : String(err);
        setLlmState((prev) => ({
          ...prev,
          isError: true,
          text: "",
          error: errorMsg,
        }));
        return "";
      }
    },
    [provider, llmState.modelId, llmState.temperature, llmState.maxTokens],
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

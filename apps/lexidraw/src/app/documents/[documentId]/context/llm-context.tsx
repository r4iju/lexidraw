"use client";

import React, {
  createContext,
  useMemo,
  useState,
  useRef,
  useContext,
  useCallback,
  type PropsWithChildren,
} from "react";

import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { debounce } from "@packages/lib";
import { useSession } from "next-auth/react";

/** Your shared LLM state */
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
};

type LLMContextValue = {
  generate: (options: LLMOptions) => Promise<string>;
  llmState: LLMState;
  setLlmState: React.Dispatch<React.SetStateAction<LLMState>>;
  setLlmOption: (
    name: keyof LLMState,
    value: string | number | boolean,
  ) => void;
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
    modelId: "gemini-2.0-flash-lite",
    provider: "google",
    temperature: 0.3,
    maxTokens: 20,
    isError: false,
    text: "",
    error: null,
  });

  const provider = useMemo(() => {
    // If you prefer environment variables, you can skip this
    if (llmState.provider === "google") {
      return createGoogleGenerativeAI({
        apiKey: session?.user.config.llm.googleApiKey,
      });
    } else if (llmState.provider === "openai") {
      return createOpenAI({
        apiKey: session?.user.config.llm.openaiApiKey,
      });
    } else {
      throw new Error("Invalid provider");
    }
  }, [
    llmState.provider,
    session?.user.config.llm.googleApiKey,
    session?.user.config.llm.openaiApiKey,
  ]);

  // The main function that calls the LLM
  const generate = useCallback(
    async ({
      prompt,
      system = "",
      temperature,
      maxTokens,
    }: LLMOptions): Promise<string> => {
      try {
        const result = await generateText({
          model: provider(llmState.modelId),
          prompt,
          system,
          temperature: temperature ?? llmState.temperature,
          maxTokens: maxTokens ?? llmState.maxTokens,
        });

        setLlmState((prev) => ({
          ...prev,
          isError: false,
          text: result.text,
          error: null,
        }));

        return result.text;
      } catch (err: unknown) {
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

  const setLlmOption = useCallback(
    (name: keyof LLMState, value: string | number | boolean) => {
      setLlmState((prev) => ({ ...prev, [name]: value }));
    },
    [],
  );

  const setLlmOptions = useCallback((options: Partial<LLMState>) => {
    setLlmState((prev) => ({ ...prev, ...options }));
  }, []);

  return (
    <LLMContext.Provider
      value={{ generate, llmState, setLlmState, setLlmOption, setLlmOptions }}
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

export function useDebouncedLlm({
  debounceMs = 3000,
}: {
  debounceMs?: number;
}) {
  const { generate } = useLLM();

  const debouncedSendQuery = useMemo(() => {
    return debounce(generate, debounceMs, { leading: false, trailing: true });
  }, [generate]);

  return debouncedSendQuery;
}

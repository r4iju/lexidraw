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
  name: string;
  description: string;
  provider: string;
  temperature: number;
  maxTokens: number;
  isError: boolean;
  text: string;
  error: string | null;
};

type LLMContextValue = {
  sendQuery: (textSnippet: string) => Promise<string>;
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
] as const satisfies Pick<
  LLMState,
  "modelId" | "provider" | "name" | "description"
>[];

const LLMContext = createContext<LLMContextValue | null>(null);

export function LLMProvider({ children }: PropsWithChildren<unknown>) {
  // Optional: if you're using next-auth to store your API key
  const { data: session } = useSession();

  const [llmState, setLlmState] = useState<LLMState>({
    modelId: "gemini-2.0-flash-lite",
    provider: "google",
    name: "Gemini 2.0 Flash Lite",
    description:
      "A Gemini 2.0 Flash model optimized for cost efficiency and low latency",
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

  // We can throttle queries if we like:
  const lastRequestTimeRef = useRef<number>(0);
  const throttleDelay = 3000; // 3 seconds

  // The main function that calls the LLM
  const sendQuery = useCallback(
    async (
      partialSnippet: string,
      editorContext?: {
        heading: string;
        blockType: string;
        previousSentence: string;
      },
    ): Promise<string> => {
      // check for throttle
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTimeRef.current;
      if (timeSinceLastRequest < throttleDelay) {
        const waitSec = (throttleDelay - timeSinceLastRequest) / 1000;
        console.log(`Request throttled. Please wait ${waitSec}s`);
        return "";
      }
      lastRequestTimeRef.current = now;

      const contextDescription = editorContext
        ? [
            `The user is editing a "${editorContext.blockType}" block under heading: "${editorContext.heading}".`,
            `The previous sentence is: "${editorContext.previousSentence}"`,
          ]
            .join("\n")
            .trim()
        : "";

      console.log("debug prompt...\n", {
        blockType: editorContext?.blockType,
        heading: editorContext?.heading,
        previousSentence: editorContext?.previousSentence,
        partialSnippet: partialSnippet,
      });

      const finalPrompt = [
        contextDescription,
        `The user typed the following partial text: "${partialSnippet}"`,
        `Complete the snippet without repeating the same words.`,
        `Do not wrap the text in quotes.`,
      ]
        .join("\n")
        .trim();

      try {
        const result = await generateText({
          model: provider(llmState.modelId),
          prompt: finalPrompt,
          system: [
            `You are a helpful assistant, trying to complete the user's current sentence.`,
            `Don't repeat the words the user provided.`,
            `Don't affirm the request or reply any meta-information.`,
            `If you don't know the answer, The only acceptable response is a blank string; "".`,
            `Also if you can't complete the sentence, The only acceptable response is a blank string; "".`,
          ].join("\n"),
          temperature: llmState.temperature,
          maxTokens: llmState.maxTokens,
        });

        setLlmState((prev) => ({ ...prev, isError: false, text: result.text }));

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
      value={{ sendQuery, llmState, setLlmState, setLlmOption, setLlmOptions }}
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

/** debounced version for autocomplete */
export function useLLMQuery() {
  const { sendQuery } = useLLM();

  const debouncedSendQuery = useMemo(() => {
    return debounce(sendQuery, 250, { leading: false, trailing: true });
  }, [sendQuery]);

  return debouncedSendQuery;
}

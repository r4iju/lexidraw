"use client";

import React, {
  createContext,
  useState,
  useEffect,
  useRef,
  useContext,
  type PropsWithChildren,
} from "react";
import { useSettings } from "./settings-context";

type LLMState = {
  model: string;
  temperature: number;
  maxTokens: number;
  loading: boolean;
  progress: number;
  text: string;
};

type LLMContextValue = {
  workerRef: React.MutableRefObject<Worker | null>;
  llmState: LLMState;
  setLlmState: (state: LLMState) => void;
  setLlmOption: (
    name: keyof LLMState,
    value: string | number | boolean,
  ) => void;

  // "sendQuery" could also live here if you want
  sendQuery?: (prompt: string) => Promise<string | null>;
};

const LLMContext = createContext<LLMContextValue | null>(null);

export function LLMProvider({ children }: PropsWithChildren<unknown>) {
  const { settings } = useSettings();
  const workerRef = useRef<Worker | null>(null);

  const [llmState, setLlmState] = useState<LLMState>({
    loading: false,
    progress: 0,
    text: "",
    model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    temperature: 0.3,
    maxTokens: 24,
  });

  const extractProgress = (text: string): number => {
    if (!text) return 0;
    const match = text.match(/\[(\d+)\/(\d+)\]/);
    if (match) {
      const current = parseInt(match[1] ?? "0", 10);
      const total = parseInt(match[2] ?? "0", 10);
      return total > 0 ? current / total : 0;
    }
    return 0;
  };

  const createWorker = () => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../../../../workers/web-llm.worker.ts", import.meta.url),
      );
    }
  };

  const destroyWorker = () => {
    console.log("destroying worker");
    workerRef.current?.terminate();
    workerRef.current = null;
  };

  // Create & initialize the Worker once
  useEffect(() => {
    if (settings.isLlmEnabled) {
      createWorker();

      function onMessage(e: MessageEvent) {
        const data = e.data;
        if (data.type === "loading") {
          setLlmState((prev) => ({
            ...prev,
            loading: true,
            progress: data.progress || extractProgress(data.text) || 0,
            text: "Loading...",
          }));
        } else if (data.type === "progress") {
          setLlmState((prev) => ({
            ...prev,
            loading:
              !data.text.toLowerCase().includes("finish") &&
              !data.text.toLowerCase().includes("ready"),
            progress: extractProgress(data.text) || data.progress || 0,
            text: data.text ?? "",
          }));
        } else if (data.type === "ready") {
          setLlmState((prev) => ({
            ...prev,
            loading: false,
            text: "Ready!",
          }));
        } else if (data.type === "error") {
          setLlmState((prev) => ({
            ...prev,
            loading: false,
            progress: 0,
            text: "Error!",
          }));
        }
      }

      workerRef.current?.addEventListener("message", onMessage);

      return () => {
        workerRef.current?.removeEventListener("message", onMessage);
        destroyWorker();
      };
    } else {
      destroyWorker();
    }
  }, [settings.isLlmEnabled]);

  // Whenever settings changes, push them into the worker
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: "settings",
        model: llmState.model,
        temperature: llmState.temperature,
        maxTokens: llmState.maxTokens,
      });
    }
  }, [llmState.model, llmState.temperature, llmState.maxTokens]);

  const setLlmOption = (
    name: keyof LLMState,
    value: string | number | boolean,
  ) => {
    setLlmState((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <LLMContext.Provider
      value={{ workerRef, llmState, setLlmState, setLlmOption }}
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

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
  loading: boolean;
  progress: number;
  text: string;
};

type LLMContextValue = {
  workerRef: React.MutableRefObject<Worker | null>;
  llmState: LLMState;
  setLlmState: (state: LLMState) => void;
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

  // Create & initialize the Worker once
  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../../../../workers/web-llm.worker.ts", import.meta.url),
    );

    function onMessage(e: MessageEvent) {
      const data = e.data;
      console.log("data", data);
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
          loading: false,
          progress: 0,
          text: "Error!",
        }));
      }
      // no "completion" or "error" for queries here, that's ephemeral
    }

    workerRef.current.addEventListener("message", onMessage);

    return () => {
      workerRef.current?.removeEventListener("message", onMessage);
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Whenever settings changes, push them into the worker
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: "settings",
        model: settings.llmModel,
        temperature: settings.llmTemperature,
        maxTokens: settings.llmMaxTokens,
      });
    }
  }, [settings.llmModel, settings.llmTemperature, settings.llmMaxTokens]);

  return (
    <LLMContext.Provider value={{ workerRef, llmState, setLlmState }}>
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

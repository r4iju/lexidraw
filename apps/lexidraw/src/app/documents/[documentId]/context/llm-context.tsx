"use client";

import React, {
  createContext,
  useState,
  useEffect,
  useRef,
  useContext,
  useCallback,
  type PropsWithChildren,
  useMemo,
} from "react";
import { useSettings } from "./settings-context";
import { debounce } from "@packages/lib";

export type LLMState = {
  model: string;
  temperature: number;
  maxTokens: number;
  loading: boolean;
  progress: number;
  text: string;
};

type LLMContextValue = {
  workerRef: React.RefObject<Worker | null>;
  sendQuery: (textSnippet: string) => {
    promise: Promise<string | null>;
    dismiss: () => void;
  };
  llmState: LLMState;
  setLlmState: React.Dispatch<React.SetStateAction<LLMState>>;
  setLlmOption: (
    name: keyof LLMState,
    value: string | number | boolean,
  ) => void;
};

const LLMContext = createContext<LLMContextValue | null>(null);

function generateId(): string {
  return Math.random()
    .toString(36)
    .replace(/[^a-z]+/g, "")
    .substring(2, 15);
}

export function LLMProvider({ children }: PropsWithChildren<unknown>) {
  const { settings } = useSettings();
  const workerRef = useRef<Worker | null>(null);
  const pendingRequests = useRef(
    new Map<
      string,
      {
        resolve: (value: string | null) => void;
        reject: (reason?: any) => void;
      }
    >(),
  );

  const [llmState, setLlmState] = useState<LLMState>({
    loading: false,
    progress: 0,
    text: "",
    model: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    temperature: 0.3,
    maxTokens: 20,
  });

  const sendQuery = useMemo(() => {
    return debounce(
      // eslint-disable-next-line react-compiler/react-compiler
      (textSnippet: string) => {
        const requestId = generateId();
        const promise = new Promise<string | null>((resolve, reject) => {
          pendingRequests.current.set(requestId, { resolve, reject });
          workerRef.current?.postMessage({
            type: "completion",
            textSnippet,
            requestId,
          });
        });
        return {
          promise,
          dismiss: () => pendingRequests.current.delete(requestId),
        };
      },
      250,
      {
        leading: false,
        trailing: true,
      },
    );
  }, []);

  /**
   * Helper to parse progress from a "[3/10]" type string
   */
  const extractProgress = useCallback((text: string): number => {
    if (!text) return 0;
    const match = text.match(/\[(\d+)\/(\d+)\]/);
    if (match) {
      const current = parseInt(match[1] ?? "0", 10);
      const total = parseInt(match[2] ?? "0", 10);
      return total > 0 ? current / total : 0;
    }
    return 0;
  }, []);

  /**
   * Handle messages from the Worker
   */
  const onMessage = useCallback(
    (e: MessageEvent) => {
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
      } else if (data.type === "completion") {
        const inFlight = pendingRequests.current.get(data.requestId);
        if (inFlight) {
          inFlight.resolve(data.completion ?? null);
          pendingRequests.current.delete(data.requestId);
        }
        setLlmState((prev) => ({
          ...prev,
          loading: false,
        }));
      } else if (data.type === "error") {
        setLlmState((prev) => ({
          ...prev,
          loading: false,
          progress: 0,
          text: `Error: ${data.error || "Unknown error"}`,
        }));
      } else {
        console.log("unknown message type", data);
      }
    },
    [extractProgress],
  );

  /**
   * Destroy the worker
   */
  const destroyWorker = useCallback(() => {
    if (workerRef.current) {
      console.log("destroying worker");
      workerRef.current.removeEventListener("message", onMessage);
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, [onMessage]);

  /**
   * Create / Destroy the Worker based on isLlmEnabled
   */
  useEffect(() => {
    if (settings.isLlmEnabled && !workerRef.current) {
      // Create Worker
      workerRef.current = new Worker(
        new URL("../../../../workers/web-llm.worker.ts", import.meta.url),
      );

      // Attach listener
      workerRef.current.addEventListener("message", onMessage);

      // Send init settings
      workerRef.current.postMessage({
        type: "init",
        options: {
          model: llmState.model,
          temperature: llmState.temperature,
          maxTokens: llmState.maxTokens,
        },
      });
    }

    // Cleanup if user toggles LLM off
    if (!settings.isLlmEnabled && workerRef.current) {
      destroyWorker();
    }

    // Cleanup on unmount
    return () => {
      destroyWorker();
    };
  }, [
    settings.isLlmEnabled,
    llmState.model,
    llmState.temperature,
    llmState.maxTokens,
    onMessage,
    destroyWorker,
  ]);

  /**
   * Whenever model/temperature/maxTokens changes, but the worker is already running,
   * send updated "settings" (unless it just got created above).
   */
  useEffect(() => {
    if (workerRef.current && settings.isLlmEnabled) {
      workerRef.current.postMessage({
        type: "settings",
        model: llmState.model,
        temperature: llmState.temperature,
        maxTokens: llmState.maxTokens,
      });
    }
  }, [
    settings.isLlmEnabled,
    llmState.model,
    llmState.temperature,
    llmState.maxTokens,
  ]);

  /**
   * Helper to update individual LLM options
   */
  const setLlmOption = (
    name: keyof LLMState,
    value: string | number | boolean,
  ) => {
    setLlmState((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <LLMContext.Provider
      value={{ workerRef, sendQuery, llmState, setLlmState, setLlmOption }}
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

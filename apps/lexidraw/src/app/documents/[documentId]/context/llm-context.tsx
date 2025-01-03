"use client";

import React, {
  createContext,
  useMemo,
  useState,
  useEffect,
  useRef,
  useContext,
  useCallback,
  type PropsWithChildren,
} from "react";
import { debounce } from "@packages/lib";
import { useSettings } from "./settings-context";
import { LLMEventMap, LLMWorkerMessage } from "./llm-type"; // Import the event map

export type LLMState = {
  model: string;
  temperature: number;
  maxTokens: number;
  isLoading: boolean;
  isError: boolean;
  progress: number;
  text: string;
};

type LLMContextValue = {
  sendQuery: (textSnippet: string) => void;
  on: <K extends keyof LLMEventMap>(
    event: K,
    callback: (payload: LLMEventMap[K]) => void,
  ) => () => void;
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

  /** Event Emitter Implementation */
  const eventEmitter = useRef<
    Partial<{
      [K in keyof LLMEventMap]: ((payload: LLMEventMap[K]) => void)[];
    }>
  >({});

  const [llmState, setLlmState] = useState<LLMState>({
    isLoading: false,
    isError: false,
    progress: 0,
    text: "",
    model: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    temperature: 0.3,
    maxTokens: 20,
  });

  /** Subscribe to an event */
  const on = useCallback(
    <K extends keyof LLMEventMap>(
      event: K,
      callback: (payload: LLMEventMap[K]) => void,
    ) => {
      if (!eventEmitter.current[event]) {
        eventEmitter.current[event] = [];
      }
      eventEmitter.current[event].push(callback);
      // Return an unsubscribe function
      return () => {
        if (eventEmitter.current[event]) {
          eventEmitter.current[event] = eventEmitter.current[event].filter(
            (cb) => cb !== callback,
          ) as Partial<{
            [K in keyof LLMEventMap]: ((payload: LLMEventMap[K]) => void)[];
          }>[K];
        }
      };
    },
    [],
  );

  /** Emit an event */
  const emit = useCallback(
    <K extends keyof LLMEventMap>(event: K, payload: LLMEventMap[K]) => {
      if (eventEmitter.current[event]) {
        eventEmitter.current[event].forEach((cb) => cb(payload));
      }
    },
    [],
  );

  /** Function to send queries to the worker */
  const sendQuery = useCallback((textSnippet: string) => {
    const requestId = generateId();
    workerRef.current?.postMessage({
      type: "completion",
      textSnippet,
      requestId,
    });
    // No promise returned; handling via events
  }, []);

  /** Helper to parse progress from a "[3/10]" type string */
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

  /** Handle messages from the Worker */
  const onMessage = useCallback(
    (e: MessageEvent) => {
      const data = e.data as LLMWorkerMessage;

      switch (data.type) {
        case "loading":
          setLlmState((prev) => ({
            ...prev,
            isLoading: true,
            isError: false,
            progress: data.progress || extractProgress(data.text) || 0,
            text: "Loading...",
          }));
          emit("loading", data);
          break;
        case "progress":
          setLlmState((prev) => ({
            ...prev,
            isLoading:
              !data.text.toLowerCase().includes("finish") &&
              !data.text.toLowerCase().includes("ready"),
            isError: false,
            progress: extractProgress(data.text) || data.progress || 0,
            text: data.text ?? "",
          }));
          emit("progress", data);
          break;
        case "ready":
          setLlmState((prev) => ({
            ...prev,
            isLoading: false,
            isError: false,
            text: "Ready!",
          }));
          emit("ready", data);
          break;
        case "completion":
          // Emit 'completion' event
          emit("completion", data);
          setLlmState((prev) => ({
            ...prev,
            isLoading: false,
            text: data.completion ?? "",
          }));
          break;
        case "error":
          // Emit 'error' event
          emit("error", data);
          setLlmState((prev) => ({
            ...prev,
            isLoading: false,
            isError: true,
            progress: 0,
            text: `Error: ${data.error || "Unknown error"}`,
          }));
          break;
        default:
          console.log("unknown message type", data);
          emit("unknown", data);
          break;
      }
    },
    [emit, extractProgress],
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
      value={{ sendQuery, on, llmState, setLlmState, setLlmOption }}
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

// useLLMQuery.ts
export function useLLMQuery() {
  const { sendQuery } = useLLM();

  const debouncedSendQuery = useMemo(() => {
    return debounce(sendQuery, 250, {
      leading: false,
      trailing: true,
    });
  }, [sendQuery]);

  return debouncedSendQuery;
}

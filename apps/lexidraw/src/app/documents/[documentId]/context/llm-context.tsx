"use client";

import { createContext, useContext, useState, useRef, useEffect } from "react";
import type { PropsWithChildren } from "react";
import { useSession } from "next-auth/react";
import { api } from "~/trpc/react";
import {
  useBrowserByok,
  browserByokAccount,
  browserByokSessionGeneration,
} from "~/lib/byok/browser-session";
import {
  ChatInput,
  CHAT_CAPABILITY,
  CHAT_STOP,
  ChatDeclined,
  prepareChat,
  runChat,
} from "~/lib/generation/chat";
import {
  proChatPort,
  OwnedChatSubmission,
  chatBrowserFetch,
  type ChatQuote,
} from "~/lib/generation/chat-client";
import { queryAccess } from "~/lib/generation/query-access";
import { QueryNotice } from "~/lib/generation/query-notice";
import type { ChatRuntime } from "~/lib/generation/chat-runtime";

import type {
  LanguageModel,
  StepResult,
  tool,
  ToolCallRepairFunction,
  ToolChoice,
  ModelMessage,
} from "ai";
import type {
  LlmBaseConfigSchema,
  StoredLlmConfig,
} from "~/server/api/routers/config";
import type { z } from "zod";

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
  selectedInput?: ChatInput;
  prompt: string;
  context?: string;
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
  chatSource: string;
  chatCapability: string | null;
  chatQuote: ChatQuote | null;
  acceptChatQuote: (accepted: boolean) => void;
  cancelChat: () => void;
};

const LLMContext = createContext<LLMContextValue | null>(null);

type LLMProviderProps = PropsWithChildren<{
  initialConfig: StoredLlmConfig;
  documentId?: string;
  chatRuntime?: ChatRuntime;
}>;

type Turn =
  | { status: "idle" }
  | { status: "running"; text: string }
  | { status: "review"; text: string; quote: ChatQuote }
  | { status: "complete"; text: string }
  | { status: "error"; text: string; message: string };
export function LLMProvider(props: LLMProviderProps) {
  return (
    <>
      {props.chatRuntime ? (
        <RuntimeProvider {...props} runtime={props.chatRuntime} />
      ) : (
        <SelectedRuntimeProvider {...props} key={props.documentId} />
      )}
    </>
  );
}
function SelectedRuntimeProvider(props: LLMProviderProps) {
  const account = useSession();
  return (
    <AccountRuntimeProvider
      {...props}
      key={JSON.stringify([account.data?.user.id, props.documentId])}
      authenticated={account.status === "authenticated"}
    />
  );
}
function AccountRuntimeProvider(
  props: LLMProviderProps & { authenticated: boolean },
) {
  const identity = useSession();
  const accountId =
    identity.status === "authenticated" ? identity.data.user.id : undefined;
  const session = useBrowserByok(accountId);
  const generation = browserByokSessionGeneration();
  const submission = useRef(new OwnedChatSubmission());
  const power = api.auth.getPowerPreference.useQuery(undefined, {
    enabled: props.authenticated,
  });
  const preference = queryAccess(
    power,
    props.authenticated,
    "AI power preference",
  );
  const capabilityEnabled =
    props.authenticated &&
    preference.kind === "ready" &&
    preference.data.mode === "pro";
  const capability = api.pro.chatCapability.useQuery(undefined, {
    enabled: capabilityEnabled,
  });
  const utils = api.useUtils();
  const access = queryAccess(
    capability,
    capabilityEnabled,
    "Pro chat capability",
  );
  const source = preference.kind === "ready" ? preference.data.mode : "unknown";
  const reason =
    preference.kind !== "ready"
      ? preference.kind === "disabled"
        ? identity.status === "loading"
          ? "Checking your account before loading AI Power."
          : "Sign in to use AI Power."
        : preference.message
      : access.kind === "error" || access.kind === "loading"
        ? access.message
        : source === "local"
          ? "Built-in local chat is available only on supported Apple devices. No cloud fallback is used."
          : source === "byok"
            ? "Direct chat is unavailable until provider streaming and bounds are verified. Your saved history is preserved."
            : access.kind === "ready"
              ? access.data.reason
              : "Pro chat capability is disabled.";
  const runtime: ChatRuntime = {
    source,
    available:
      source === "pro" &&
      access.kind === "ready" &&
      access.data.available === true,
    reason,
    async run(input, signal, onText, confirm) {
      if (
        preference.kind !== "ready" ||
        (source === "pro" &&
          (access.kind !== "ready" || !access.data.available))
      )
        throw new Error(reason);
      if (
        !session ||
        !accountId ||
        browserByokAccount() !== accountId ||
        browserByokSessionGeneration() !== generation
      )
        throw new Error("Device account session is not ready.");
      if (source === "local") throw new Error(reason);
      if (source === "byok") {
        const reference = session?.reference();
        if (!session || !reference)
          throw new Error(
            "Set up your OpenRouter key in AI Power on this device.",
          );
        return runChat(input, session.chat(reference), {
          signal,
          onText,
          assertSafe: session.assertSafe,
        });
      }
      try {
        if (!props.documentId)
          throw new Error("Document chat context unavailable.");
        const owned = await utils.client.pro.chatCurrent.query({
          documentId: props.documentId,
        });
        if (
          owned.some((operation) =>
            ["reserved", "running", "unknown"].includes(operation.state),
          )
        )
          throw new Error(
            "Read or cancel the owned chat before starting another turn.",
          );
        return await runChat(
          input,
          proChatPort(input, {
            quote: (input) => utils.client.pro.chatQuote.mutate(input),
            confirm,
            accept: (input) => {
              if (!props.documentId)
                throw new Error("Document chat context unavailable.");
              return utils.client.pro.chatAccept.mutate({
                ...input,
                documentId: props.documentId,
              });
            },
            recover: (input) => {
              if (!props.documentId)
                throw new Error("Document chat context unavailable.");
              return utils.client.pro.chatRecovery.query({
                ...input,
                documentId: props.documentId,
              });
            },
            cancel: (id) => {
              if (!props.documentId)
                throw new Error("Document chat context unavailable.");
              return utils.client.pro.chatCancel.mutate({
                id,
                documentId: props.documentId,
              });
            },
            fetch: (request) => chatBrowserFetch(session, request),
            origin: window.location.origin,
            idempotencyKey: crypto.randomUUID(),
            submission: submission.current,
          }),
          { signal, onText, assertSafe: session?.assertSafe },
        );
      } finally {
        await Promise.all([
          utils.pro.status.invalidate(),
          utils.pro.chatCurrent.invalidate(),
          utils.pro.chatUnscoped.invalidate(),
        ]);
      }
    },
  };
  return (
    <RuntimeProvider {...props} runtime={runtime}>
      <QueryNotice access={preference} retry={() => void power.refetch()} />
      <QueryNotice access={access} retry={() => void capability.refetch()} />
      {props.children}
    </RuntimeProvider>
  );
}
function RuntimeProvider({
  children,
  initialConfig,
  runtime,
}: LLMProviderProps & { runtime: ChatRuntime }) {
  const [turn, setTurn] = useState<Turn>({ status: "idle" });
  const active = useRef<AbortController | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);
  // The in-flight request is an external system tied to the mounted surface. Leaving detaches it; only cancelChat cancels the paid operation.
  useEffect(
    () => () => {
      active.current?.abort();
      pending.current?.(false);
    },
    [],
  );
  function acceptChatQuote(accepted: boolean) {
    const resolve = pending.current;
    if (!resolve) return;
    pending.current = null;
    if (accepted) setTurn({ status: "running", text: "" });
    resolve(accepted);
  }
  function cancelChat() {
    active.current?.abort(CHAT_STOP);
  }
  async function generate(
    options: LLMOptions,
    onText?: (text: string) => void,
  ) {
    if (active.current) throw new Error("A chat turn is already running.");
    if (!runtime.available)
      throw new Error(
        runtime.reason ?? "Chat unavailable for the selected AI Power source.",
      );
    if (options.tools || options.toolChoice || options.system)
      throw new Error(CHAT_CAPABILITY);
    const files = Array.from(options.files ?? []);
    if (
      files.length > 2 ||
      files.some(
        (file) =>
          !["text/plain", "text/markdown"].includes(file.type) ||
          file.size > 1500,
      )
    )
      throw new Error(CHAT_CAPABILITY);
    const controller = new AbortController();
    active.current = controller;
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    setTurn({ status: "running", text: "" });
    const abort = () => {
      pending.current?.(false);
      pending.current = null;
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const input = ChatInput.safeParse(
        options.selectedInput ?? {
          prompt: options.prompt,
          context: options.context ?? "",
          messages: options.messages ?? [],
          files: await Promise.all(
            files.map(async (file) => ({
              name: file.name,
              type: file.type,
              text: await file.text(),
            })),
          ),
        },
      );
      if (!input.success) throw new Error(CHAT_CAPABILITY);
      prepareChat(input.data);

      const text = await runtime.run(
        input.data,
        signal,
        (text) => {
          setTurn({ status: "running", text });
          onText?.(text);
        },
        async (value) =>
          new Promise<boolean>((resolve) => {
            if (signal.aborted) {
              resolve(false);
              return;
            }
            pending.current = resolve;
            setTurn({ status: "review", text: "", quote: value });
          }),
      );
      setTurn({ status: "complete", text });
      return { text };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Chat could not complete.";
      setTurn(
        error instanceof ChatDeclined
          ? { status: "idle" }
          : { status: "error", text: "", message },
      );
      throw new Error(message);
    } finally {
      signal.removeEventListener("abort", abort);
      active.current = null;
    }
  }
  const chatState: ChatLLMState = {
    isError: turn.status === "error",
    text: "text" in turn ? turn.text : "",
    error: turn.status === "error" ? turn.message : null,
    isStreaming: turn.status === "running" || turn.status === "review",
  };
  return (
    <LLMContext.Provider
      value={{
        llmConfig: initialConfig,
        updateLlmConfig: () => {
          throw new Error(
            "Use AI Power. Legacy model settings are unavailable.",
          );
        },
        autocompleteState: {
          isError: false,
          text: "",
          error: null,
          isLoading: false,
        },
        chatState,
        chatSource: runtime.source,
        chatCapability: runtime.available
          ? null
          : (runtime.reason ?? "Chat unavailable"),
        chatQuote: turn.status === "review" ? turn.quote : null,
        acceptChatQuote,
        cancelChat,
        generateChatResponse: generate,
        generateChatStream: async ({ callbacks, ...options }) => {
          try {
            const result = await generate(options, callbacks.onTextUpdate);
            callbacks.onFinish?.(result);
          } catch (error) {
            callbacks.onError?.(
              new Error(
                error instanceof Error
                  ? error.message
                  : "Chat could not complete.",
              ),
            );
          }
        },
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

import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { SessionProvider } from "next-auth/react";
import { PathParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  KEY_ENTER_COMMAND,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
} from "lexical";
import { MarkNode } from "@lexical/mark";
import { api } from "~/trpc/react";
import { installDom, render, click, button } from "~/test/dom";
import {
  commitBrowserByok,
  clearBrowserByok,
} from "~/lib/byok/browser-session";
import { Operation, PRICEBOOK } from "~/server/pro/contracts";
import { LLMProvider } from "../../../context/llm-context";
import { LlmChatProvider, useChatDispatch } from "../llm-chat-context";
import { saveMessages } from "../storage/local-chat-storage";
import { MessageList } from "./message-list";
import { ChatComposer } from "./chat-composer";
import { TooltipProvider } from "~/components/ui/tooltip";
import { Reset } from "./reset";
installDom("http://localhost");
window.HTMLElement.prototype.scrollTo = () => {};
// The unused diagram package probes canvas at import; this fixture does not draw.
Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
  value: () => ({ filter: "none", measureText: () => ({ width: 0 }) }),
});
const { EditorRegistryProvider } = await import(
  "../../../context/editors-context"
);
const { CommentPluginProvider } = await import("../../CommentPlugin");
const { ImageProvider, LexicalImageProvider } = await import(
  "~/hooks/use-image-insertion"
);
const { ImageGenerationProvider, LexicalImageGenerationProvider } =
  await import("~/hooks/use-image-generation");
const { RuntimeToolsProvider } = await import("../runtime-tools-provider");
const { useSendQuery } = await import("../use-send-query");
const { useRegisterKeybindings } = await import("../use-register-keybindings");
const retiredRequests: unknown[] = [];
const previous = {
  fetch: globalThis.fetch,
  FormData: globalThis.FormData,
  matchMedia: globalThis.matchMedia,
  localStorage: globalThis.localStorage,
};
globalThis.fetch = Object.assign(
  async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== "/api/llm/agent")
      throw new Error("Unexpected synthetic global HTTP");
    retiredRequests.push(JSON.parse(String(init?.body)));
    return new Response("Retired", { status: 410 });
  },
  { preconnect() {} },
);
globalThis.FormData = window.FormData;
globalThis.matchMedia = window.matchMedia;
globalThis.localStorage = window.localStorage;
afterAll(() => Object.assign(globalThis, previous));
const documentId = "synthetic-d3-keyboard";
const archive = Array.from({ length: 32 }, (_, i) => ({
  id: `turn-${i}`,
  role: i % 2 ? ("assistant" as const) : ("user" as const),
  content: i === 29 ? "a".repeat(16000) : `Saved ${i}`,
}));
const config = {
  provider: "openai",
  modelId: "old",
  temperature: 0,
  maxOutputTokens: 100,
};
const operation = Operation.parse({
  id: "synthetic-op",
  account_id: "synthetic-d2",
  period_id: "period",
  idempotency_key: "synthetic-key",
  input_hash: "hash",
  feature: "chat",
  state: "settled",
  quote: 1792000,
  charged: 1,
  pricebook: JSON.stringify(PRICEBOOK),
  policy: "synthetic",
  result: "Done.",
  cancel_requested: 0,
  created_at: 1000,
});
async function until(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++)
    await act(async () => {
      await Bun.sleep(5);
    });
  expect(condition()).toBe(true);
}
let activeStream: (input: RequestInfo | URL) => Promise<Response> =
  async () => {
    throw new Error("No synthetic stream surface");
  };
window.fetch = Object.assign(
  (input: RequestInfo | URL) => activeStream(input),
  { preconnect() {} },
);
async function surface() {
  window.localStorage.clear();
  saveMessages(documentId, "chat", archive);
  const streams: unknown[] = [];
  // Only this in-process app stream is allowed; sockets remain refused by preload.
  activeStream = async (input: RequestInfo | URL) => {
    const request =
      input instanceof Request ? input : new Request(String(input));
    if (
      request.url !== "http://localhost/api/chat/stream" ||
      request.method !== "POST"
    )
      throw new Error("Unexpected synthetic app request");
    streams.push(await request.json());
    return new Response(
      `${JSON.stringify({ kind: "operation", operation })}\n`,
    );
  };
  const owner = commitBrowserByok("synthetic-d2");
  const calls: { path: string; input: unknown }[] = [];
  const query = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const client = api.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            calls.push({ path: op.path, input: op.input });
            const responses: Record<string, unknown> = {
              "auth.getPowerPreference": { mode: "pro" },
              "pro.chatCapability": { available: true },
              "pro.chatCurrent": [],
              "pro.chatUnscoped": [],
              "pro.status": {},
              "imagePower.capability": {
                available: false,
                reason: "Synthetic unavailable",
              },
              "pro.chatQuote": {
                periodId: "period",
                maximum: 1792000,
                book: PRICEBOOK,
                inputHash: "hash",
                policy: "Synthetic only",
              },
              "pro.chatAccept": {
                ...operation,
                state: "reserved",
                result: null,
              },
              "pro.chatRecovery": operation,
            };
            if (!(op.path in responses))
              throw new Error(`Unexpected synthetic operation ${op.path}`);
            const value = responses[op.path];
            void Promise.resolve(value).then(
              (data) => {
                observer.next({ result: { data } });
                observer.complete();
              },
              (error) => observer.error(new TRPCClientError(String(error))),
            );
          }),
    ],
  });
  let editor: LexicalEditor | undefined;
  function Surface() {
    useRegisterKeybindings();
    [editor] = useLexicalComposerContext();
    const dispatch = useChatDispatch();
    const send = useSendQuery();
    return (
      <>
        <button
          type="button"
          onClick={() => dispatch({ type: "setMode", mode: "chat" })}
        >
          Chat mode
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "setMode", mode: "agent" })}
        >
          Agent mode
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "setMode", mode: "debug" })}
        >
          Debug mode
        </button>
        <Reset />
        <MessageList />
        <ChatComposer send={send} />
      </>
    );
  }
  const mount = () =>
    render(
      <SessionProvider
        session={{ user: { id: "synthetic-d2" }, expires: "2099-01-01" }}
        refetchOnWindowFocus={false}
      >
        <PathParamsContext.Provider value={{ documentId }}>
          <QueryClientProvider client={query}>
            <api.Provider client={client} queryClient={query}>
              <LexicalComposer
                initialConfig={{
                  namespace: "SyntheticD2",
                  nodes: [MarkNode],
                  onError: (error) => {
                    throw error;
                  },
                  editorState: () => {
                    $getRoot().append(
                      $createParagraphNode().append(
                        $createTextNode("Benign document"),
                      ),
                    );
                  },
                }}
              >
                <EditorRegistryProvider>
                  <LlmChatProvider>
                    <LLMProvider
                      documentId={documentId}
                      initialConfig={{
                        chat: config,
                        agent: config,
                        autocomplete: config,
                      }}
                    >
                      <ImageProvider>
                        <LexicalImageProvider>
                          <ImageGenerationProvider
                            entityId={documentId}
                            signedIn={false}
                          >
                            <LexicalImageGenerationProvider
                              persist={async () => {
                                throw new Error(
                                  "Unexpected synthetic image persistence",
                                );
                              }}
                            >
                              <CommentPluginProvider>
                                <RuntimeToolsProvider>
                                  <TooltipProvider>
                                    <Surface />
                                  </TooltipProvider>
                                </RuntimeToolsProvider>
                              </CommentPluginProvider>
                            </LexicalImageGenerationProvider>
                          </ImageGenerationProvider>
                        </LexicalImageProvider>
                      </ImageProvider>
                    </LLMProvider>
                  </LlmChatProvider>
                </EditorRegistryProvider>
              </LexicalComposer>
            </api.Provider>
          </QueryClientProvider>
        </PathParamsContext.Provider>
      </SessionProvider>,
    );
  const view = await mount();
  await click(button("Chat mode"));
  await until(() => button("Review context")?.disabled === false);
  const review = async (turnIds = ["turn-0", "turn-1"]) => {
    const prompt =
      document.querySelector<HTMLTextAreaElement>('[name="prompt"]');
    if (!prompt) throw new Error("Missing prompt");
    prompt.value = "Why?";
    for (const box of document.querySelectorAll<HTMLInputElement>(
      '[name="turn"]',
    ))
      box.checked = turnIds.includes(box.value);
    await click(button("Review context"));
  };
  return {
    view,
    mount,
    review,
    calls,
    streams,
    owner,
    query,
    editor: () => {
      if (!editor) throw new Error("Missing editor");
      return editor;
    },
    async close() {
      await view.unmount();
      query.clear();
      clearBrowserByok(owner.generation, owner.expirationLease);
    },
  };
}
test("real Cmd+Alt+Enter in saved agent and debug modes gives bounded action guidance without retired traffic", async () => {
  const chat = await surface();
  try {
    for (const label of ["Agent mode", "Debug mode"]) {
      await click(button(label));
      await act(async () => {
        chat.editor().dispatchCommand(
          KEY_ENTER_COMMAND,
          new window.KeyboardEvent("keydown", {
            key: "Enter",
            metaKey: true,
            altKey: true,
            cancelable: true,
          }),
        );
        await Bun.sleep(30);
      });
      expect(retiredRequests).toEqual([]);
      expect(document.body.textContent).toContain("Open document action");
      expect(document.body.textContent).toContain(
        `/documents/${documentId}/agent`,
      );
    }
    await click(button("Chat mode"));
    await chat.review([]);
    await click(button("Send reviewed context"));
    await until(() => button("Accept maximum") !== undefined);
    await click(button("Accept maximum"));
    await until(() => chat.streams.length === 1);
    expect(chat.calls.filter((c) => c.path === "pro.chatQuote")).toHaveLength(
      1,
    );
    expect(retiredRequests).toEqual([]);
  } finally {
    await chat.close();
  }
});

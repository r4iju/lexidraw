import { afterAll, expect, test } from "bun:test";
import { act, useState } from "react";
import { SessionProvider } from "next-auth/react";
import { PathParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
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
import { saveMessages, loadMessages } from "../storage/local-chat-storage";
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
const previous = {
  FormData: globalThis.FormData,
  matchMedia: globalThis.matchMedia,
  localStorage: globalThis.localStorage,
};
globalThis.FormData = window.FormData;
globalThis.matchMedia = window.matchMedia;
globalThis.localStorage = window.localStorage;
afterAll(() => Object.assign(globalThis, previous));
const documentId = "synthetic-d2-lifecycle";
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
  let source = "pro";
  let acceptance: (() => Promise<unknown>) | undefined;
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
              "auth.getPowerPreference": { mode: source },
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
            const value =
              op.path === "pro.chatAccept" && acceptance
                ? acceptance()
                : responses[op.path];
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
  let delayedFile: File | undefined;
  let hook: ReturnType<typeof useSendQuery> | undefined;
  function Surface() {
    [editor] = useLexicalComposerContext();
    const dispatch = useChatDispatch();
    const send = useSendQuery();
    hook = send;
    const [retained, setRetained] =
      useState<import("~/lib/generation/chat").ChatInput>();
    const [notice, setNotice] = useState("");
    return (
      <>
        <button
          type="button"
          onClick={async () => {
            setNotice("Attachment review pending");
            const result = await send.review({
              prompt: "Why?",
              files: delayedFile ? [delayedFile] : [],
              selection: { turnIds: ["turn-0"], documentExcerpt: "" },
            });
            setNotice(`Attachment review ${result.kind}`);
          }}
        >
          Review delayed attachment
        </button>
        <button
          type="button"
          onClick={async () => {
            const result = await send.review({
              prompt: "Retained?",
              selection: { turnIds: ["turn-0"], documentExcerpt: "" },
            });
            if (result.kind === "ready") {
              setRetained(result.input);
              setNotice("Retained review ready");
            }
          }}
        >
          Retain review
        </button>
        <button
          type="button"
          onClick={async () => {
            await send.review({
              prompt: "Replacement?",
              selection: { turnIds: ["turn-1"], documentExcerpt: "" },
            });
            setNotice("Replacement reviewed");
          }}
        >
          Review replacement
        </button>
        <button
          type="button"
          onClick={() => {
            if (retained)
              void send({ prompt: retained.prompt, selectedInput: retained });
          }}
        >
          Send retained review
        </button>
        <p>{notice}</p>
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
    holdAcceptance: (value: () => Promise<unknown>) => {
      acceptance = value;
    },
    changeSource: async (value: string) => {
      source = value;
      await query.invalidateQueries();
    },
    delayFile: (file: File) => {
      delayedFile = file;
    },
    hook: () => {
      if (!hook) throw new Error("Missing send hook");
      return hook;
    },
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
test("New conversation invalidates the mounted reviewed archive before quote or storage dispatch", async () => {
  const chat = await surface();
  try {
    expect(document.body.textContent).toContain("a".repeat(16000));
    await chat.review();
    expect(button("Send reviewed context")).toBeDefined();
    await click(document.querySelector('[aria-label="New conversation"]'));
    expect(document.body.textContent).toContain("No saved turns.");
    expect(button("Send reviewed context")).toBeUndefined();
    expect(
      chat.calls.filter(({ path }) =>
        ["pro.chatQuote", "pro.chatAccept"].includes(path),
      ),
    ).toEqual([]);
    expect(loadMessages(documentId, "chat")).toEqual([]);
  } finally {
    await chat.close();
  }
});

test("finite selected input survives the real app boundary and archive reload; replacement reviews cannot dispatch older choices", async () => {
  const chat = await surface();
  try {
    await chat.review(["turn-29"]);
    expect(document.body.textContent).toContain(
      "Choose fewer complete saved turns",
    );
    expect(
      chat.calls.filter(({ path }) => path === "pro.chatQuote"),
    ).toHaveLength(0);
    await chat.review();
    await click(button("Send reviewed context"));
    await until(() => button("Accept maximum") !== undefined);
    expect(
      chat.calls.find(({ path }) => path === "pro.chatQuote")?.input,
    ).toEqual({
      prompt: "Why?",
      messages: [
        { role: "user", content: "Saved 0" },
        { role: "assistant", content: "Saved 1" },
      ],
      context: "",
      files: [],
    });
    await click(button("Accept maximum"));
    await until(() => document.body.textContent?.includes("Done.") === true);
    expect(chat.streams).toEqual([
      {
        id: "synthetic-op",
        input: {
          prompt: "Why?",
          messages: [
            { role: "user", content: "Saved 0" },
            { role: "assistant", content: "Saved 1" },
          ],
          context: "",
          files: [],
        },
      },
    ]);
    await chat.view.unmount();
    expect(loadMessages(documentId, "chat")).toHaveLength(34);
    expect(loadMessages(documentId, "chat")[29]?.content).toBe(
      "a".repeat(16000),
    );
    const reloaded = await chat.mount();
    try {
      await click(button("Chat mode"));
      await until(
        () => document.body.textContent?.includes("a".repeat(16000)) === true,
      );
      expect(document.body.textContent).toContain("Saved 0");
      expect(document.body.textContent).toContain("Done.");
      chat.calls.length = 0;
      await click(button("Retain review"));
      expect(document.body.textContent).toContain("Retained review ready");
      await click(button("Review replacement"));
      expect(document.body.textContent).toContain("Replacement reviewed");
      await click(button("Send retained review"));
      expect(
        chat.calls.filter(({ path }) =>
          ["pro.chatQuote", "pro.chatAccept"].includes(path),
        ),
      ).toEqual([]);
      expect(document.body.textContent).not.toContain("Review chat maximum");
    } finally {
      await reloaded.unmount();
    }
  } finally {
    await chat.close();
  }
});

test("a restored device credential policy invalidates a pending public file review before its late completion", async () => {
  const chat = await surface();
  try {
    let finish: ((text: string) => void) | undefined;
    const file = new window.File(["Attachment"], "note.txt", {
      type: "text/plain",
    });
    Object.defineProperty(file, "text", {
      value: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    chat.delayFile(file);
    await click(button("Review delayed attachment"));
    expect(document.body.textContent).toContain("Attachment review pending");
    // Public restoration of synthetic retired-key policy, no real credential reads.
    const { createByokSession } = await import("~/lib/byok/session");
    const retired = createByokSession(async () => {
      throw new Error("Unexpected provider");
    }, "http://localhost");
    retired.replace("openrouter", "SyntheticRetiredPolicyKeyQXYZ");
    await act(async () =>
      chat.owner.session.restoreFingerprints(retired.fingerprints()),
    );
    await act(async () => finish?.("Attachment"));
    expect(document.body.textContent).toContain(
      "Attachment review needs_selection",
    );
    expect(
      chat.calls.filter(({ path }) =>
        ["pro.chatQuote", "pro.chatAccept"].includes(path),
      ),
    ).toEqual([]);
  } finally {
    await chat.close();
  }
});

test("current excluded document keys and same-account device generations block retained send; reset rejects late file review", async () => {
  const chat = await surface();
  try {
    await chat.review();
    await click(button("Retain review"));
    const key = "SyntheticExcludedSourceKeyQXYZ";
    await act(async () => {
      chat.owner.session.replace("openrouter", key);
      chat.editor().update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append($createTextNode(`Document ${key}`)),
            );
        },
        { discrete: true },
      );
    });
    expect(button("Send reviewed context")).toBeUndefined();
    await click(button("Send retained review"));
    expect(chat.calls.some(({ path }) => path === "pro.chatQuote")).toBe(false);
    expect(
      loadMessages(documentId, "chat").some(({ content }) =>
        content.includes(key),
      ),
    ).toBe(false);
    await act(async () =>
      chat.editor().update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append($createTextNode("Clean document")),
            );
        },
        { discrete: true },
      ),
    );
    await chat.review();
    expect(button("Send reviewed context")).toBeDefined();
    await act(async () => {
      clearBrowserByok(chat.owner.generation, chat.owner.expirationLease);
      commitBrowserByok("synthetic-d2");
    });
    expect(button("Send reviewed context")).toBeUndefined();
    await click(button("Send retained review"));
    expect(chat.calls.some(({ path }) => path === "pro.chatQuote")).toBe(false);
    let finish: ((text: string) => void) | undefined;
    const file = new window.File(["Attachment"], "note.txt", {
      type: "text/plain",
    });
    Object.defineProperty(file, "text", {
      value: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    chat.delayFile(file);
    await click(button("Review delayed attachment"));
    await click(document.querySelector('[aria-label="New conversation"]'));
    await act(async () => finish?.("Attachment"));
    expect(
      document.body.textContent?.includes("Attachment review needs_selection"),
    ).toBe(true);
    expect(
      chat.calls.some(({ path }) =>
        ["pro.chatQuote", "pro.chatAccept"].includes(path),
      ),
    ).toBe(false);
  } finally {
    await chat.close();
    clearBrowserByok();
  }
});

test("submitted context and original recovery key survive source, editor and credential changes", async () => {
  const chat = await surface();
  try {
    let loseAcceptance: ((reason: Error) => void) | undefined;
    chat.holdAcceptance(
      () =>
        new Promise((_, reject) => {
          loseAcceptance = reject;
        }),
    );
    await chat.review();
    await click(button("Send reviewed context"));
    await until(() => button("Accept maximum") !== undefined);
    await click(button("Accept maximum"));
    await until(() => chat.calls.some(({ path }) => path === "pro.chatAccept"));
    const accepted = chat.calls.find(
      ({ path }) => path === "pro.chatAccept",
    )?.input;
    await act(async () => {
      chat.owner.session.replace(
        "openrouter",
        "SyntheticAcceptedRecoveryKeyQXYZ",
      );
      chat.editor().update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append(
                $createTextNode(
                  "Changed document SyntheticAcceptedRecoveryKeyQXYZ",
                ),
              ),
            );
        },
        { discrete: true },
      );
      await chat.changeSource("local");
    });
    await act(async () =>
      loseAcceptance?.(new Error("Synthetic lost acceptance reply")),
    );
    await until(() =>
      chat.calls.some(({ path }) => path === "pro.chatRecovery"),
    );
    const recovery = chat.calls.find(
      ({ path }) => path === "pro.chatRecovery",
    )?.input;
    expect(accepted).toMatchObject({
      input: {
        prompt: "Why?",
        context: "",
        messages: [{ content: "Saved 0" }, { content: "Saved 1" }],
      },
    });
    if (
      !accepted ||
      typeof accepted !== "object" ||
      !("input" in accepted) ||
      !("idempotencyKey" in accepted)
    )
      throw new Error("Missing accepted identity");
    expect(recovery).toEqual({
      documentId,
      input: accepted.input,
      idempotencyKey: accepted.idempotencyKey,
    });
    expect(
      chat.calls.filter(({ path }) => path === "pro.chatAccept"),
    ).toHaveLength(1);
    await until(() => document.body.textContent?.includes("Done.") === true);
  } finally {
    await chat.close();
  }
});

test("a chat review cannot become an agent request after mode changes", async () => {
  const chat = await surface();
  const refusal = globalThis.fetch;
  let agentRequests = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      if (input !== "/api/llm/agent")
        throw new Error("Unexpected synthetic app request");
      agentRequests++;
      throw new Error("Synthetic retired agent unavailable");
    },
    { preconnect() {} },
  );
  try {
    await click(button("Retain review"));
    await click(button("Agent mode"));
    await click(button("Send retained review"));
    expect(agentRequests).toBe(0);
    expect(
      chat.calls.some(({ path }) =>
        ["pro.chatQuote", "pro.chatAccept"].includes(path),
      ),
    ).toBe(false);
  } finally {
    globalThis.fetch = refusal;
    await chat.close();
  }
});

test("leaving the mounted surface rejects its late file review result", async () => {
  const chat = await surface();
  try {
    let finish: ((text: string) => void) | undefined;
    const file = new window.File(["Attachment"], "note.txt", {
      type: "text/plain",
    });
    Object.defineProperty(file, "text", {
      value: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    const pending = chat
      .hook()
      .review({
        prompt: "Why?",
        files: [file],
        selection: { turnIds: ["turn-0"], documentExcerpt: "" },
      });
    expect(finish).toBeDefined();
    await chat.view.unmount();
    finish?.("Attachment");
    const result = await pending;
    expect(result.kind).toBe("needs_selection");
    expect(
      chat.calls.some(({ path }) =>
        ["pro.chatQuote", "pro.chatAccept"].includes(path),
      ),
    ).toBe(false);
  } finally {
    await chat.close();
  }
});

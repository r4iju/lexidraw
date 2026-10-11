import { act } from "react";
import { expect, test } from "bun:test";
import { installDom, render } from "~/test/dom";
import { runChat } from "~/lib/generation/chat";
import { proChatPort } from "~/lib/generation/chat-client";
import { Operation, PRICEBOOK } from "~/server/pro/contracts";
import { LLMProvider, useLLM } from "./llm-context";
installDom("http://localhost");
const config = {
  provider: "openai",
  modelId: "old-model",
  temperature: 0.5,
  maxOutputTokens: 100,
} as const;
const operation = Operation.parse({
  id: "chat-op",
  account_id: "alice",
  period_id: "period",
  idempotency_key: "turn",
  input_hash: "hash",
  feature: "chat",
  state: "reserved",
  quote: 1792000,
  charged: 0,
  pricebook: JSON.stringify(PRICEBOOK),
  policy: "fixture",
  result: null,
  cancel_requested: 0,
  created_at: 1000,
});
type Llm = ReturnType<typeof useLLM>;
async function surface() {
  const calls = {
    accepted: 0,
    fetched: 0,
    cancelled: [] as string[],
    connection: undefined as AbortSignal | undefined,
  };
  let releaseAcceptance: (() => void) | undefined;
  let holdAcceptance = false;
  let current: Llm | undefined;
  const errors: string[] = [];
  function Consumer() {
    current = useLLM();
    return null;
  }
  const view = await render(
    <LLMProvider
      initialConfig={{ chat: config, agent: config, autocomplete: config }}
      chatRuntime={{
        source: "pro",
        available: true,
        run: (input, signal, onText, confirm) =>
          runChat(
            input,
            proChatPort(input, {
              quote: async () => ({
                periodId: "period",
                maximum: 1792000,
                book: PRICEBOOK,
                inputHash: "hash",
                policy: "fixture",
              }),
              confirm,
              accept: async () => {
                calls.accepted++;
                if (holdAcceptance)
                  await new Promise<void>((resolve) => {
                    releaseAcceptance = resolve;
                  });
                return operation;
              },
              cancel: async (id) => {
                calls.cancelled.push(id);
              },
              fetch: async (request) => {
                calls.fetched++;
                calls.connection = request.signal;
                return new Response(
                  new ReadableStream({
                    start(controller) {
                      request.signal.addEventListener("abort", () =>
                        controller.error(new DOMException("", "AbortError")),
                      );
                    },
                  }),
                );
              },
              origin: "https://app.test",
              idempotencyKey: "turn",
            }),
            { signal, onText },
          ),
      }}
    >
      <Consumer />
    </LLMProvider>,
  );
  const llm = () => {
    if (!current) throw new Error("surface not rendered");
    return current;
  };
  const until = async (condition: () => boolean) => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt++)
      await act(async () => {
        await Bun.sleep(5);
      });
    expect(condition()).toBe(true);
  };
  return {
    calls,
    errors,
    llm,
    until,
    holdAcceptance() {
      holdAcceptance = true;
    },
    releaseAcceptance: () => act(async () => releaseAcceptance?.()),
    unmount: view.unmount,
    async send() {
      await act(async () => {
        void llm().generateChatStream({
          prompt: "Hello",
          callbacks: { onError: (error) => errors.push(error.message) },
        });
      });
    },
    async accept(accepted: boolean) {
      await act(async () => llm().acceptChatQuote(accepted));
    },
    async stop() {
      await act(async () => llm().cancelChat());
    },
  };
}

test("leaving the chat surface after acceptance drops the connection without cancelling the paid operation", async () => {
  const chat = await surface();
  await chat.send();
  await chat.until(() => chat.llm().chatQuote !== null);
  await chat.accept(true);
  await chat.until(() => chat.calls.fetched === 1);
  await chat.unmount();
  expect(chat.calls.connection?.aborted).toBe(true);
  expect(chat.calls.cancelled).toEqual([]);
});

test("an acceptance that arrives after the surface was left neither cancels nor dispatches", async () => {
  const chat = await surface();
  chat.holdAcceptance();
  await chat.send();
  await chat.until(() => chat.llm().chatQuote !== null);
  await chat.accept(true);
  await chat.until(() => chat.calls.accepted === 1);
  await chat.unmount();
  await chat.releaseAcceptance();
  await act(async () => {
    await Bun.sleep(20);
  });
  expect(chat.calls.cancelled).toEqual([]);
  expect(chat.calls.fetched).toBe(0);
});

test("Stop cancels the accepted operation once and leaves a stopped, idle chat", async () => {
  const chat = await surface();
  await chat.send();
  await chat.until(() => chat.llm().chatQuote !== null);
  await chat.accept(true);
  await chat.until(() => chat.calls.fetched === 1);
  await chat.stop();
  await chat.until(() => !chat.llm().chatState.isStreaming);
  expect(chat.calls.cancelled).toEqual(["chat-op"]);
  expect(chat.llm().chatState.error).toContain("Chat stopped");
  expect(chat.errors).toEqual([chat.llm().chatState.error ?? ""]);
  await chat.unmount();
});

test("declining the quote starts nothing and is not reported as an uncertain outcome", async () => {
  const chat = await surface();
  await chat.send();
  await chat.until(() => chat.llm().chatQuote !== null);
  await chat.accept(false);
  await chat.until(() => chat.errors.length === 1);
  expect(chat.errors[0]).toContain("No request was started");
  expect(chat.errors[0]).not.toContain("uncertain");
  expect(chat.llm().chatState.isStreaming).toBe(false);
  expect(chat.calls).toMatchObject({ accepted: 0, fetched: 0, cancelled: [] });
  await chat.unmount();
});

test("Stop with no running turn does not fabricate a busy chat", async () => {
  const chat = await surface();
  await chat.stop();
  expect(chat.llm().chatState.isStreaming).toBe(false);
  await chat.unmount();
});

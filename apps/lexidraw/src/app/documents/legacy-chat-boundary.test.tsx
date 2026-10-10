import { act } from "react";
import { expect, test } from "bun:test";
import superjson from "superjson";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { api } from "~/trpc/react";
import { installDom, render } from "~/test/dom";
import { useLLM, LLMProvider } from "./[documentId]/context/llm-context";
installDom("http://localhost");
const config = {
  provider: "openai",
  modelId: "old-model",
  temperature: 0.5,
  maxOutputTokens: 100,
};
test("migrated chat delivers incremental updates through the injected selected source and keeps legacy settings", async () => {
  let run: (() => Promise<void>) | undefined;
  const updates: string[] = [];
  let error = "",
    calls = 0;
  const prior = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      return new Response("data: secret content\n\n");
    },
    { preconnect() {} },
  );
  function Consumer() {
    const llm = useLLM();
    run = () =>
      llm.generateChatStream({
        prompt: "Private document",
        callbacks: {
          onTextUpdate: (text) => updates.push(text),
          onError: (value) => {
            error = value.message;
          },
        },
      });
    return null;
  }
  const query = new QueryClient();
  const client = api.createClient({
    links: [
      httpBatchLink({
        url: "http://localhost/api/trpc",
        transformer: superjson,
      }),
    ],
  });
  const view = await render(
    <api.Provider client={client} queryClient={query}>
      <QueryClientProvider client={query}>
        <LLMProvider
          initialConfig={{ chat: config, agent: config, autocomplete: config }}
          chatRuntime={{
            source: "byok",
            available: true,
            async run(_input, _signal, onText) {
              onText("A ");
              await Bun.sleep(5);
              onText("A response.");
              return "A response.";
            },
          }}
        >
          <Consumer />
        </LLMProvider>
      </QueryClientProvider>
    </api.Provider>,
  );
  try {
    await act(async () => {
      await run?.();
    });
    expect(error).toBe("");
    expect(updates).toEqual(["A ", "A response."]);
    expect(calls).toBe(0);
  } finally {
    await view.unmount();
    globalThis.fetch = prior;
  }
});

test("concurrent chat triggers cannot create two paid turns while preparing files", async () => {
  let run: (() => Promise<PromiseSettledResult<unknown>[]>) | undefined;
  let calls = 0;
  function Consumer() {
    const llm = useLLM();
    run = () =>
      Promise.allSettled([
        llm.generateChatResponse({ prompt: "First" }),
        llm.generateChatResponse({ prompt: "Second" }),
      ]);
    return null;
  }
  const view = await render(
    <LLMProvider
      initialConfig={{ chat: config, agent: config, autocomplete: config }}
      chatRuntime={{
        source: "byok",
        available: true,
        async run() {
          calls++;
          await Bun.sleep(5);
          return "Answer.";
        },
      }}
    >
      <Consumer />
    </LLMProvider>,
  );
  try {
    let results: PromiseSettledResult<unknown>[] = [];
    await act(async () => {
      results = (await run?.()) ?? [];
    });
    expect(calls).toBe(1);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
  } finally {
    await view.unmount();
  }
});

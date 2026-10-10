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
test("legacy chat reports unavailable without sending document or file content to a closed route", async () => {
  let run: (() => Promise<void>) | undefined;
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
        >
          <Consumer />
        </LLMProvider>
      </QueryClientProvider>
    </api.Provider>,
  );
  try {
    await run?.();
    expect(error).toContain("Chat is unavailable");
    expect(calls).toBe(0);
  } finally {
    await view.unmount();
    globalThis.fetch = prior;
  }
});

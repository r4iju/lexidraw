import { expect, test } from "bun:test";
import { act } from "react";
import { SessionProvider } from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { api } from "~/trpc/react";
import { installDom, render } from "~/test/dom";
import { LLMProvider, useLLM } from "./llm-context";
installDom("http://localhost");
const config = {
  provider: "openai",
  modelId: "saved",
  temperature: 0,
  maxOutputTokens: 100,
};

test("signed-out chat ignores cached Pro preference without requesting protected capability", async () => {
  const calls: string[] = [];
  const query = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  query.setQueryData(
    getQueryKey(api.auth.getPowerPreference, undefined, "query"),
    { mode: "pro" },
  );
  const client = api.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            calls.push(op.path);
            observer.next({
              result: {
                data: {
                  available: false,
                  reason: "Protected request attempted",
                },
              },
            });
            observer.complete();
          }),
    ],
  });
  function Status() {
    const llm = useLLM();
    return <p>{llm.chatCapability}</p>;
  }
  const view = await render(
    <SessionProvider session={null}>
      <QueryClientProvider client={query}>
        <api.Provider client={client} queryClient={query}>
          <LLMProvider
            initialConfig={{
              chat: config,
              agent: config,
              autocomplete: config,
            }}
          >
            <Status />
          </LLMProvider>
        </api.Provider>
      </QueryClientProvider>
    </SessionProvider>,
  );
  try {
    await act(async () => {
      await Bun.sleep(30);
    });
    expect(calls).toEqual([]);
    expect(document.body.textContent).toContain("Sign in");
    expect(document.body.textContent).not.toContain("Retry");
  } finally {
    await view.unmount();
    query.clear();
  }
});

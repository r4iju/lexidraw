import { expect, mock, test } from "bun:test";
import { button, click, installDom, render } from "~/test/dom";
installDom();
let account = "alice";
const owned = {
  id: "detached",
  account_id: "alice",
  state: "reserved",
  result: null,
  charged: 0,
  quote: 1792000,
};
const read = mock(async () => {});
const cancel = mock(async () => owned);
mock.module("next-auth/react", () => ({
  useSession: () => ({
    status: "authenticated",
    data: { user: { id: account } },
  }),
}));
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      pro: {
        chatCurrent: { invalidate: async () => {} },
        status: { invalidate: async () => {} },
      },
    }),
    pro: {
      chatUnscoped: {
        useQuery: () => ({
          data: [],
          isPending: false,
          isError: false,
          refetch: read,
        }),
      },
      cancel: {
        useMutation: () => ({
          mutateAsync: cancel,
          isError: false,
          isPending: false,
        }),
      },
      chatCurrent: {
        useQuery: () => ({
          data: [owned],
          isPending: false,
          isError: false,
          refetch: read,
        }),
      },
      chatCancel: {
        useMutation: () => ({
          mutateAsync: cancel,
          isError: false,
          isPending: false,
        }),
      },
    },
  },
}));
const { LLMProvider } = await import("./llm-context");
const runtime: import("~/lib/generation/chat-runtime").ChatRuntime = {
  source: "local",
  available: false,
  reason: "Generation closed",
  run: async () => {
    throw Error("Recovery cannot generate");
  },
};
test("public document chat wrapper restores and cancels owned acceptance independently of selected runtime", async () => {
  // Legacy config is unused by this read-only wrapper fixture.
  const view = await render(
    <LLMProvider
      initialConfig={{} as never}
      documentId="doc"
      chatRuntime={runtime}
    >
      <p>Conversation</p>
    </LLMProvider>,
  );
  try {
    expect(document.body.textContent).toContain("reserved");
    await click(button("Cancel owned chat"));
    expect(cancel).toHaveBeenCalledWith({ documentId: "doc", id: "detached" });
    await click(button("Refresh owned chats"));
    expect(read).toHaveBeenCalled();
    account = "foreign";
    await view.rerender(
      <LLMProvider
        initialConfig={{} as never}
        documentId="doc"
        chatRuntime={runtime}
      >
        <p>Conversation</p>
      </LLMProvider>,
    );
    expect(button("Cancel owned chat")).toBeUndefined();
  } finally {
    await view.unmount();
    account = "alice";
  }
});

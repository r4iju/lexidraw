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
let operations = [owned];
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
          data: operations,
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
const { OwnedChatRecovery } = await import("~/lib/generation/chat-recovery");
const { LLMProvider } = await import("./llm-context");
const runtime: import("~/lib/generation/chat-runtime").ChatRuntime = {
  source: "local",
  available: false,
  reason: "Generation closed",
  run: async () => {
    throw Error("Recovery cannot generate");
  },
};
test("document provider leaves the editor free of chat recovery controls", async () => {
  const view = await render(
    <LLMProvider
      initialConfig={{} as never}
      documentId="doc"
      chatRuntime={runtime}
    >
      <p>Document editor</p>
    </LLMProvider>,
  );
  try {
    expect(document.body.textContent).toBe("Document editor");
  } finally {
    await view.unmount();
  }
});
test("chat recovery restores and cancels owned acceptance independently of selected runtime", async () => {
  // Legacy config is unused by this read-only wrapper fixture.
  const view = await render(<OwnedChatRecovery documentId="doc" />);
  try {
    expect(document.body.textContent).toContain("reserved");
    await click(button("Stop chat"));
    expect(cancel).toHaveBeenCalledWith({ documentId: "doc", id: "detached" });
    await click(button("Refresh chats"));
    expect(read).toHaveBeenCalled();
    account = "foreign";
    await view.rerender(<OwnedChatRecovery documentId="doc" />);
    expect(button("Stop chat")).toBeUndefined();
  } finally {
    await view.unmount();
    account = "alice";
  }
});

test("empty chat recovery occupies no space", async () => {
  operations = [];
  const view = await render(<OwnedChatRecovery documentId="doc" />);
  try {
    expect(document.body.textContent).toBe("");
  } finally {
    await view.unmount();
    operations = [owned];
  }
});

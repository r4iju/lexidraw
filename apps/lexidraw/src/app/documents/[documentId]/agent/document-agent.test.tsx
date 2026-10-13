import { act } from "react";
import { afterAll, expect, mock, test } from "bun:test";
import type { AgentViewState } from "~/lib/agent/action-view";
import { button, click, installDom, render } from "~/test/dom";

installDom();
const savedFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  mock(async () => {
    throw new Error("Network forbidden in document-action test");
  }),
  {
    preconnect() {
      throw new Error("Network forbidden in document-action test");
    },
  },
);
afterAll(() => {
  globalThis.fetch = savedFetch;
});

const retained: Omit<Extract<AgentViewState, { kind: "result" }>, "kind"> & {
  operation: { account_id: string };
} = {
  operation: {
    id: "synthetic-action",
    account_id: "owned-account",
    state: "running",
    charged: 0,
    quote: 10,
  },
  report: {
    status: "partial",
    completed: [{ revision: 2, description: "Saved paragraph" }],
    incomplete: ["Pending edit"],
  },
};
let detail: {
  data: typeof retained | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
} = { data: undefined, isPending: false, isFetching: false, isError: true };
let accountId = "owned-account";
let sessionStatus = "authenticated";
let power = { isPending: false, isError: false, data: { mode: "pro" } };
let restoreFailed = false;
let currentEmpty = false;
const restoreRefetch = mock(async () => {});
let capability = {
  isPending: false,
  isError: false,
  data: { available: true, reason: "Unavailable" },
};
const capabilityRefetch = mock(async () => {});
const refetch = mock(async () => {});
mock.module("next-auth/react", () => ({
  useSession: () => ({
    status: sessionStatus,
    data: { user: { id: accountId } },
  }),
}));
const quote = mock(async (): Promise<{ maximum: number; revision: number }> => {
  throw new Error("Retry must not quote a new action");
});
const start = mock(async (_input: unknown) => {
  throw new Error("Retry must not start or debit a new action");
});
const cancel = mock(async () => retained);
const invalidate = async () => {};
mock.module("~/lib/agent/device-panel", () => ({
  DeviceAgentPanel: () => null,
}));
mock.module("~/trpc/react", () => ({
  api: {
    auth: {
      getPowerPreference: {
        useQuery: () => ({ ...power, refetch: async () => {} }),
      },
    },
    useUtils: () => ({
      agentPower: { invalidate },
      pro: { status: { invalidate } },
      entities: { load: { invalidate } },
    }),
    agentPower: {
      capability: {
        useQuery: () => ({ ...capability, refetch: capabilityRefetch }),
      },
      current: {
        useQuery: ({ documentId }: { documentId: string }) => ({
          data:
            !restoreFailed &&
            !currentEmpty &&
            documentId === "synthetic-document"
              ? retained
              : null,
          isPending: false,
          isError: restoreFailed,
          refetch: restoreRefetch,
        }),
      },
      operation: { useQuery: () => ({ ...detail, refetch }) },
      quote: { useMutation: () => ({ mutateAsync: quote }) },
      start: { useMutation: () => ({ mutateAsync: start }) },
      cancel: { useMutation: () => ({ mutateAsync: cancel }) },
    },
  },
}));
const { DocumentAgent } = await import("./document-agent");

test("failed operation read warns about stale progress, retains edits and cancellation, and retries only the read", async () => {
  const view = await render(<DocumentAgent documentId="synthetic-document" />);
  try {
    expect(document.body.textContent).toContain("Saved paragraph");
    expect(document.body.textContent).toContain("Pending edit");
    expect(button("Stop further work")).toBeDefined();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not refresh document action progress. Showing the last known progress.",
    );
    await click(button("Retry progress"));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(quote).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    await click(button("Stop further work"));
    expect(cancel).toHaveBeenCalledWith({ id: "synthetic-action" });
  } finally {
    await view.unmount();
  }
});

test("initial detail read and cached detail refresh are explicit while retained edits and cancellation remain usable", async () => {
  detail = {
    data: undefined,
    isPending: true,
    isFetching: true,
    isError: false,
  };
  const view = await render(<DocumentAgent documentId="synthetic-document" />);
  try {
    expect(document.body.textContent).toContain(
      "Loading document action progress",
    );
    expect(document.body.textContent).toContain("Saved paragraph");
    expect(button("Stop further work")).toBeDefined();
    detail = {
      data: retained,
      isPending: false,
      isFetching: true,
      isError: false,
    };
    await view.rerender(<DocumentAgent documentId="synthetic-document" />);
    expect(document.body.textContent).toContain(
      "Refreshing document action progress",
    );
    expect(document.body.textContent).not.toContain(
      "Loading document action progress",
    );
    detail = { ...detail, isFetching: false };
    await view.rerender(<DocumentAgent documentId="synthetic-document" />);
    expect(document.body.textContent).not.toContain(
      "Refreshing document action progress",
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await view.unmount();
  }
});

test.each(["error", "pending", "unavailable"] as const)(
  "a %s generation capability read keeps owned agent edits and cancellation visible and retries only capability",
  async (kind) => {
    capability = {
      isPending: kind === "pending",
      isError: kind === "error",
      data: { available: kind !== "unavailable", reason: "Unavailable" },
    };
    detail = {
      data: retained,
      isPending: false,
      isFetching: false,
      isError: false,
    };
    const view = await render(
      <DocumentAgent documentId="synthetic-document" />,
    );
    try {
      expect(document.body.textContent).toContain("Saved paragraph");
      expect(document.body.textContent).toContain("Pending edit");
      expect(button("Stop further work")).toBeDefined();
      expect(button("Review maximum")).toBeUndefined();
      expect(button("Accept maximum")).toBeUndefined();
      if (kind === "error") {
        expect(document.querySelector('[role="alert"]')?.textContent).toContain(
          "Could not check document actions",
        );
        await click(button("Retry capability"));
        expect(capabilityRefetch).toHaveBeenCalledTimes(1);
        expect(quote).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
      } else
        expect(
          document.querySelector('[role="status"]')?.textContent,
        ).toContain(
          kind === "pending"
            ? "Checking document action capability"
            : "Unavailable",
        );
      await click(button("Stop further work"));
      expect(cancel).toHaveBeenLastCalledWith({ id: "synthetic-action" });
    } finally {
      await view.unmount();
    }
  },
);

test("account changes never display or cancel another account's cached action", async () => {
  capability = {
    isPending: false,
    isError: true,
    data: { available: true, reason: "Unavailable" },
  };
  const view = await render(<DocumentAgent documentId="synthetic-document" />);
  try {
    expect(document.body.textContent).toContain("Saved paragraph");
    accountId = "other-account";
    await view.rerender(<DocumentAgent documentId="synthetic-document" />);
    expect(document.body.textContent).not.toContain("Saved paragraph");
    expect(document.body.textContent).not.toContain("Pending edit");
    expect(button("Stop further work")).toBeUndefined();
  } finally {
    accountId = "owned-account";
    await view.unmount();
  }
});
test("switching documents clears event-owned action data even when its operation detail remains cached", async () => {
  capability = {
    isPending: false,
    isError: true,
    data: { available: true, reason: "Unavailable" },
  };
  const view = await render(<DocumentAgent documentId="synthetic-document" />);
  try {
    await click(button("Stop further work"));
    expect(document.body.textContent).toContain("Saved paragraph");
    await view.rerender(<DocumentAgent documentId="another-document" />);
    expect(document.body.textContent).not.toContain("Saved paragraph");
    expect(button("Stop further work")).toBeUndefined();
  } finally {
    await view.unmount();
  }
});

test.each(["failed", "pending", "byok", "local"])(
  "outer %s preference keeps owned report and cancellation accessible",
  async (kind) => {
    power = {
      isPending: kind === "pending",
      isError: kind === "failed",
      data: { mode: kind === "local" ? "local" : "byok" },
    };
    const view = await render(
      <DocumentAgent documentId="synthetic-document" />,
    );
    try {
      expect(document.body.textContent).toContain("Saved paragraph");
      expect(button("Stop further work")).toBeDefined();
      expect(button("Review maximum")).toBeUndefined();
      await click(button("Stop further work"));
      expect(cancel).toHaveBeenLastCalledWith({ id: "synthetic-action" });
    } finally {
      await view.unmount();
      power = { isPending: false, isError: false, data: { mode: "pro" } };
    }
  },
);
test("failed restore Try again refetches owned status without admitting new work", async () => {
  capability = {
    isPending: false,
    isError: false,
    data: { available: true, reason: "" },
  };
  restoreFailed = true;
  const view = await render(<DocumentAgent documentId="synthetic-document" />);
  try {
    await click(button("Try again"));
    expect(restoreRefetch).toHaveBeenCalledTimes(1);
    expect(button("Review maximum")).toBeUndefined();
  } finally {
    await view.unmount();
    restoreFailed = false;
  }
});
test("signed-out outer composer provides sign-in guidance instead of permanent loading", async () => {
  sessionStatus = "unauthenticated";
  const view = await render(<DocumentAgent documentId="synthetic-document" />);
  try {
    expect(document.body.textContent).toContain("Sign in");
    expect(document.body.textContent).not.toContain("Checking account access");
  } finally {
    await view.unmount();
    sessionStatus = "authenticated";
  }
});

test("lost cancel reply discloses uncertainty and retains the owned cancellation identity", async () => {
  cancel.mockRejectedValueOnce(new Error("Connection lost"));
  const view = await render(<DocumentAgent documentId="synthetic-document" />);
  try {
    await click(button("Stop further work"));
    expect(document.body.textContent).toContain(
      "Cancellation is not confirmed",
    );
    expect(document.body.textContent).toContain("Saved paragraph");
    expect(button("Stop further work")).toBeDefined();
  } finally {
    await view.unmount();
  }
});
test("lost accepted-start reply shows uncertainty and keeps the same quoted key for explicit retry", async () => {
  currentEmpty = true;
  capability = {
    isPending: false,
    isError: false,
    data: { available: true, reason: "" },
  };
  quote.mockResolvedValueOnce({ maximum: 10, revision: 1 });
  const saved = globalThis.FormData;
  globalThis.FormData = window.FormData;
  const view = await render(<DocumentAgent documentId="synthetic-document" />);
  try {
    const form = document.querySelector("form");
    if (!form) throw Error("Missing action form");
    const text = form.querySelector("textarea");
    if (!text) throw Error("Missing action prompt");
    text.value = "Edit paragraph";
    await act(async () => {
      form.dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await click(button("Accept maximum"));
    expect(document.body.textContent).toContain(
      "Acceptance could not be confirmed",
    );
    const first = start.mock.calls.at(-1)?.[0];
    expect(button("Refresh owned action")).toBeDefined();
    await click(button("Refresh owned action"));
    expect(document.body.textContent).toContain(
      "Acceptance could not be confirmed",
    );
    await click(button("Accept maximum"));
    expect(start.mock.calls.at(-1)?.[0]).toEqual(first);
  } finally {
    await view.unmount();
    currentEmpty = false;
    globalThis.FormData = saved;
  }
});

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

const retained: Omit<Extract<AgentViewState, { kind: "result" }>, "kind"> = {
  operation: {
    id: "synthetic-action",
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
const refetch = mock(async () => {});
const quote = mock(async () => {
  throw new Error("Retry must not quote a new action");
});
const start = mock(async () => {
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
        useQuery: () => ({
          isPending: false,
          isError: false,
          data: { mode: "pro" },
        }),
      },
    },
    useUtils: () => ({
      agentPower: { invalidate },
      pro: { status: { invalidate } },
      entities: { load: { invalidate } },
    }),
    agentPower: {
      capability: {
        useQuery: () => ({
          isPending: false,
          isError: false,
          data: { available: true },
        }),
      },
      current: {
        useQuery: () => ({ data: retained, isPending: false, isError: false }),
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

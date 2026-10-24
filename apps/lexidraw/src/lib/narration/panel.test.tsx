import { afterAll, expect, mock, test } from "bun:test";
import type { RouterOutputs } from "~/trpc/shared";
import { button, click, installDom, render } from "~/test/dom";
import { narrationScreen } from "./query-screen";
import type { AudioPlayerProps } from "~/components/ui/audio-player";
mock.module("~/components/ui/audio-player", () => ({
  AudioPlayer: (props: AudioPlayerProps) => (
    <audio src={props.src} controls>
      <track kind="captions" />
    </audio>
  ),
}));

installDom();
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  mock(async () => {
    throw new Error("Network forbidden");
  }),
  {
    preconnect() {
      throw new Error("Network forbidden");
    },
  },
);
afterAll(() => {
  globalThis.fetch = originalFetch;
});
const job: RouterOutputs["narration"]["operation"] = {
  id: "owned-operation",
  state: "running",
  charged: 0,
  quote: 1000000,
  made: 1,
  planned: 2,
  parts: [{ id: "retained", text: "Saved audio", audio: "AA==", seconds: 1 }],
  policy: "Cancellation stops future steps",
};
const empty = { data: undefined, error: null, isPending: false };
const queries = {
  capability: {
    ...empty,
    data: { available: true, fixture: true, reason: "" },
    error: null as Error | null,
  },
  quote: {
    ...empty,
    data: undefined as RouterOutputs["narration"]["quote"] | undefined,
    error: null as Error | null,
  },
  latest: {
    ...empty,
    data: { id: "owned-operation" },
    error: null as Error | null,
  },
  operation: {
    ...empty,
    data: job,
    error: new Error("Refresh failed") as Error | null,
  },
  saved: {
    ...empty,
    data: { ...job, state: "saved" as const },
    error: null as Error | null,
  },
};
const reads = {
  capability: mock(async () => {}),
  quote: mock(async () => {}),
  latest: mock(async () => {}),
  operation: mock(async () => {}),
  saved: mock(async () => {}),
};
const generate = mock(() => {});
let cancelError: Error | null = null;
const cancel = mock((_input: { id: string }) => {
  cancelError = new Error("Cancellation reply lost");
});
const invalidate = async () => {};
mock.module("~/trpc/react", () => ({
  api: {
    useUtils: () => ({
      narration: { invalidate, quote: { invalidate } },
      pro: { status: { invalidate } },
    }),
    narration: {
      capability: {
        useQuery: () => ({ ...queries.capability, refetch: reads.capability }),
      },
      quote: { useQuery: () => ({ ...queries.quote, refetch: reads.quote }) },
      latest: {
        useQuery: () => ({ ...queries.latest, refetch: reads.latest }),
      },
      operation: {
        useQuery: () => ({ ...queries.operation, refetch: reads.operation }),
      },
      saved: { useQuery: () => ({ ...queries.saved, refetch: reads.saved }) },
      generate: { useMutation: () => ({ isPending: false, mutate: generate }) },
      cancel: {
        useMutation: () => ({
          isPending: false,
          mutate: cancel,
          error: cancelError,
          variables: cancel.mock.calls.at(-1)?.[0],
        }),
      },
    },
  },
}));
const { ProNarrationPanel } = await import("./panel");
test("cached running narration warns about stale progress and retries only its read while preserving audio and cancellation", async () => {
  const mapped = narrationScreen({
    ...queries,
    activity: { kind: "idle" },
    mutating: false,
    operationEnabled: true,
  });
  expect(mapped.kind).toBe("job");
  const view = await render(<ProNarrationPanel documentId="owned-document" />);
  try {
    expect(document.body.textContent).toContain("Narrating · 1 of 2 parts");
    expect(document.querySelector("audio[controls]")?.getAttribute("src")).toBe(
      "data:audio/wav;base64,AA==",
    );
    expect(button("Stop narrating")).toBeDefined();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Showing the last known progress",
    );
    await click(button("Retry progress"));
    expect(reads.operation).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    await click(button("Stop narrating"));
    expect(cancel).toHaveBeenCalledWith({
      id: "owned-operation",
      delivery: "url",
    });
  } finally {
    await view.unmount();
  }
});

test("cached narration reads retain useful content, disclose failures, and never accept generation before a successful refresh", async () => {
  cancelError = null;
  queries.operation.error = null;
  const view = await render(<ProNarrationPanel documentId="owned-document" />);
  try {
    queries.capability.error = new Error("Capability refresh failed");
    queries.latest.error = new Error("Recovery refresh failed");
    await view.rerender(<ProNarrationPanel documentId="owned-document" />);
    expect(document.querySelectorAll('[role="alert"]').length).toBe(2);
    expect(document.querySelector("audio[controls]")).not.toBeNull();
    await click(button("Retry capability"));
    await click(button("Retry latest"));
    expect(reads.capability).toHaveBeenCalledTimes(1);
    expect(reads.latest).toHaveBeenCalledTimes(1);
    await click(button("Saved recording"));
    queries.saved.error = new Error("Saved refresh failed");
    await view.rerender(<ProNarrationPanel documentId="owned-document" />);
    expect(document.querySelector("audio[controls]")).not.toBeNull();
    expect(document.body.textContent).toContain(
      "Showing the last saved recording",
    );
    expect(button("Narrate again")?.disabled).toBe(true);
    await click(button("Retry saved"));
    expect(reads.saved).toHaveBeenCalledTimes(1);
    queries.capability.error = null;
    queries.latest.error = null;
    queries.saved.error = null;
    await view.rerender(<ProNarrationPanel documentId="owned-document" />);
    queries.quote.data = {
      periodId: "period",
      maximum: 12950000,
      missing: 1,
      cached: 1,
      maxSeconds: 240,
      revision: "revision",
      version: "private-narration-2026-10-v1",
      policy: "Technical failures return credits",
    };
    await click(button("Narrate again"));
    queries.quote.error = new Error("Quote refresh failed");
    await view.rerender(<ProNarrationPanel documentId="owned-document" />);
    expect(document.body.textContent).toContain(
      "2 parts · up to 4 min · 1 already made",
    );
    expect(button("Start · up to 12.95 credits")?.disabled).toBe(true);
    await click(button("Start · up to 12.95 credits"));
    await click(button("Retry quote"));
    expect(reads.quote).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    queries.quote.error = null;
    queries.capability.error = new Error("Unknown capability");
    await view.rerender(<ProNarrationPanel documentId="owned-document" />);
    expect(button("Start · up to 12.95 credits")?.disabled).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

test("failed owned narration cancellation remains visible with retained audio and read/cancel retries", async () => {
  cancelError = null;
  queries.operation.error = null;
  queries.capability.error = null;
  queries.latest.error = null;
  queries.quote.error = null;
  queries.saved.error = null;
  const before = generate.mock.calls.length;
  const view = await render(<ProNarrationPanel documentId="owned-document" />);
  try {
    await click(button("Stop narrating"));
    await view.rerender(<ProNarrationPanel documentId="owned-document" />);
    expect(document.body.textContent).toContain("Stop not confirmed yet");
    expect(document.querySelector("audio[controls]")).not.toBeNull();
    await click(button("Refresh cancellation status"));
    expect(button("Stop narrating")).toBeDefined();
    expect(generate.mock.calls.length).toBe(before);
  } finally {
    await view.unmount();
  }
});

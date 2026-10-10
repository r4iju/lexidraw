import { expect, test } from "bun:test";
import { narrationScreen } from "./query-screen";
import type { RouterOutputs } from "~/trpc/shared";
const empty = { data: undefined, error: null, isPending: false };
const ready = {
  activity: { kind: "idle" as const },
  mutating: false,
  operationEnabled: false,
  capability: {
    ...empty,
    data: { available: true as const, fixture: true, reason: "" },
  },
  quote: empty,
  latest: { ...empty, data: null },
  operation: empty,
  saved: empty,
};
test("initial narration query failures and pending recovery never look ready", () => {
  expect(
    narrationScreen({ ...ready, capability: { ...empty, isPending: true } }),
  ).toMatchObject({ kind: "busy" });
  expect(
    narrationScreen({ ...ready, latest: { ...empty, isPending: true } }),
  ).toMatchObject({ kind: "busy" });
  expect(
    narrationScreen({
      ...ready,
      capability: { ...empty, error: new Error("Capability failed") },
    }),
  ).toMatchObject({ kind: "error", message: "Capability failed" });
  expect(
    narrationScreen({
      ...ready,
      latest: { ...empty, error: new Error("Recovery failed") },
    }),
  ).toMatchObject({ kind: "error", message: "Recovery failed" });
  expect(
    narrationScreen({
      ...ready,
      operationEnabled: true,
      operation: { ...empty, isPending: true },
    }),
  ).toMatchObject({ kind: "busy" });
  expect(narrationScreen(ready)).toEqual({ kind: "idle" });
});
test("generation unavailability does not hide a recovered job or saved recording", () => {
  const job: RouterOutputs["narration"]["operation"] = {
    id: "op",
    state: "unknown",
    charged: 0,
    quote: 1,
    made: 0,
    planned: 1,
    parts: [],
    policy: "Recover",
  };
  const unavailable = {
    ...ready,
    capability: {
      ...empty,
      data: {
        available: false as const,
        fixture: false,
        reason: "Unavailable",
      },
    },
  };
  expect(
    narrationScreen({
      ...unavailable,
      operationEnabled: true,
      operation: { ...empty, data: job },
    }),
  ).toMatchObject({ kind: "job", job });
  expect(
    narrationScreen({
      ...unavailable,
      activity: { kind: "saved" },
      saved: { ...empty, data: { ...job, state: "saved" } },
    }),
  ).toMatchObject({ kind: "job", job: { ...job, state: "saved" } });
});

test.each(["operation", "saved", "latest", "capability", "quote"] as const)(
  "cached %s failure remains explicit in query mapping without discarding retained content",
  (query) => {
    const job: RouterOutputs["narration"]["operation"] = {
      id: "op",
      state: "running",
      charged: 0,
      quote: 1,
      made: 1,
      planned: 2,
      parts: [
        { id: "part", text: "Retained audio", audio: "AA==", seconds: 1 },
      ],
      policy: "Stop future steps",
    };
    const quote = {
      periodId: "p",
      maximum: 1000000,
      missing: 1,
      cached: 1,
      maxSeconds: 240,
      revision: "r",
      version: "private-narration-2026-10-v1",
      policy: "Trial",
    };
    const input = {
      ...ready,
      operationEnabled: true,
      operation: { ...empty, data: job },
      saved: { ...empty, data: { ...job, state: "saved" as const } },
      quote: { ...empty, data: quote },
    };
    const screen = narrationScreen({
      ...input,
      activity:
        query === "quote"
          ? { kind: "quote", key: "key" }
          : query === "saved"
            ? { kind: "saved" }
            : { kind: "idle" },
      [query]: { ...input[query], error: new Error("Refresh failed") },
    });
    expect(screen.kind).toBe(query === "quote" ? "quote" : "job");
    expect(screen).toHaveProperty(
      "readErrors",
      expect.arrayContaining([expect.objectContaining({ query })]),
    );
    expect(screen).toHaveProperty("generationBlocked", true);
  },
);

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
  ).toEqual({ kind: "busy" });
  expect(
    narrationScreen({ ...ready, latest: { ...empty, isPending: true } }),
  ).toEqual({ kind: "busy" });
  expect(
    narrationScreen({
      ...ready,
      capability: { ...empty, error: new Error("Capability failed") },
    }),
  ).toEqual({ kind: "error", message: "Capability failed" });
  expect(
    narrationScreen({
      ...ready,
      latest: { ...empty, error: new Error("Recovery failed") },
    }),
  ).toEqual({ kind: "error", message: "Recovery failed" });
  expect(
    narrationScreen({
      ...ready,
      operationEnabled: true,
      operation: { ...empty, isPending: true },
    }),
  ).toEqual({ kind: "busy" });
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
  ).toEqual({ kind: "job", job });
  expect(
    narrationScreen({
      ...unavailable,
      activity: { kind: "saved" },
      saved: { ...empty, data: { ...job, state: "saved" } },
    }),
  ).toEqual({ kind: "job", job: { ...job, state: "saved" } });
});

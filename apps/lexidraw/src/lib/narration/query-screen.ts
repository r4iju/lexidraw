import type { UseQueryResult } from "@tanstack/react-query";
import type { RouterOutputs } from "~/trpc/shared";
import type { NarrationScreen } from "./ui";
export type NarrationActivity =
  | { kind: "idle" }
  | { kind: "quote"; key: string }
  | { kind: "job"; id: string }
  | { kind: "saved" };
type Query<T> = Pick<
  UseQueryResult<T, Pick<Error, "message">>,
  "data" | "error" | "isPending"
>;
export function narrationScreen({
  activity,
  mutating,
  capability,
  quote,
  latest,
  operation,
  saved,
  operationEnabled,
}: {
  activity: NarrationActivity;
  mutating: boolean;
  capability: Query<RouterOutputs["narration"]["capability"]>;
  quote: Query<RouterOutputs["narration"]["quote"]>;
  latest: Query<RouterOutputs["narration"]["latest"]>;
  operation: Query<RouterOutputs["narration"]["operation"]>;
  saved: Query<RouterOutputs["narration"]["saved"]>;
  operationEnabled: boolean;
}): NarrationScreen {
  let screen: NarrationScreen;
  if (mutating) screen = { kind: "busy" };
  else if (activity.kind === "quote")
    screen = quote.error
      ? { kind: "error", message: quote.error.message }
      : quote.data
        ? { kind: "quote", quote: quote.data }
        : { kind: "busy" };
  else if (activity.kind === "saved")
    screen = saved.error
      ? { kind: "error", message: saved.error.message }
      : saved.data
        ? { kind: "job", job: saved.data }
        : { kind: "busy" };
  else if (operation.data) screen = { kind: "job", job: operation.data };
  else if (operation.error)
    screen = { kind: "error", message: operation.error.message };
  else if (operationEnabled && operation.isPending) screen = { kind: "busy" };
  else if (latest.error)
    screen = { kind: "error", message: latest.error.message };
  else if (latest.isPending) screen = { kind: "busy" };
  else if (capability.error)
    screen = { kind: "error", message: capability.error.message };
  else if (capability.isPending) screen = { kind: "busy" };
  else if (capability.data?.available === false)
    screen = { kind: "unavailable", message: capability.data.reason };
  else screen = { kind: "idle" };
  return screen;
}

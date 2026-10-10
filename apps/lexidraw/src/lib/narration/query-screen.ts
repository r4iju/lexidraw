import type { UseQueryResult } from "@tanstack/react-query";
import type { RouterOutputs } from "~/trpc/shared";
import type { NarrationRead, NarrationScreen } from "./ui";
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
    screen = quote.data
      ? { kind: "quote", quote: quote.data }
      : quote.error
        ? { kind: "error", message: quote.error.message }
        : { kind: "busy" };
  else if (activity.kind === "saved")
    screen = saved.data
      ? { kind: "job", job: saved.data }
      : saved.error
        ? { kind: "error", message: saved.error.message }
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
  const reads: {
    query: NarrationRead;
    enabled: boolean;
    error: Query<unknown>["error"];
    cached: boolean;
    label: string;
    retained: string;
  }[] = [
    {
      query: "capability",
      enabled: true,
      error: capability.error,
      cached: !!capability.data,
      label: "narration capability",
      retained: "Generation availability is unknown.",
    },
    {
      query: "latest",
      enabled: true,
      error: latest.error,
      cached: latest.data !== undefined,
      label: "the latest narration",
      retained: "Showing the last known recording and progress.",
    },
    {
      query: "operation",
      enabled: operationEnabled,
      error: operation.error,
      cached: !!operation.data,
      label: "narration progress",
      retained: "Showing the last known progress.",
    },
    {
      query: "quote",
      enabled: activity.kind === "quote",
      error: quote.error,
      cached: !!quote.data,
      label: "the narration quote",
      retained: "Showing the last quote. Refresh before accepting.",
    },
    {
      query: "saved",
      enabled: activity.kind === "saved",
      error: saved.error,
      cached: !!saved.data,
      label: "saved narration",
      retained: "Showing the last saved recording.",
    },
  ];
  const readErrors = reads
    .filter((read) => read.enabled && read.error)
    .map((read) => ({
      query: read.query,
      message: `Could not ${read.cached ? "refresh" : "load"} ${read.label}. ${read.cached ? read.retained : "Retry the read before starting a new action."}`,
    }));
  // Cached capability data is useful for display, never permission to spend after a failed read.
  const generationBlocked =
    !!capability.error ||
    capability.isPending ||
    capability.data?.available !== true ||
    readErrors.length > 0;
  return {
    ...screen,
    ...(readErrors.length ? { readErrors } : {}),
    ...(generationBlocked ? { generationBlocked: true as const } : {}),
  };
}

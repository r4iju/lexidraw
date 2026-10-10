import type { UseQueryResult } from "@tanstack/react-query";
export type QueryAccess<T> =
  | { kind: "disabled" }
  | { kind: "loading"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: T };
export function queryAccess<T>(
  query: Pick<
    UseQueryResult<T, Pick<Error, "message">>,
    "data" | "error" | "isPending"
  >,
  enabled: boolean,
  label: string,
): QueryAccess<T> {
  if (!enabled) return { kind: "disabled" };
  if (query.error)
    return {
      kind: "error",
      message: `${label} could not be loaded. Retry before starting a new action.`,
    };
  if (query.isPending || query.data === undefined)
    return { kind: "loading", message: `Loading ${label}…` };
  return { kind: "ready", data: query.data };
}

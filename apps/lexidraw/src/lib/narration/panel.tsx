"use client";
import { useState } from "react";
import { api } from "~/trpc/react";
import { NarrationView } from "./view";
import type { NarrationScreen } from "./ui";
type Activity =
  | { kind: "idle" }
  | { kind: "quote"; key: string }
  | { kind: "job"; id: string }
  | { kind: "saved" };
export function ProNarrationPanel({ documentId }: { documentId: string }) {
  const [activity, setActivity] = useState<Activity>({ kind: "idle" });
  const utils = api.useUtils();
  const capability = api.narration.capability.useQuery();
  const quote = api.narration.quote.useQuery(
    { documentId },
    { enabled: activity.kind === "quote", retry: false },
  );
  const latest = api.narration.latest.useQuery(
    { documentId },
    { retry: false },
  );
  const id = activity.kind === "job" ? activity.id : latest.data?.id;
  const operation = api.narration.operation.useQuery(
    { id: id ?? "" },
    {
      enabled: !!id && activity.kind !== "quote" && activity.kind !== "saved",
      retry: false,
      refetchInterval: (q) =>
        ["running", "reserved"].includes(q.state.data?.state ?? "")
          ? 1000
          : false,
    },
  );
  const saved = api.narration.saved.useQuery(
    { documentId },
    { enabled: activity.kind === "saved", retry: false },
  );
  const generate = api.narration.generate.useMutation({
    onSuccess: async (job) => {
      setActivity(job.id ? { kind: "job", id: job.id } : { kind: "saved" });
      await Promise.all([
        utils.narration.invalidate(),
        utils.pro.status.invalidate(),
      ]);
    },
  });
  const cancel = api.narration.cancel.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.narration.invalidate(),
        utils.pro.status.invalidate(),
      ]);
    },
  });
  let screen: NarrationScreen;
  if (generate.isPending || cancel.isPending) screen = { kind: "busy" };
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
  else if (capability.data?.available === false)
    screen = { kind: "unavailable", message: capability.data.reason };
  else screen = { kind: "idle" };
  return (
    <div>
      {generate.error && (
        <p role="alert">
          {generate.error.message} Retry acceptance to recover the same action.
        </p>
      )}
      <NarrationView
        screen={screen}
        onQuote={() => {
          setActivity({ kind: "quote", key: crypto.randomUUID() });
          void utils.narration.quote.invalidate({ documentId });
        }}
        onAccept={() => {
          if (activity.kind === "quote" && quote.data)
            generate.mutate({
              documentId,
              idempotencyKey: activity.key,
              acceptedMaximum: quote.data.maximum,
              acceptedRevision: quote.data.revision,
              acceptedPeriod: quote.data.periodId,
            });
        }}
        onCancel={() => {
          if (id) cancel.mutate({ id });
        }}
        onSaved={() => setActivity({ kind: "saved" })}
      />
    </div>
  );
}

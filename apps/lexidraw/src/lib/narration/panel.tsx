"use client";
import { Button } from "~/components/ui/button";
import { useState } from "react";
import { api } from "~/trpc/react";
import { NarrationView } from "./view";
import { narrationScreen, type NarrationActivity } from "./query-screen";
export function ProNarrationPanel({ documentId }: { documentId: string }) {
  const [activity, setActivity] = useState<NarrationActivity>({ kind: "idle" });
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
  const operationEnabled =
    !!id && activity.kind !== "quote" && activity.kind !== "saved";
  const operation = api.narration.operation.useQuery(
    { id: id ?? "", delivery: "url" },
    {
      enabled: operationEnabled,
      retry: false,
      refetchInterval: (q) =>
        ["running", "reserved"].includes(q.state.data?.state ?? "")
          ? 3000
          : false,
    },
  );
  const saved = api.narration.saved.useQuery(
    { documentId, delivery: "url" },
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
  const screen = narrationScreen({
    activity,
    mutating: generate.isPending || cancel.isPending,
    capability,
    quote,
    latest,
    operation,
    saved,
    operationEnabled,
  });
  return (
    <div>
      {cancel.error &&
        cancel.variables?.id === id &&
        ["reserved", "running", "unknown"].includes(
          operation.data?.state ?? "",
        ) && (
          <p role="alert">
            Cancellation is not confirmed. Further work may still be running;
            retained audio remains available.
            <Button
              type="button"
              variant="outline"
              onClick={() => void operation.refetch()}
            >
              Refresh cancellation status
            </Button>
          </p>
        )}
      {generate.error && (
        <p role="alert">
          {generate.error.message} Retry acceptance to recover the same action.
        </p>
      )}
      {screen.readErrors?.map((notice) => (
        <div key={notice.query} role="alert">
          <p>{notice.message}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void { capability, quote, latest, operation, saved }[
                notice.query
              ].refetch()
            }
          >
            Retry {notice.query === "operation" ? "progress" : notice.query}
          </Button>
        </div>
      ))}
      <NarrationView
        screen={screen}
        onQuote={() => {
          if (screen.generationBlocked) return;
          setActivity({ kind: "quote", key: crypto.randomUUID() });
          void utils.narration.quote.invalidate({ documentId });
        }}
        onAccept={() => {
          if (
            !screen.generationBlocked &&
            activity.kind === "quote" &&
            quote.data
          )
            generate.mutate({
              documentId,
              delivery: "url",
              idempotencyKey: activity.key,
              acceptedMaximum: quote.data.maximum,
              acceptedRevision: quote.data.revision,
              acceptedPeriod: quote.data.periodId,
            });
        }}
        onCancel={() => {
          if (id) cancel.mutate({ id, delivery: "url" });
        }}
        onSaved={() => setActivity({ kind: "saved" })}
      />
    </div>
  );
}

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
    <NarrationView
      notices={
        <>
          {cancel.error &&
            cancel.variables?.id === id &&
            ["reserved", "running", "unknown"].includes(
              operation.data?.state ?? "",
            ) && (
              <p role="alert" className="text-sm">
                Stop not confirmed yet; made parts are kept.{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => void operation.refetch()}
                >
                  Refresh cancellation status
                </Button>
              </p>
            )}
          {generate.error && (
            <p role="alert" className="text-sm">
              {generate.error.message} Start again to retry the same request.
            </p>
          )}
          {screen.readErrors?.map((notice) => (
            <p key={notice.query} role="alert" className="text-sm">
              {notice.message}{" "}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                onClick={() =>
                  void { capability, quote, latest, operation, saved }[
                    notice.query
                  ].refetch()
                }
              >
                Retry {notice.query === "operation" ? "progress" : notice.query}
              </Button>
            </p>
          ))}
        </>
      }
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
      onDismiss={() => setActivity({ kind: "idle" })}
      onCancel={() => {
        if (id) cancel.mutate({ id, delivery: "url" });
      }}
      onSaved={() => setActivity({ kind: "saved" })}
    />
  );
}

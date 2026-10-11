"use client";
import { DeviceAgentPanel } from "~/lib/agent/device-panel";
import { Button } from "~/components/ui/button";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "~/trpc/react";
import { AgentActionView, type AgentViewState } from "~/lib/agent/action-view";
import { AgentInput } from "~/lib/agent/contracts";
import type { AgentInput as Input } from "~/lib/agent/contracts";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "~/server/api/root";
type Result = inferRouterOutputs<AppRouter>["agentPower"]["start"];
type Activity =
  | { kind: "ready"; restore: boolean }
  | { kind: "busy" }
  | { kind: "quote"; input: Input }
  | { kind: "acceptanceUncertain"; input: Input }
  | { kind: "result"; result: Result; cancellation: "current" | "uncertain" }
  | { kind: "error"; reason: string };
export function DocumentAgent({ documentId }: { documentId: string }) {
  const session = useSession();
  const power = api.auth.getPowerPreference.useQuery(undefined, {
    enabled: session.status === "authenticated",
  });
  if (session.status === "loading") return <p>Checking account access...</p>;
  if (session.status !== "authenticated")
    return <p>Sign in to read or run document actions.</p>;
  const selected =
    !power.isPending && !power.isError && power.data?.mode === "pro";
  return (
    <>
      {power.isPending ? (
        <p>Checking AI power...</p>
      ) : power.isError ? (
        <p role="alert">
          Could not check AI power.{" "}
          <Button onClick={() => void power.refetch()}>Retry AI power</Button>
        </p>
      ) : power.data.mode === "byok" ? (
        <DeviceAgentPanel documentId={documentId} />
      ) : power.data.mode === "local" ? (
        <p>Document actions are unavailable with built-in local AI.</p>
      ) : null}
      <ProDocumentAgent
        key={JSON.stringify([session.data.user.id, documentId])}
        accountId={session.data.user.id}
        documentId={documentId}
        generationSelected={selected}
      />
    </>
  );
}

function ProDocumentAgent({
  documentId,
  accountId,
  generationSelected,
}: {
  documentId: string;
  accountId: string;
  generationSelected: boolean;
}) {
  const utils = api.useUtils();
  const [activity, setActivity] = useState<Activity>({
    kind: "ready",
    restore: true,
  });
  const capability = api.agentPower.capability.useQuery();
  const invalidate = () =>
    Promise.all([
      utils.agentPower.invalidate(),
      utils.pro.status.invalidate(),
      utils.entities.load.invalidate(),
    ]);
  const quote = api.agentPower.quote.useMutation({ onSettled: invalidate });
  const start = api.agentPower.start.useMutation({ onSettled: invalidate });
  const cancel = api.agentPower.cancel.useMutation({ onSettled: invalidate });
  const current = api.agentPower.current.useQuery(
    { documentId },
    {
      enabled:
        (activity.kind === "ready" && activity.restore) ||
        activity.kind === "acceptanceUncertain",
    },
  );
  const candidate =
    activity.kind === "result"
      ? activity.result
      : activity.kind === "acceptanceUncertain"
        ? current.data?.operation.idempotency_key ===
          activity.input.idempotencyKey
          ? current.data
          : null
        : activity.kind === "ready" && activity.restore
          ? current.data
          : null;
  const result =
    candidate?.operation.account_id === accountId ? candidate : null;
  const operation = api.agentPower.operation.useQuery(
    { id: result?.operation.id ?? "" },
    {
      enabled: !!result,
      refetchInterval: (query) =>
        ["reserved", "running"].includes(
          query.state.data?.operation.state ?? result?.operation.state ?? "",
        )
          ? 1000
          : false,
    },
  );
  const detail =
    operation.data?.operation.account_id === accountId &&
    operation.data.operation.id === result?.operation.id
      ? operation.data
      : null;
  const generationAllowed =
    generationSelected &&
    !capability.isPending &&
    !capability.isError &&
    capability.data?.available === true;
  const state: AgentViewState = result
    ? { kind: "result", ...(detail ?? result) }
    : activity.kind === "ready" && activity.restore && current.isPending
      ? { kind: "busy" }
      : activity.kind === "ready" && activity.restore && current.isError
        ? {
            kind: "error",
            reason: "Could not restore the document action. Try again.",
          }
        : activity.kind === "busy" || activity.kind === "error"
          ? activity
          : activity.kind === "quote" || activity.kind === "acceptanceUncertain"
            ? { kind: activity.kind, maximum: activity.input.acceptedMaximum }
            : !generationSelected
              ? {
                  kind: "unavailable",
                  reason:
                    "Select Pro to start a new Pro action. Owned work remains available.",
                }
              : capability.isPending
                ? { kind: "busy" }
                : capability.isError
                  ? {
                      kind: "error",
                      reason: "Could not check document actions.",
                    }
                  : !capability.data?.available
                    ? {
                        kind: "unavailable",
                        reason:
                          capability.data?.reason ??
                          "Document action capability is unknown.",
                      }
                    : { kind: "ready" };
  function retry() {
    if (activity.kind === "ready" && activity.restore && current.isError) {
      void current.refetch();
      return;
    }
    if (capability.isError) {
      void capability.refetch();
      return;
    }
    setActivity({ kind: "ready", restore: true });
  }

  async function submit(prompt: string) {
    if (!generationAllowed) return;
    setActivity({ kind: "busy" });
    try {
      const result = await quote.mutateAsync({ documentId, prompt });
      setActivity({
        kind: "quote",
        input: AgentInput.parse({
          documentId,
          prompt,
          revision: result.revision,
          acceptedMaximum: result.maximum,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
    } catch {
      setActivity({
        kind: "error",
        reason:
          "Could not quote this document action. Check Pro access, save the document and try again.",
      });
    }
  }
  async function accept() {
    if (
      !generationAllowed ||
      (activity.kind !== "quote" && activity.kind !== "acceptanceUncertain")
    )
      return;
    const input = activity.input;
    setActivity({ kind: "busy" });
    try {
      setActivity({
        kind: "result",
        result: await start.mutateAsync(input),
        cancellation: "current",
      });
    } catch {
      setActivity({ kind: "acceptanceUncertain", input });
    }
  }
  async function stop() {
    if (state.kind !== "result" || !result) return;
    try {
      setActivity({
        kind: "result",
        result: await cancel.mutateAsync({ id: state.operation.id }),
        cancellation: "current",
      });
    } catch {
      if (state.kind === "result")
        setActivity({
          kind: "result",
          result: detail ?? result,
          cancellation: "uncertain",
        });
      await invalidate();
    }
  }
  return (
    <>
      {activity.kind === "acceptanceUncertain" && (
        <Button
          onClick={() => void current.refetch()}
          pending={current.isFetching}
        >
          Refresh owned action
        </Button>
      )}
      {activity.kind === "result" && activity.cancellation === "uncertain" && (
        <p role="alert">
          Cancellation is not confirmed. Further work may still be running.
          Refresh progress before assuming it stopped.
        </p>
      )}
      {!generationAllowed && (
        <div
          className="space-y-2 p-4"
          role={capability.isError ? "alert" : "status"}
        >
          <p>
            {capability.isError
              ? "Could not check document actions. Generation availability is unknown; retained progress is shown below."
              : capability.isPending
                ? "Checking document action capability. Retained progress is shown below."
                : (capability.data?.reason ??
                  "Document action capability is unknown.")}
          </p>
          {capability.isError && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void capability.refetch()}
            >
              Retry capability
            </Button>
          )}
        </div>
      )}
      {state.kind === "result" && operation.isError && (
        <div className="space-y-2 p-4">
          <p role="alert">
            Could not refresh document action progress. Showing the last known
            progress.
          </p>
          <Button
            onClick={() => void operation.refetch()}
            pending={operation.isFetching}
          >
            Retry progress
          </Button>
        </div>
      )}
      {state.kind === "result" &&
        !operation.isError &&
        (operation.isPending || operation.isFetching) && (
          <p className="p-4" role="status">
            {operation.data
              ? "Refreshing document action progress. Showing the last known progress."
              : "Loading document action progress. Showing the last known progress."}
          </p>
        )}
      <AgentActionView
        state={state}
        onSubmit={(prompt) => void submit(prompt)}
        onAccept={() => void accept()}
        onCancel={() => void stop()}
        onRetry={retry}
        onDecline={() => setActivity({ kind: "ready", restore: false })}
      />
    </>
  );
}

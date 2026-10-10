"use client";
import { DeviceAgentPanel } from "~/lib/agent/device-panel";
import { useState } from "react";
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
  | { kind: "result"; result: Result }
  | { kind: "error"; reason: string };
export function DocumentAgent({ documentId }: { documentId: string }) {
  const power = api.auth.getPowerPreference.useQuery();
  if (power.isPending) return <p>Checking AI power...</p>;
  if (power.isError) return <p>Could not check AI power.</p>;
  if (power.data.mode === "byok")
    return <DeviceAgentPanel documentId={documentId} />;
  if (power.data.mode !== "pro")
    return <p>Document actions are unavailable with built-in local AI.</p>;
  return <ProDocumentAgent documentId={documentId} />;
}
function ProDocumentAgent({ documentId }: { documentId: string }) {
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
        activity.kind === "ready" &&
        activity.restore &&
        capability.data?.available === true,
    },
  );
  const result =
    activity.kind === "result"
      ? activity.result
      : activity.kind === "ready" && activity.restore
        ? current.data
        : null;
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
  const state: AgentViewState = capability.isPending
    ? { kind: "busy" }
    : capability.isError
      ? { kind: "error", reason: "Could not check document actions." }
      : !capability.data.available
        ? { kind: "unavailable", reason: capability.data.reason }
        : activity.kind === "quote"
          ? { kind: "quote", maximum: activity.input.acceptedMaximum }
          : result
            ? { kind: "result", ...(operation.data ?? result) }
            : activity.kind === "ready" && activity.restore && current.isPending
              ? { kind: "busy" }
              : activity.kind === "ready" && activity.restore && current.isError
                ? {
                    kind: "error",
                    reason: "Could not restore the document action. Try again.",
                  }
                : activity.kind === "error" || activity.kind === "busy"
                  ? activity
                  : { kind: "ready" };
  async function submit(prompt: string) {
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
    if (activity.kind !== "quote") return;
    const input = activity.input;
    setActivity({ kind: "busy" });
    try {
      setActivity({ kind: "result", result: await start.mutateAsync(input) });
    } catch {
      setActivity({ kind: "quote", input });
    }
  }
  async function stop() {
    if (state.kind !== "result") return;
    try {
      setActivity({
        kind: "result",
        result: await cancel.mutateAsync({ id: state.operation.id }),
      });
    } catch {
      await invalidate();
    }
  }
  return (
    <AgentActionView
      state={state}
      onSubmit={(prompt) => void submit(prompt)}
      onAccept={() => void accept()}
      onCancel={() => void stop()}
      onDecline={() => setActivity({ kind: "ready", restore: false })}
    />
  );
}

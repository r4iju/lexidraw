"use client";
import type { FormEvent } from "react";
import type { RouterOutputs } from "~/trpc/shared";
import type { Report } from "./contracts";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
export type AgentViewState =
  | { kind: "ready" }
  | { kind: "unavailable"; reason: string }
  | { kind: "busy" }
  | { kind: "error"; reason: string }
  | { kind: "quote" | "acceptanceUncertain"; maximum: number }
  | {
      kind: "result";
      operation: Pick<
        RouterOutputs["agentPower"]["start"]["operation"],
        "id" | "state" | "charged" | "quote"
      >;
      report: Report;
    };
export function AgentActionView({
  state,
  onSubmit,
  onAccept,
  onDecline,
  onCancel,
  onRetry = onDecline,
}: {
  state: AgentViewState;
  onSubmit: (prompt: string) => void;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onRetry?: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = new FormData(event.currentTarget).get("prompt");
    if (typeof prompt === "string") onSubmit(prompt);
  }
  return (
    <section className="space-y-4 p-4" aria-label="Pro document action">
      <h2 className="font-semibold">Pro document action</h2>
      <p>
        One action covers planning, decisions, generation and supported paid
        search. Saved edits remain if an action stops. Technical failures return
        the reservation. Cancellation stops further paid work; a fully completed
        action is charged. Uncertain outcomes remain reserved.
      </p>
      <p>
        Images and sandbox delegation are unavailable. Public Pro is Coming
        soon.
      </p>
      {state.kind === "ready" && (
        <form onSubmit={submit} className="space-y-3">
          <Textarea
            name="prompt"
            aria-label="Document action"
            required
            maxLength={1500}
            placeholder="Describe the edits"
          />
          <Button type="submit">Review maximum</Button>
        </form>
      )}
      {state.kind === "unavailable" && <p role="status">{state.reason}</p>}
      {state.kind === "error" && (
        <>
          <p role="alert">{state.reason}</p>
          <Button onClick={onRetry}>Try again</Button>
        </>
      )}
      {state.kind === "busy" && (
        <p role="status">Checking or running the document action...</p>
      )}
      {(state.kind === "quote" || state.kind === "acceptanceUncertain") && (
        <div>
          <p>
            Maximum reservation: {state.maximum / 1_000_000} credits. Final
            consumption can be lower. This maximum includes all supported paid
            steps.
          </p>
          {state.kind === "acceptanceUncertain" ? (
            <p role="alert">
              Acceptance could not be confirmed. This quoted identity is
              retained. An explicit retry uses the same identity; no automatic
              new action was started.
            </p>
          ) : (
            <Button onClick={onDecline}>Decline</Button>
          )}
          <Button onClick={onAccept}>Accept maximum</Button>
        </div>
      )}
      {state.kind === "result" && (
        <div className="space-y-3" role="status">
          <p>
            Action: {state.report.status}. Charged{" "}
            {state.operation.charged / 1_000_000} credits.
          </p>
          {state.report.reason && <p>{state.report.reason}</p>}
          <h3>Saved edits</h3>
          {state.report.completed.length ? (
            <ul>
              {state.report.completed.map((edit) => (
                <li key={edit.revision}>{edit.description}</li>
              ))}
            </ul>
          ) : (
            <p>No edits saved.</p>
          )}
          <h3>Incomplete edits</h3>
          {state.report.incomplete.length ? (
            <ul>
              {Array.from(new Set(state.report.incomplete)).map((edit) => (
                <li key={edit}>{edit}</li>
              ))}
            </ul>
          ) : (
            <p>No incomplete edits.</p>
          )}
          {["reserved", "running", "unknown"].includes(
            state.operation.state,
          ) && <Button onClick={onCancel}>Stop further work</Button>}
          {!["reserved", "running", "unknown"].includes(
            state.operation.state,
          ) && <Button onClick={onDecline}>New action</Button>}
        </div>
      )}
    </section>
  );
}

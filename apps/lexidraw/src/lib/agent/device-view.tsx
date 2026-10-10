import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Label } from "~/components/ui/label";
import type { AgentCheckpoint } from "./device-core";
import { DEVICE_AGENT_UNAVAILABLE } from "./device-core";
export function DeviceAgentView({
  checkpoint,
  available,
  keyAvailable,
  onStart,
  onResume,
  onStop,
  onNewAction,
}: {
  checkpoint: AgentCheckpoint | null;
  available: boolean;
  keyAvailable: boolean;
  onStart(prompt: string): void;
  onResume(): void;
  onStop(): void;
  onNewAction?(): void;
}) {
  return (
    <section aria-label="Device document action">
      <h2>My OpenRouter document action</h2>
      <p>
        Planning and tools run on this device. Keep it open while working. No
        Pro credits are used. Your provider may charge an interrupted request.
        Saved edits remain if work stops.
      </p>
      <p>
        Search and sandbox delegation are unavailable. Images await verified
        provider access and bounds.
      </p>
      {!available && <p>{DEVICE_AGENT_UNAVAILABLE}</p>}
      {checkpoint ? (
        <>
          <p>
            Action: {checkpoint.status}. {checkpoint.receipts.length} saved
            edits.
          </p>
          {checkpoint.reason && <p role="status">{checkpoint.reason}</p>}
          <h3>Saved edits</h3>
          {checkpoint.receipts.length ? (
            <ul>
              {checkpoint.receipts.map((receipt) => (
                <li key={receipt.revision}>{receipt.description}</li>
              ))}
            </ul>
          ) : (
            <p>No edits saved.</p>
          )}
          <h3>Incomplete edits</h3>
          {checkpoint.plan.length <= checkpoint.receipts.length && (
            <p>No incomplete edits.</p>
          )}
          <ul>
            {checkpoint.plan
              .slice(checkpoint.receipts.length)
              .map((description, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: A planned edit has a fixed slot for the lifetime of this action.
                <li key={`${description}:${index}`}>{description}</li>
              ))}
          </ul>
          {checkpoint.status === "unknown" ? (
            <p>
              A provider request may have been charged. It will not be repeated
              automatically.
            </p>
          ) : (
            !["complete", "blocked", "running"].includes(checkpoint.status) && (
              <Button
                type="button"
                onClick={onResume}
                disabled={
                  checkpoint.phase !== "mutation" &&
                  (!available || !keyAvailable)
                }
              >
                {checkpoint.phase === "mutation"
                  ? "Retry retained edit"
                  : "Resume on this device"}
              </Button>
            )
          )}
          {["complete", "blocked"].includes(checkpoint.status) &&
            !checkpoint.pending &&
            !checkpoint.fence && (
              <Button type="button" onClick={onNewAction}>
                Start a new action
              </Button>
            )}
          {checkpoint.status === "running" && (
            <Button type="button" onClick={onStop}>
              Stop further work
            </Button>
          )}
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("prompt");
            if (typeof value === "string") onStart(value);
          }}
        >
          <Label htmlFor="device-action-prompt">Describe the edits </Label>
          <Textarea
            id="device-action-prompt"
            name="prompt"
            maxLength={1500}
            required
          />
          <Button type="submit" disabled={!available || !keyAvailable}>
            Run on this device
          </Button>
        </form>
      )}
    </section>
  );
}

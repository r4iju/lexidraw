import { Button } from "~/components/ui/button";
import type { NarrationScreen } from "./ui";
export function NarrationView({
  screen,
  onQuote,
  onAccept,
  onCancel,
  onSaved,
}: {
  screen: NarrationScreen;
  onQuote: () => void;
  onAccept: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  return (
    <section aria-label="Pro narration" className="space-y-3">
      <h3 className="font-medium">Pro narration</h3>
      {screen.kind === "busy" && <p role="status">Preparing narration…</p>}
      {(screen.kind === "unavailable" || screen.kind === "error") && (
        <p role="status">{screen.message}</p>
      )}
      {screen.kind === "idle" && (
        <p>
          Review a quote before generating cloud audio. Saved recordings play
          without generation credits.
        </p>
      )}
      {screen.kind === "quote" && (
        <>
          <p>
            {screen.quote.missing} parts need synthesis; {screen.quote.cached}{" "}
            parts are retained. Audio is bounded to{" "}
            {Math.ceil(screen.quote.maxSeconds / 60)} minutes.
          </p>
          <p>{screen.quote.policy}</p>
          <Button onClick={onAccept}>
            Accept maximum {(screen.quote.maximum / 1_000_000).toFixed(3)}{" "}
            credits
          </Button>
        </>
      )}
      {screen.kind === "job" && (
        <>
          <p role="status">
            {screen.job.made} of {screen.job.planned} parts ready.{" "}
            {screen.job.state === "unknown"
              ? "Provider outcome is uncertain. Credits remain reserved until reconciliation. No new request will be sent."
              : screen.job.state === "refunded"
                ? "Generation failed. All reserved credits were returned; completed parts are retained."
                : screen.job.state === "cancelled"
                  ? "Generation cancelled. Completed parts are retained."
                  : screen.job.state === "settled" ||
                      screen.job.state === "saved"
                    ? "Saved recording. Replay is free."
                    : "Generating audio…"}
          </p>
          <p>{screen.job.policy}</p>
          {screen.job.parts.map((part, i) => (
            <div key={part.id}>
              <p id={`transcript-${part.id}`}>{part.text}</p>
              {/* biome-ignore lint/a11y/useMediaCaption: The complete narration transcript is visible directly above each audio control. */}
              <audio
                aria-label={`Narration part ${i + 1}`}
                aria-describedby={`transcript-${part.id}`}
                controls
                preload="metadata"
                src={`data:audio/wav;base64,${part.audio}`}
              />
            </div>
          ))}
          {["running", "reserved"].includes(screen.job.state) && (
            <Button variant="outline" onClick={onCancel}>
              Cancel generation
            </Button>
          )}
          {["refunded", "cancelled"].includes(screen.job.state) && (
            <Button onClick={onQuote}>Review retry quote</Button>
          )}
        </>
      )}
      {screen.kind !== "busy" && (
        <div className="flex gap-2">
          <Button variant="outline" onClick={onSaved}>
            Play saved narration
          </Button>
          {(screen.kind === "idle" ||
            screen.kind === "error" ||
            (screen.kind === "job" &&
              ["saved", "settled"].includes(screen.job.state))) && (
            <Button variant="outline" onClick={onQuote}>
              Review narration quote
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

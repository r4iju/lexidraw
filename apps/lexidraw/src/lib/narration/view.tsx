import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { PartsPlayer } from "./parts-player";
import type { NarrationScreen } from "./ui";

type Job = Extract<NarrationScreen, { kind: "job" }>["job"];

const credits = (subcredits: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(
    subcredits / 1_000_000,
  );

/** What a job's state means to the listener, in a few words. */
function jobStatus(job: Job) {
  switch (job.state) {
    case "settled":
    case "saved":
      return "Ready · replay is free";
    case "cancelled":
      return `Stopped · ${job.made} of ${job.planned} parts kept`;
    case "refunded":
      return "Failed · all reserved credits returned";
    case "unknown":
      return "Provider outcome uncertain · credits reserved until reconciliation";
    default:
      return `Narrating · ${job.made} of ${job.planned} parts`;
  }
}

/** Terms behind the numbers, there for whoever wants them. */
function Terms({ children }: { children: string }) {
  return (
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer select-none">Billing details</summary>
      <p className="mt-1">{children}</p>
    </details>
  );
}

export function NarrationView({
  screen,
  notices,
  onQuote,
  onAccept,
  onDismiss,
  onCancel,
  onSaved,
}: {
  screen: NarrationScreen;
  /** Failed reads and actions, shown under the heading. */
  notices?: ReactNode;
  onQuote: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const blocked = screen.generationBlocked;
  return (
    <section aria-label="Pro narration" className="space-y-3">
      <h3 className="text-sm font-medium">Pro narration</h3>
      {notices}
      {screen.kind === "busy" && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Preparing…
        </p>
      )}
      {(screen.kind === "unavailable" || screen.kind === "error") && (
        <p role="status" className="text-sm text-muted-foreground">
          {screen.message}
        </p>
      )}
      {screen.kind === "quote" && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <p className="text-sm">
            {screen.quote.missing + screen.quote.cached} parts · up to{" "}
            {Math.ceil(screen.quote.maxSeconds / 60)} min
            {screen.quote.cached > 0 &&
              ` · ${screen.quote.cached} already made`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onAccept} disabled={blocked}>
              Start · up to {credits(screen.quote.maximum)} credits
            </Button>
            <Button variant="ghost" onClick={onDismiss}>
              Not now
            </Button>
          </div>
          <Terms>{screen.quote.policy}</Terms>
        </div>
      )}
      {screen.kind === "job" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p role="status" className="text-sm">
              {jobStatus(screen.job)}
            </p>
            {["running", "reserved"].includes(screen.job.state) && (
              <Progress
                className="h-1.5"
                value={
                  (screen.job.made / Math.max(1, screen.job.planned)) * 100
                }
                aria-label="Narration progress"
              />
            )}
          </div>
          <PartsPlayer
            label="Pro narration recording"
            more={["running", "reserved"].includes(screen.job.state)}
            parts={screen.job.parts.map((part) => ({
              id: part.id,
              text: part.text,
              src: part.url ?? `data:audio/wav;base64,${part.audio}`,
            }))}
          />
          <div className="flex flex-wrap gap-2">
            {["running", "reserved"].includes(screen.job.state) && (
              <Button variant="outline" onClick={onCancel}>
                Stop narrating
              </Button>
            )}
            {["refunded", "cancelled"].includes(screen.job.state) && (
              <Button onClick={onQuote} disabled={blocked}>
                Try again
              </Button>
            )}
            {["saved", "settled"].includes(screen.job.state) && (
              <Button variant="ghost" onClick={onQuote} disabled={blocked}>
                Narrate again
              </Button>
            )}
            {screen.job.state !== "saved" && (
              <Button variant="ghost" onClick={onSaved}>
                Saved recording
              </Button>
            )}
          </div>
          <Terms>{screen.job.policy}</Terms>
        </div>
      )}
      {(screen.kind === "idle" || screen.kind === "error") && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onQuote} disabled={blocked}>
            Narrate this document
          </Button>
          <Button variant="ghost" onClick={onSaved}>
            Saved recording
          </Button>
        </div>
      )}
    </section>
  );
}

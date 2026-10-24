import type { DeviceCheckpoint, RecordingArtifact } from "./device-contracts";
import { DEVICE_NARRATION_POLICY } from "./portable";
import { Button } from "~/components/ui/button";
import { PartsPlayer } from "./parts-player";

export function RecordingControls({
  recording,
  label = "Device recording",
}: {
  recording: RecordingArtifact;
  label?: string;
}) {
  return (
    <PartsPlayer
      label={label}
      parts={recording.parts.map((part, index) => ({
        id: String(index),
        text: part.text,
        src: `data:${recording.mimeType};base64,${part.audio}`,
      }))}
    />
  );
}

/**
 * Narration made in this browser with the account's own OpenRouter key. It
 * shows nothing while that is unavailable and nothing was started here.
 */
export function DeviceNarrationView({
  checkpoint,
  capabilityKnown = true,
  available,
  keyAvailable,
  onStart,
  onResume,
  onSync,
}: {
  checkpoint: DeviceCheckpoint | null;
  capabilityKnown?: boolean;
  available: boolean;
  keyAvailable: boolean;
  onStart: () => void;
  onResume: () => void;
  onSync: () => void;
}) {
  if (!checkpoint && !(capabilityKnown && available)) return null;
  const completed =
    checkpoint?.parts.flatMap((p) =>
      p.kind === "completed"
        ? [{ text: p.text, audio: p.audio, seconds: p.seconds }]
        : [],
    ) ?? [];
  const unknown = checkpoint?.parts.some(
    (p) => p.kind === "unknown" || p.kind === "started",
  );
  const all = !!checkpoint && completed.length === checkpoint.parts.length;
  return (
    <section aria-label="Device narration" className="space-y-3">
      <h3 className="text-sm font-medium">Your OpenRouter key</h3>
      {checkpoint && (
        <p className="text-sm">
          {completed.length} of {checkpoint.parts.length} parts on this device
          {checkpoint.status === "saved" && " · saved to your account"}
        </p>
      )}
      {unknown && (
        <p role="status" className="text-sm text-muted-foreground">
          One part's outcome is uncertain and may still be billed. It won't be
          repeated automatically.
        </p>
      )}
      {checkpoint?.status === "running" && (
        <p role="status" className="text-sm">
          Generating in the foreground…
        </p>
      )}
      {checkpoint?.status === "paused" && !all && !unknown && (
        <p role="status" className="text-sm text-muted-foreground">
          Paused. Each Resume runs up to 20 minutes; made parts are kept.
        </p>
      )}
      {!keyAvailable && !all && (
        <p className="text-sm text-muted-foreground">
          <a
            href="/settings#settings-ai-power"
            className="underline underline-offset-2"
          >
            Add your key
          </a>{" "}
          on this device to generate.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!checkpoint && (
          <Button disabled={!available || !keyAvailable} onClick={onStart}>
            Narrate on this device
          </Button>
        )}
        {checkpoint && !all && !unknown && checkpoint.status !== "running" && (
          <Button disabled={!available || !keyAvailable} onClick={onResume}>
            Resume generation
          </Button>
        )}
        {all && checkpoint?.status !== "saved" && (
          <Button disabled={checkpoint?.status === "syncing"} onClick={onSync}>
            {checkpoint?.status === "sync_failed"
              ? "Retry sync"
              : checkpoint?.status === "syncing"
                ? "Syncing…"
                : "Sync completed recording"}
          </Button>
        )}
      </div>
      {completed.length > 0 && (
        <RecordingControls
          recording={{ mimeType: "audio/wav", parts: completed }}
        />
      )}
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer select-none">How this works</summary>
        <p className="mt-1">{DEVICE_NARRATION_POLICY}</p>
      </details>
    </section>
  );
}

import type { DeviceCheckpoint, RecordingArtifact } from "./device-contracts";
import {
  DEVICE_NARRATION_POLICY,
  DEVICE_NARRATION_UNAVAILABLE,
} from "./portable";
import { Button } from "~/components/ui/button";
export function RecordingControls({
  recording,
}: {
  recording: RecordingArtifact;
}) {
  return (
    <div>
      {recording.parts.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Completed recording parts have an immutable order.
        <div key={index}>
          <p>{part.text}</p>
          {/* biome-ignore lint/a11y/useMediaCaption: The complete transcript is immediately above each audio control. */}
          <audio
            aria-label={`Recording part ${index + 1}`}
            controls
            preload="none"
            src={`data:audio/wav;base64,${part.audio}`}
          />
        </div>
      ))}
    </div>
  );
}
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
      <h3>My OpenRouter narration</h3>
      <p>{DEVICE_NARRATION_POLICY}</p>
      {capabilityKnown && !available && <p>{DEVICE_NARRATION_UNAVAILABLE}</p>}
      {!keyAvailable && (
        <p>
          Set up your key on this device before generating or resuming. Sync and
          playback do not need it.
        </p>
      )}
      {!checkpoint && (
        <Button disabled={!available || !keyAvailable} onClick={onStart}>
          Generate on this device
        </Button>
      )}
      {checkpoint && (
        <p>
          {completed.length} of {checkpoint.parts.length} parts retained on this
          device.{" "}
          {checkpoint.status === "saved"
            ? "Saved to your account. Playback is free."
            : "Unfinished or unsynced work is local only."}
        </p>
      )}
      {unknown && (
        <p role="status">
          Provider outcome uncertain. The request may still be billed. No
          automatic repeat will occur. Check the original provider result before
          recovering this part.
        </p>
      )}
      {checkpoint?.status === "running" && (
        <p role="status">Generating in the foreground…</p>
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
      {completed.length > 0 && (
        <RecordingControls
          recording={{ mimeType: "audio/wav", parts: completed }}
        />
      )}
    </section>
  );
}

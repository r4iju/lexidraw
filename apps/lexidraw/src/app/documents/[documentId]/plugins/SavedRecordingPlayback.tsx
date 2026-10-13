import { AudioPlayer } from "~/components/ui/audio-player";
import type { SavedRecordingProjection } from "~/lib/narration/saved-recording";

export type SavedAudioScreen =
  | SavedRecordingProjection
  | { kind: "loading" }
  | { kind: "read-error" };

export function SavedRecordingPlayback({
  documentId,
  screen,
}: {
  documentId: string;
  screen: SavedAudioScreen;
}) {
  switch (screen.kind) {
    case "none":
      return null;
    case "loading":
      return <p role="status">Loading saved recording…</p>;
    case "read-error":
      return <p role="alert">Saved recording could not be refreshed.</p>;
    case "stop":
      return <p role="alert">Saved recording could not be read safely.</p>;
    case "saved-recording":
      return (
        <section aria-label="Existing saved recording" className="space-y-2">
          <h4 className="font-medium">Existing saved recording</h4>
          <p className="text-sm text-muted-foreground">
            Original recording transcript
          </p>
          <AudioPlayer
            key={JSON.stringify([documentId, screen.audioUrl])}
            src={screen.audioUrl}
            autoPlay={false}
            className="min-w-xs"
          />
          <p className="whitespace-pre-wrap text-sm">{screen.text}</p>
        </section>
      );
  }
}

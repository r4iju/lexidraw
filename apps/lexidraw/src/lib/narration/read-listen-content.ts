import { listenContent } from "./listen-content";
import type { SavedRecordingProjection } from "./saved-recording";
export type DocumentRecordingBytes = Readonly<{
  raw: unknown;
  storageType: unknown;
}>;
export async function readListenContent<
  Generated extends { segments: readonly unknown[]; stitchedUrl?: string },
>(
  readDocument: () => Promise<DocumentRecordingBytes | undefined>,
  readGenerated: () => Promise<Generated>,
): Promise<Generated & { savedRecording: SavedRecordingProjection }> {
  const [document, generated] = await Promise.all([
    readDocument(),
    readGenerated(),
  ]);
  return listenContent(generated, document?.raw, document?.storageType);
}

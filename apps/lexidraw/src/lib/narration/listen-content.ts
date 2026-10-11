import { projectSavedRecording } from "./saved-recording";

export function listenContent<
  Generated extends { segments: readonly unknown[]; stitchedUrl?: string },
>(generated: Generated, raw: unknown, storageType: unknown) {
  return {
    ...generated,
    savedRecording: projectSavedRecording(raw, storageType),
  };
}

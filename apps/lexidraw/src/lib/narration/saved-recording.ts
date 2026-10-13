import { assertSupportedLegacyAudioV1 } from "../../../../../packages/drizzle/src/document-payload-v1";
import { assertSupportedPersistedEditorRootV1 } from "./persisted-editor-root-v1";
import { normalizeDocumentBytes } from "../document-payload";
import { z } from "zod";

export const SavedRecording = z
  .object({
    kind: z.literal("saved-recording"),
    text: z.string().refine((value) => value.trim().length > 0),
    audioUrl: z.string().refine((value) => value.trim().length > 0),
  })
  .strict()
  .readonly();
export type SavedRecording = z.infer<typeof SavedRecording>;
export const SavedRecordingProjection = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("none") })
    .strict()
    .readonly(),
  SavedRecording,
  z
    .object({
      kind: z.literal("stop"),
      reason: z.enum([
        "corrupt-payload",
        "unsupported-payload",
        "unsupported-tts",
      ]),
    })
    .strict()
    .readonly(),
]);
export type SavedRecordingProjection = z.infer<typeof SavedRecordingProjection>;

/** Read-only classification, preserving the stored transcript and URL verbatim. */
export function projectSavedRecording(
  raw: unknown,
  storageType: unknown,
): SavedRecordingProjection {
  let envelope: unknown;
  try {
    envelope = JSON.parse(normalizeDocumentBytes(raw, storageType).text);
  } catch {
    return { kind: "stop", reason: "corrupt-payload" };
  }
  try {
    assertSupportedPersistedEditorRootV1(envelope);
  } catch {
    return { kind: "stop", reason: "unsupported-payload" };
  }
  const parsed = z.record(z.string(), z.unknown()).parse(envelope);
  if (!Object.hasOwn(parsed, "tts")) return { kind: "none" };
  try {
    assertSupportedLegacyAudioV1(parsed.tts);
  } catch {
    return { kind: "stop", reason: "unsupported-tts" };
  }
  const audio = z
    .object({ text: z.string(), audioUrl: z.string() })
    .strict()
    .parse(parsed.tts);
  const recording = SavedRecording.safeParse({
    kind: "saved-recording",
    ...audio,
  });
  return recording.success
    ? recording.data
    : { kind: "stop", reason: "unsupported-tts" };
}

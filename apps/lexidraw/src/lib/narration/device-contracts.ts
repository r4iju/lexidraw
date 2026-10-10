import { CredentialFingerprints } from "../byok/session";
import { z } from "zod";
import { imagePromptBytes } from "../images/format";
import { validateWav } from "./portable";
export const DevicePart = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("pending"),
    text: z.string().min(1).max(1000),
  }),
  z.strictObject({
    kind: z.literal("started"),
    text: z.string().min(1).max(1000),
  }),
  z.strictObject({
    kind: z.literal("unknown"),
    text: z.string().min(1).max(1000),
  }),
  z.strictObject({
    kind: z.literal("completed"),
    text: z.string().min(1).max(1000),
    audio: z.string().max(7_680_060),
    seconds: z.number().positive().max(120),
  }),
]);
export const DeviceCheckpoint = z
  .strictObject({
    fingerprints: CredentialFingerprints.default([]),
    version: z.literal(1),
    account: z.string().min(1).max(100),
    documentId: z.string().min(1).max(100),
    id: z.string().min(1).max(100),
    created: z.number().int().nonnegative(),
    status: z.enum([
      "paused",
      "running",
      "unknown",
      "completed",
      "syncing",
      "sync_failed",
      "saved",
    ]),
    parts: z.array(DevicePart).min(1).max(8),
  })
  .refine(
    (value) =>
      imagePromptBytes(value.parts.map((p) => p.text).join("")) <= 6000,
    "Document exceeds narration bounds",
  );
export type DeviceCheckpoint = z.infer<typeof DeviceCheckpoint>;
export const RecordingArtifact = z
  .strictObject({
    mimeType: z.literal("audio/wav"),
    parts: z
      .array(
        z.strictObject({
          text: z.string().min(1).max(1000),
          audio: z.string().min(1).max(7_680_060),
          seconds: z.number().positive().max(120),
        }),
      )
      .min(1)
      .max(8),
  })
  .refine(
    (value) =>
      imagePromptBytes(value.parts.map((p) => p.text).join("")) <= 6000,
    "Document exceeds narration bounds",
  );
export type RecordingArtifact = z.infer<typeof RecordingArtifact>;
export const SaveRecording = z.strictObject({
  idempotencyKey: z.string().min(1).max(100),
  documentId: z.string().min(1).max(100),
  recording: RecordingArtifact,
});
export function validateRecording(
  value: unknown,
  check: (text: string) => void = () => {},
) {
  const recording = RecordingArtifact.parse(value);
  check(JSON.stringify(recording));
  for (const part of recording.parts) {
    const { seconds } = validateWav(part.audio, check);
    if (seconds !== part.seconds) throw new Error("Invalid audio duration");
  }
  return recording;
}

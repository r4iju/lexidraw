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
const checkpointFields = {
  fingerprints: CredentialFingerprints.default([]),
  version: z.literal(1),
  account: z.string().min(1).max(100),
  documentId: z.string().min(1).max(100),
  id: z.string().min(1).max(100),
  uploadKey: z.string().min(1).max(100).optional(),
  created: z.number().int().nonnegative(),
};
const CompletedPart = DevicePart.options[3];
const completedParts = z.array(CompletedPart).min(1).max(8);
export const DeviceCheckpoint = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...checkpointFields,
      status: z.enum(["paused", "running", "unknown"]),
      parts: z.array(DevicePart).min(1).max(8),
    }),
    z.strictObject({
      ...checkpointFields,
      status: z.enum(["completed", "syncing", "sync_failed"]),
      parts: completedParts,
    }),
    z.strictObject({
      ...checkpointFields,
      status: z.literal("saved"),
      parts: completedParts,
      recordingId: z.string().min(1).max(100),
    }),
  ])
  .refine(
    (value) =>
      imagePromptBytes(value.parts.map((p) => p.text).join("")) <= 6000,
    "Document exceeds narration bounds",
  );
export type DeviceCheckpoint = z.infer<typeof DeviceCheckpoint>;
const LegacyCheckpoint = z.strictObject({
  ...checkpointFields,
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
});
export function restoreDeviceCheckpoint(input: unknown): DeviceCheckpoint {
  const parsed = DeviceCheckpoint.safeParse(input);
  if (parsed.success) return parsed.data;
  const legacy = LegacyCheckpoint.parse(input);
  const parts = legacy.parts.map((p) =>
    p.kind === "started" ? { ...p, kind: "unknown" as const } : p,
  );
  const status = parts.some((p) => p.kind === "unknown")
    ? "unknown"
    : parts.every((p) => p.kind === "completed")
      ? "sync_failed"
      : "paused";
  return DeviceCheckpoint.parse({
    ...legacy,
    uploadKey: legacy.uploadKey ?? legacy.id,
    status,
    parts,
  });
}
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

/** Where a part's audio is kept: by its hash, so any run in the voice reuses it. */
export function chunkPathOf(
  chunkHash: string,
  format: "mp3" | "ogg" | "wav",
): string {
  const stored = process.env.TTS_STITCH_WITH_FFMPEG === "true" ? "wav" : format;
  return `tts/chunks/${chunkHash}.${stored}`;
}

/**
 * Where a run publishes the parts it will make, before it makes any. Each run
 * writes its own once, so no reader is served one that is out of date; the
 * job's `segmentCount` says how many of them, from the start, are made.
 */
export function planPathOf(key: string, runId: string): string {
  return `tts/plans/${key}/${runId}.json`;
}

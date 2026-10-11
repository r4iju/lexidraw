// Preserve import compatibility for old workers without retaining a transport.
export function legacySpeechUnavailable(): never {
  throw new Error(
    "Legacy speech generation is unavailable. Use AI Power. Saved recordings remain free to play.",
  );
}

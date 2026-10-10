import "server-only";
import type { TtsProvider } from "../types";

// Preserve import compatibility for old workers without retaining a transport.
export function createKokoroTtsProvider(
  _legacyConfiguration?: string | null,
): TtsProvider {
  throw new Error(
    "Legacy speech generation is unavailable. Use AI Power. Saved recordings remain free to play.",
  );
}

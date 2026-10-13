import "server-only";
import type { TtsProvider } from "../types";
import { legacySpeechUnavailable } from "./legacy-unavailable";

export function createGeminiTtsProvider(
  _legacyConfiguration?: string | null,
): TtsProvider {
  return legacySpeechUnavailable();
}

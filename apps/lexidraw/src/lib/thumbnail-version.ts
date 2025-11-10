import "server-only";
import { createHash } from "node:crypto";

/**
 * Compute thumbnail version hash from entity elements and appState.
 * This version is used to determine if a thumbnail needs regeneration.
 *
 * @param elements - JSON string of entity elements
 * @param appState - JSON string of app state (can be null/undefined)
 * @returns MD5 hash hex string
 */
export function computeThumbnailVersion(
  elements: string,
  appState: string | null | undefined,
): string {
  return createHash("md5")
    .update(
      JSON.stringify({
        elements,
        appState: appState ?? "",
      }),
    )
    .digest("hex");
}

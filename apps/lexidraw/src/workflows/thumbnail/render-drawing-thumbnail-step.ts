import "server-only";

import { renderDrawingThumbnail } from "~/server/drawings/render";
import type { CanonicalElement } from "~/server/drawings/skeleton-schema";

/**
 * A drawing's thumbnail in one theme, drawn from its stored scene by the same
 * export the render endpoint uses, as a PNG.
 */
export async function renderDrawingThumbnailStep(
  elements: string,
  appState: string | null,
  theme: "light" | "dark",
): Promise<Uint8Array> {
  "use step";

  const { png } = await renderDrawingThumbnail(parseScene(elements), {
    theme,
    background: backgroundOf(appState),
  });
  return png;
}

function parseScene(elements: string): CanonicalElement[] {
  try {
    const parsed: unknown = JSON.parse(elements);
    return Array.isArray(parsed) ? (parsed as CanonicalElement[]) : [];
  } catch {
    return [];
  }
}

function backgroundOf(appState: string | null): string | null {
  try {
    const parsed: unknown = JSON.parse(appState ?? "null");
    const colour =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { viewBackgroundColor?: unknown }).viewBackgroundColor
        : null;
    return typeof colour === "string" ? colour : null;
  } catch {
    return null;
  }
}

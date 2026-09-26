import "server-only";

import { loadDrawingFiles } from "~/server/drawings/files";
import { renderDrawingThumbnail } from "~/server/drawings/render";
import type { CanonicalElement } from "~/server/drawings/skeleton-schema";

/**
 * A drawing's thumbnails, light and dark, drawn from its stored scene by the
 * same export the render endpoint uses, as PNGs.
 */
export async function renderDrawingThumbnailsStep(
  drawingId: string,
  elements: string,
  appState: string | null,
): Promise<[light: Uint8Array, dark: Uint8Array]> {
  "use step";

  const scene = parseScene(elements);
  const files = await loadDrawingFiles(drawingId, scene);
  const background = backgroundOf(appState);
  const render = async (theme: "light" | "dark") =>
    (await renderDrawingThumbnail(scene, { theme, background, files })).png;
  return Promise.all([render("light"), render("dark")]);
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

/** What of a view decides which part of a scene is on screen. */
export type View = {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
};

/**
 * Screen pixels kept between the content and the edge, where the canvas
 * controls float: content closer to an edge than this is not in view.
 */
const PADDING = 48;
/** Excalidraw's own floor for zoom. */
const MIN_ZOOM = 0.1;

/**
 * Where a drawing opens: where it was left while all of its content is in
 * view clear of the edges, otherwise centred on the content at the zoom that fits it, never
 * past 100%. `bounds` is the content's [minX, minY, maxX, maxY] in scene
 * coordinates, null for an empty drawing.
 */
export function fitOnOpen(
  bounds: readonly [number, number, number, number] | null,
  view: View,
): Pick<View, "scrollX" | "scrollY" | "zoom"> | null {
  if (!bounds?.every(Number.isFinite)) return null;
  const [minX, minY, maxX, maxY] = bounds;
  const inset = PADDING / view.zoom;
  const left = -view.scrollX + inset;
  const top = -view.scrollY + inset;
  const inView =
    minX >= left &&
    minY >= top &&
    maxX <= left + view.width / view.zoom - 2 * inset &&
    maxY <= top + view.height / view.zoom - 2 * inset;
  if (inView) return null;

  const room = (size: number) => Math.max(size - 2 * PADDING, 1);
  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(
      1,
      room(view.width) / Math.max(maxX - minX, 1),
      room(view.height) / Math.max(maxY - minY, 1),
    ),
  );
  return {
    zoom,
    scrollX: view.width / (2 * zoom) - (minX + maxX) / 2,
    scrollY: view.height / (2 * zoom) - (minY + maxY) / 2,
  };
}

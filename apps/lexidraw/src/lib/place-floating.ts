type Rect = { top: number; left: number; width: number; height: number };
type Size = { width: number; height: number };
type Bounds = { top: number; left: number; right: number; bottom: number };
type Side = "above" | "below";

/**
 * Where a floating toolbar or menu of `size` goes next to `target`: on the
 * preferred side unless only the other has room, and always inside `bounds`
 * less `margin`, all in viewport coordinates.
 */
export function placeFloating(
  target: Rect,
  size: Size,
  bounds: Bounds,
  {
    side: preferred,
    align = "center",
    gap = 10,
    margin = 8,
  }: { side: Side; align?: "center" | "start"; gap?: number; margin?: number },
): { left: number; top: number; side: Side } {
  const above = target.top - gap - size.height;
  const below = target.top + target.height + gap;
  const fitsAbove = above >= bounds.top;
  const fitsBelow = below + size.height <= bounds.bottom;
  let side = preferred;
  if (preferred === "above" && !fitsAbove && fitsBelow) side = "below";
  if (preferred === "below" && !fitsBelow && fitsAbove) side = "above";

  const wanted =
    align === "center"
      ? target.left + target.width / 2 - size.width / 2
      : target.left;
  const left = Math.max(
    bounds.left + margin,
    Math.min(wanted, bounds.right - margin - size.width),
  );
  return { left, top: side === "above" ? above : below, side };
}

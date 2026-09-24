/**
 * How many of the toolbar's groups, in priority order, fit in `available`
 * pixels. Room for the More button is kept only once something overflows.
 */
export function fitGroups(
  widths: readonly number[],
  available: number,
  moreWidth: number,
): number {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return widths.length;
  let used = moreWidth;
  let fits = 0;
  for (const width of widths) {
    if (used + width > available) break;
    used += width;
    fits++;
  }
  return fits;
}

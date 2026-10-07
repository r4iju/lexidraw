const FR = /^(\d*\.?\d+)fr$/;

const rounded = (value: number) => Math.round(value * 100) / 100;

/**
 * Each column's share of the row: a template of plain `fr` tracks as it
 * reads, and any other as the columns' measured `widths`, so a hand-set
 * template keeps its look when a split first moves.
 */
export function shares(template: string, widths: readonly number[]) {
  const tracks = template.trim().split(/\s+/);
  const parsed = tracks.map((track) => FR.exec(track)?.[1]);
  if (tracks.length === widths.length && parsed.every(Boolean))
    return parsed.map(Number);
  const average = widths.reduce((sum, width) => sum + width, 0) / widths.length;
  return widths.map((width) => rounded(width / average));
}

/**
 * The split after column `index` moved to `fraction` of that column and
 * the next together, no nearer either edge than `minimum`; the other
 * columns keep their shares.
 */
export function moveSplit(
  current: readonly number[],
  index: number,
  fraction: number,
  minimum: number,
) {
  const pair = (current[index] ?? 0) + (current[index + 1] ?? 0);
  const left = rounded(
    pair * Math.min(Math.max(fraction, minimum), 1 - minimum),
  );
  return current.map((share, at) =>
    at === index ? left : at === index + 1 ? rounded(pair - left) : share,
  );
}

/** Shares as a template the columns node stores. */
export function template(current: readonly number[]) {
  return current.map((share) => `${share}fr`).join(" ");
}

/** Where the split after column `index` sits, as a percent of the pair. */
export function splitValue(current: readonly number[], index: number) {
  const left = current[index] ?? 0;
  const pair = left + (current[index + 1] ?? 0);
  return pair ? Math.round((100 * left) / pair) : 50;
}

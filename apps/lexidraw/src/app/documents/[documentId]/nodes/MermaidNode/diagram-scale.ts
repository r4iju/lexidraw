/** The least text size a shrunk diagram may show, in CSS pixels. */
const LEAST_TEXT = 11;
/** The text size Mermaid is given for every diagram. */
export const DIAGRAM_TEXT = 14;
/**
 * Kinds whose smallest text is not the diagram text: a pie labels its
 * slices and legend at 17px, and a gantt its axis at 10px (and it is laid
 * out for its column already).
 */
const SMALLEST_TEXT: Record<string, number> = { pie: 17, gantt: 10 };

/**
 * How far a diagram of a kind (its drawing's aria-roledescription) may
 * shrink to fit its column: until its smallest text reaches 11px. Past that
 * it scrolls instead.
 */
export function leastScale(kind: string) {
  return Math.min(1, LEAST_TEXT / (SMALLEST_TEXT[kind] ?? DIAGRAM_TEXT));
}

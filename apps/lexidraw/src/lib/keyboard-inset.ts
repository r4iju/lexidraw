/**
 * How much of the layout viewport's bottom the on-screen keyboard covers.
 * Browsers that resize the layout viewport for the keyboard report none, so
 * whatever sits at `bottom: var(--keyboard-inset)` lands on it either way.
 */
export function keyboardInset(
  innerHeight: number,
  viewport: { height: number; offsetTop: number } | undefined,
) {
  if (!viewport) return 0;
  return Math.max(
    0,
    Math.round(innerHeight - viewport.height - viewport.offsetTop),
  );
}

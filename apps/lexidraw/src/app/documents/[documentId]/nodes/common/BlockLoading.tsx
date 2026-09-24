/**
 * Stands in for a block while its component loads. Marked busy, so a print or
 * screenshot waits for the block instead of capturing the gap it leaves.
 */
export function BlockLoading() {
  return <span aria-busy="true" />;
}

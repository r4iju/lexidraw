/**
 * `load`, run once and shared by every caller until it fails; the next
 * caller after a failure runs it again, so one failed fetch does not stay
 * failed for as long as the page is open.
 */
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () => {
    loading ??= load().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };
}

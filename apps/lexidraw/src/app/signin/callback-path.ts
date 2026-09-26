const FALLBACK = "/dashboard";
const BASE = "https://lexidraw.invalid";

/**
 * The same-site path a `callbackUrl` asks to return to after signing in, or
 * the dashboard. The value is resolved the way a browser would resolve it,
 * so `//host`, `/\host` and stray whitespace cannot turn it into another site.
 */
export function callbackPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return FALLBACK;
  try {
    const url = new URL(value, BASE);
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Dot segments can normalise to `//host`, which is another site again.
    if (url.origin !== BASE || new URL(path, BASE).origin !== BASE) {
      return FALLBACK;
    }
    return path;
  } catch {
    return FALLBACK;
  }
}

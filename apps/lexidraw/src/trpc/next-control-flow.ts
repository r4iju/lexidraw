import { unstable_rethrow } from "next/navigation";

/**
 * Whether an error is Next steering the render (a redirect, `notFound`, or a
 * prerender ending while `headers()` was pending) rather than a failure. Next
 * handles these itself, so they are not worth a log line.
 */
export function isNextControlFlow(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

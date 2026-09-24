import { unstable_rethrow } from "next/navigation";

/**
 * Whether an error, or one in its `cause` chain, is Next's control flow (a
 * redirect, `notFound`, or a prerender ending while `headers()` was pending)
 * rather than a failure worth a log line.
 */
export function isNextControlFlow(error: unknown): boolean {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

/**
 * For a page's `.catch` on the call that loads what it shows: an entity that is
 * missing, or not the caller's to see, renders the 404 page instead of a server
 * error. Any other failure propagates unchanged.
 */
export function notFoundOr(error: unknown): never {
  if (isNotFound(error)) notFound();
  throw error;
}

function isNotFound(error: unknown): boolean {
  for (let e = error; e instanceof Error; e = e.cause) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") return true;
  }
  return false;
}

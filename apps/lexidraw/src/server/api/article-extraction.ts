import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Refused } from "~/server/net/public-fetch";

/** A URL a caller may ask the article extractor to read. */
export const articleUrl = z.url({ protocol: /^https?$/ });

/**
 * Rethrows a URL the extractor refused as the caller's mistake, and any
 * other failure, a site that is down or slow among them, as it came.
 */
export function refusedAsBadRequest(error: unknown): never {
  if (error instanceof Refused)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
      cause: error,
    });
  throw error;
}

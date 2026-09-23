import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";

import { StaleDocumentError } from "~/server/documents/conflict";
import { AmbiguousHeadingError } from "~/server/documents/markdown";
import { API_ERROR_STATUS, type ApiErrorCode } from "./error-codes";

/**
 * What a failure carries beyond its code and message, derived from the `cause`
 * the procedure threw with. Both formatters read it from here, so a caller
 * that branches on `currentUpdatedAt` over REST branches on the same field,
 * spelled the same way, over MCP.
 */
export function errorCauseData(cause: unknown): {
  currentUpdatedAt: string | null;
  candidates: AmbiguousHeadingError["candidates"] | null;
} {
  return {
    // ISO so a conflict reads the same over tRPC, REST, and the CLI.
    currentUpdatedAt:
      cause instanceof StaleDocumentError
        ? cause.currentUpdatedAt.toISOString()
        : null,
    // The headings an ambiguous insert could have meant, so a caller can
    // pick an `nth` without parsing the message.
    candidates:
      cause instanceof AmbiguousHeadingError ? cause.candidates : null,
  };
}

/**
 * The error body `/api/v1` answers with: `{ message, code, issues?, data? }`
 * with `code` drawn from {@link API_ERROR_STATUS}. REST gets this shape from
 * the OpenAPI adapter; transports that call the router directly, such as MCP,
 * build it here so an agent parses one error shape whichever way it came in.
 */
export type ApiErrorBody = {
  message: string;
  code: ApiErrorCode;
  issues?: { message: string }[];
  data?: Record<string, unknown>;
};

export function apiErrorBody(error: unknown): ApiErrorBody {
  const trpc = error instanceof TRPCError ? error : null;
  // A procedure may only answer with a published code; anything else is a bug
  // on this side and reads as one.
  const code: ApiErrorCode =
    trpc && trpc.code in API_ERROR_STATUS
      ? (trpc.code as ApiErrorCode)
      : "INTERNAL_SERVER_ERROR";
  const internal = code === "INTERNAL_SERVER_ERROR";
  const { currentUpdatedAt, candidates } = errorCauseData(trpc?.cause);
  const data: Record<string, unknown> = {};
  if (currentUpdatedAt !== null) data.currentUpdatedAt = currentUpdatedAt;
  if (candidates !== null) data.candidates = candidates;
  const issues =
    trpc?.cause instanceof ZodError
      ? trpc.cause.issues.map((issue) => ({
          message: issue.path.length
            ? `${issue.path.join(".")}: ${issue.message}`
            : issue.message,
        }))
      : null;
  return {
    // A 500's message is logged, never returned: a driver error quotes the
    // failing SQL and its bound parameters.
    message: internal ? "Internal server error" : (trpc?.message ?? ""),
    code,
    ...(issues ? { issues } : {}),
    ...(Object.keys(data).length > 0 ? { data } : {}),
  };
}

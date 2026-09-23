import env from "@packages/env";
import { TRPCError } from "@trpc/server";
import { createOpenApiFetchHandler } from "trpc-to-openapi";

import { apiErrorBody } from "~/server/api/error-body";
import { API_ERROR_STATUS } from "~/server/api/error-codes";
import { openApiDocument } from "~/server/api/openapi";
import { appRouter } from "~/server/api/root";
import { createRestContext } from "~/server/api/trpc";

const ENDPOINT = "/api/v1";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Every published path with the methods it serves, read off the document the
 * generator built from this same router: a procedure that gains a REST path
 * arrives here with it, and nothing has to be listed twice.
 */
const OPERATIONS: readonly { segments: string[]; methods: string[] }[] =
  Object.entries(openApiDocument.paths ?? {}).map(([path, item]) => ({
    segments: path.split("/").filter(Boolean),
    methods: HTTP_METHODS.filter((method) => item?.[method]).map((method) =>
      method.toUpperCase(),
    ),
  }));

/**
 * The methods every published path matching `pathname` serves, or an empty set
 * when no path does. A parameter segment matches any one segment, and several
 * paths may match — `/entities/search` and `/entities/{id}` both do — so the
 * answer is their union, which is what `Allow` is meant to carry.
 */
function methodsFor(pathname: string): Set<string> {
  const segments = pathname.split("/").filter(Boolean);
  const methods = new Set<string>();
  for (const operation of OPERATIONS) {
    if (operation.segments.length !== segments.length) continue;
    const matches = operation.segments.every(
      (segment, index) =>
        segment.startsWith("{") || segment === segments[index],
    );
    if (matches) for (const method of operation.methods) methods.add(method);
  }
  return methods;
}

/**
 * The refusals the transport owns, answered before the adapter runs.
 *
 * `data` is the narrow one from {@link apiErrorBody} rather than the adapter's:
 * nothing reached a procedure, so there is no `path`, no stack, and nothing to
 * put on it beyond the two keys every error body carries.
 */
function refuse(
  code: "METHOD_NOT_SUPPORTED" | "UNSUPPORTED_MEDIA_TYPE",
  message: string,
  headers?: HeadersInit,
) {
  return Response.json(apiErrorBody(new TRPCError({ code, message })), {
    status: API_ERROR_STATUS[code],
    headers,
  });
}

/**
 * The two codes the design doc says the transport contributes, which the
 * adapter does not.
 *
 * It looks a method and a path up together, so a wrong verb on a live path
 * comes back as `NOT_FOUND` — indistinguishable, to a client, from an id that
 * does not exist. The document already says which methods each path serves, so
 * the answer is 405 with `Allow`.
 *
 * The content type is checked here for its message alone: the adapter's own is
 * cut off mid-quote (`Unsupported content-type "text/plain`). The rule is its
 * rule — a body-carrying method must be `application/json` — so a request this
 * lets through is one the adapter would have let through too.
 */
function transportRefusal(req: Request): Response | null {
  const path = new URL(req.url).pathname.slice(ENDPOINT.length) || "/";
  const allowed = methodsFor(path);
  if (allowed.size === 0) return null;
  const allow = [...allowed].sort().join(", ");
  if (!allowed.has(req.method)) {
    return refuse(
      "METHOD_NOT_SUPPORTED",
      `${req.method} is not supported on ${path}; it serves ${allow}`,
      { allow },
    );
  }
  if (req.method === "GET" || req.method === "DELETE") return null;
  const contentType = req.headers.get("content-type");
  if (!contentType) {
    return refuse("UNSUPPORTED_MEDIA_TYPE", "Missing content-type header");
  }
  if (!contentType.startsWith("application/json")) {
    return refuse(
      "UNSUPPORTED_MEDIA_TYPE",
      `Unsupported content-type "${contentType}"; this endpoint reads application/json`,
    );
  }
  return null;
}

const handler = (req: Request) =>
  transportRefusal(req) ??
  createOpenApiFetchHandler({
    endpoint: ENDPOINT,
    req,
    router: appRouter,
    createContext: () =>
      createRestContext({ headers: new Headers(req.headers) }),
    // A 500 reaches the client with its message replaced, so the original
    // only survives here.
    onError: ({ path, error }) => {
      if (
        error.code === "INTERNAL_SERVER_ERROR" ||
        env.NODE_ENV === "development"
      ) {
        console.error(
          `❌ REST failed on ${path ?? "<no-path>"}: ${error.message}`,
        );
      }
    },
  });

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};

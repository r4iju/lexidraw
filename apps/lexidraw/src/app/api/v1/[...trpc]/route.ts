import env from "@packages/env";
import { TRPCError } from "@trpc/server";
import { createOpenApiFetchHandler } from "trpc-to-openapi";

import { apiErrorBody } from "~/server/api/error-body";
import { API_ERROR_STATUS } from "~/server/api/error-codes";
import { openApiDocument } from "~/server/api/openapi";
import { appRouter } from "~/server/api/root";
import {
  createAnonymousRestContext,
  createRestContext,
} from "~/server/api/trpc";

const ENDPOINT = "/api/v1";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Every published path with the methods it serves, read off the document the
 * generator built from this same router: a procedure that gains a REST path
 * arrives here with it, and nothing has to be listed twice. `open` are the
 * methods whose operation the document publishes without security.
 */
const OPERATIONS: readonly {
  segments: string[];
  methods: string[];
  open: string[];
}[] = Object.entries(openApiDocument.paths ?? {}).map(([path, item]) => {
  const served = HTTP_METHODS.filter((method) => item?.[method]);
  return {
    segments: path.split("/").filter(Boolean),
    methods: served.map((method) => method.toUpperCase()),
    open: served
      .filter((method) => !item?.[method]?.security?.length)
      .map((method) => method.toUpperCase()),
  };
});

function operationsMatching(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return OPERATIONS.filter(
    (operation) =>
      operation.segments.length === segments.length &&
      operation.segments.every(
        (segment, index) =>
          segment.startsWith("{") || segment === segments[index],
      ),
  );
}

/**
 * The methods every published path matching `pathname` serves, or an empty set
 * when no path does. A parameter segment matches any one segment, and several
 * paths may match — `/entities/search` and `/entities/{id}` both do — so the
 * answer is their union, which is what `Allow` is meant to carry.
 */
function methodsFor(pathname: string): Set<string> {
  return new Set(
    operationsMatching(pathname).flatMap((operation) => operation.methods),
  );
}

/**
 * Whether the request can only reach an operation published without security.
 * Every path the request could match has to agree, so a parameterised path
 * that also matches never lets a protected operation run without a token.
 */
function isOpen(req: Request): boolean {
  const matching = operationsMatching(requestPath(req)).filter((operation) =>
    operation.methods.includes(req.method),
  );
  return (
    matching.length > 0 &&
    matching.every((operation) => operation.open.includes(req.method))
  );
}

const requestPath = (req: Request) =>
  new URL(req.url).pathname.slice(ENDPOINT.length) || "/";

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
 *
 * Both answers come before authentication, so an anonymous caller learns which
 * methods a path serves. That is deliberate: it is what the OpenAPI document
 * at `/api/v1/openapi.json` already says to anyone who asks, and answering the
 * method before the credentials keeps the refusal the same for every caller.
 */
function transportRefusal(req: Request): Response | null {
  const path = requestPath(req);
  const allowed = methodsFor(path);
  if (allowed.size === 0) return null;
  const allow = [...allowed].sort().join(", ");
  // Next serves HEAD through the exported GET, and a path that serves GET
  // serves HEAD with it: the body is dropped, not refused.
  const method = req.method === "HEAD" ? "GET" : req.method;
  if (!allowed.has(method)) {
    return refuse(
      "METHOD_NOT_SUPPORTED",
      `${req.method} is not supported on ${path}; it serves ${allow}`,
      { allow },
    );
  }
  if (method === "GET" || method === "DELETE") return null;
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
    createContext: () => {
      const headers = new Headers(req.headers);
      return isOpen(req)
        ? createAnonymousRestContext({ headers })
        : createRestContext({ headers });
    },
    // Answers carry one caller's files, or on `/native-sign-in/token` a
    // credential; no cache between here and the client keeps either.
    responseMeta: () => ({ headers: { "cache-control": "no-store" } }),
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

import { generateOpenApiDocument, type OpenAPIObject } from "trpc-to-openapi";

import { API_ERROR_CODES } from "./error-codes";
import { appRouter } from "./root";

type SchemaObject = NonNullable<
  NonNullable<OpenAPIObject["components"]>["schemas"]
>[string];

const ERROR_SCHEMA_NAME = "ErrorResponse";
const GENERATED_ERROR_REF_PREFIX = "#/components/schemas/error.";

/**
 * The body every failing REST call returns, as the transport builds it: the
 * TRPCError's message and code, plus the zod issues behind a 400.
 */
const errorResponseSchema: SchemaObject = {
  type: "object",
  title: "Error response",
  description: "The body of every unsuccessful response.",
  properties: {
    message: { type: "string", description: "Human readable explanation." },
    code: {
      type: "string",
      enum: [...API_ERROR_CODES],
      description: "Stable error code; clients branch on this, not the text.",
    },
    issues: {
      type: "array",
      description: "The input validation failures behind a 400, when any.",
      items: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
  },
  required: ["message", "code"],
};

/**
 * trpc-to-openapi emits one error component per status, each with `code` as a
 * free-form string. Pointing them all at one schema is what lets the document
 * state the vocabulary instead of leaving clients to infer it per endpoint.
 */
function repointErrorRefs(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) repointErrorRefs(item);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  const ref = record.$ref;
  if (typeof ref === "string" && ref.startsWith(GENERATED_ERROR_REF_PREFIX)) {
    record.$ref = `#/components/schemas/${ERROR_SCHEMA_NAME}`;
    return;
  }
  for (const value of Object.values(record)) repointErrorRefs(value);
}

/**
 * The REST surface of the router: every procedure that carries `meta.openapi`.
 * `baseUrl` matches the route that serves it, so the paths in the document are
 * the paths a client calls.
 */
const document = generateOpenApiDocument(appRouter, {
  title: "Lexidraw API",
  description:
    "REST access to Lexidraw documents and drawings. Authenticate with a personal access token created at /settings/tokens.",
  version: "1.0.0",
  baseUrl: "/api/v1",
  securitySchemes: {
    bearerAuth: {
      type: "http",
      scheme: "bearer",
      bearerFormat: "lxd_ token",
    },
  },
});

repointErrorRefs(document.paths);
document.components = {
  ...document.components,
  schemas: {
    ...Object.fromEntries(
      Object.entries(document.components?.schemas ?? {}).filter(
        ([name]) => !name.startsWith("error."),
      ),
    ),
    [ERROR_SCHEMA_NAME]: errorResponseSchema,
  },
};

export const openApiDocument = document;

import { generateOpenApiDocument, type OpenAPIObject } from "trpc-to-openapi";

import { API_ERROR_CODES } from "./error-codes";
import { inDialect, type SchemaDialect } from "./schema-dialect";
import { appRouter } from "./root";
import type { HeadingCandidate } from "~/server/documents/markdown";

type SchemaObject = NonNullable<
  NonNullable<OpenAPIObject["components"]>["schemas"]
>[string];

const ERROR_SCHEMA_NAME = "ErrorResponse";
const GENERATED_ERROR_REF_PREFIX = "#/components/schemas/error.";

/**
 * Keyed off the type the error actually carries, so renaming a field there
 * fails this file rather than leaving the document describing the old one.
 */
const headingCandidateProperties = {
  nth: {
    type: "integer",
    description: "1-based position among the matching headings.",
  },
  blockIndex: {
    type: "integer",
    description: "Position among the document's top-level blocks, from 0.",
  },
  tag: {
    type: "string",
    description: "The heading level as Lexical stores it, such as `h2`.",
  },
  text: { type: "string", description: "The heading's plain text." },
} satisfies Record<keyof HeadingCandidate, SchemaObject>;

const headingCandidateSchema: SchemaObject = {
  type: "object",
  title: "Heading candidate",
  properties: headingCandidateProperties,
  required: Object.keys(headingCandidateProperties),
};

/**
 * The body every failing REST call returns, as the transport builds it: the
 * TRPCError's message and code, the zod issues behind a 400, and the `data`
 * the error formatter attaches. `data` stays open because tRPC puts its own
 * bookkeeping there; only the fields a client is meant to branch on are
 * declared.
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
    data: {
      type: "object",
      description:
        "Machine readable detail; each field is null on the errors that do not carry it.",
      properties: {
        currentUpdatedAt: {
          type: ["string", "null"],
          format: "date-time",
          description:
            "On a 409, the document's current `updatedAt`; re-read from it and retry with it as `ifUnmodifiedSince`.",
        },
        candidates: {
          type: ["array", "null"],
          items: headingCandidateSchema,
          description:
            "On a 400 from an ambiguous `afterHeading`, the headings it could have meant; pass one's `nth` to choose.",
        },
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
  // The CLI sends a token only to a host whose document carries this title.
  title: "Lexidraw API",
  description:
    "REST access to Lexidraw documents and drawings. Authenticate with a personal access token created at /settings#api-tokens.",
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

/** The document spelled for a reader of `dialect`; see schema-dialect.ts. */
export const openApiDocumentIn = (dialect: SchemaDialect) =>
  inDialect(document, dialect);

/**
 * Published portably: a generated client is only as good as the dialect its
 * generator reads, and zod writes a nullable as `type: ["string", "null"]`,
 * which a reader that takes `type` for a string turns into a field that
 * refuses every null it is allowed to carry.
 */
export const openApiDocument = openApiDocumentIn("portable");

import { generateOpenApiDocument } from "trpc-to-openapi";

import { appRouter } from "./root";

/**
 * The REST surface of the router: every procedure that carries `meta.openapi`.
 * `baseUrl` matches the route that serves it, so the paths in the document are
 * the paths a client calls.
 */
export const openApiDocument = generateOpenApiDocument(appRouter, {
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

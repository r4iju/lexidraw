import { openApiDocument } from "~/server/api/openapi";

// The schema is how a client discovers the API, so it is readable without a
// token; the endpoints it describes still require one.
export const GET = () =>
  Response.json(openApiDocument, {
    headers: { "Cache-Control": "public, max-age=300" },
  });

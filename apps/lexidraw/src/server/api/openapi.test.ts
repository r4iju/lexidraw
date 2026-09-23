import { beforeAll, describe, expect, it, mock } from "bun:test";
import type { OpenAPIObject } from "trpc-to-openapi";

// The document is generated from the whole router, so importing it drags in
// every module the app touches at import time. Neither of these two has
// anything to say about the shape of the schema, and stubbing them keeps the
// test hermetic instead of dependent on a populated .env.
mock.module("server-only", () => ({}));
mock.module("@packages/env", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, key) => (key === "NODE_ENV" ? "test" : "https://example.test"),
    },
  ),
}));

let document: OpenAPIObject;

beforeAll(async () => {
  document = (await import("./openapi")).openApiDocument;
});

describe("openApiDocument", () => {
  it("is an OpenAPI 3 document", () => {
    expect(document.openapi).toStartWith("3.");
  });

  it("exposes entity load as GET /entities/{id}", () => {
    const operation = document.paths?.["/entities/{id}"]?.get;
    expect(operation).toBeDefined();
    expect(operation?.tags).toEqual(["entities"]);
  });

  it("guards entity load with the bearer scheme", () => {
    expect(document.paths?.["/entities/{id}"]?.get?.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(document.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });
});

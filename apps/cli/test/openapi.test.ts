import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CACHE_TTL_MS,
  cachePath,
  extractOperation,
  loadDocument,
  type OpenApiDocument,
} from "../src/openapi";
import { startStub } from "./helpers";

const fixture = (await Bun.file(
  join(import.meta.dir, "fixtures", "openapi.json"),
).json()) as OpenApiDocument;

describe("extractOperation", () => {
  it("finds the entity load operation by operationId", () => {
    const schema = extractOperation(fixture, "entities-load", "doc get");
    expect(schema).toMatchObject({
      command: "doc get",
      method: "GET",
      path: "/entities/{id}",
      operationId: "entities-load",
    });
    expect(schema.parameters).toEqual([
      { in: "path", name: "id", schema: { type: "string" }, required: true },
    ]);
    expect(schema.requestBody).toBeNull();
  });

  it("finds the me operation", () => {
    expect(extractOperation(fixture, "auth-me", "auth status")).toMatchObject({
      method: "GET",
      path: "/me",
    });
  });

  it("fails when the server does not describe the operation", () => {
    expect(() => extractOperation(fixture, "doc-append", "doc append")).toThrow(
      expect.objectContaining({
        code: "OPERATION_NOT_IN_SCHEMA",
      }) as unknown as Error,
    );
  });

  it("inlines references inside the document", () => {
    const document: OpenApiDocument = {
      paths: {
        "/e": {
          post: {
            operationId: "e-create",
            parameters: [{ $ref: "#/components/parameters/Id" }],
            requestBody: { schema: { $ref: "#/components/schemas/Body" } },
          },
        },
      },
      components: {
        parameters: { Id: { in: "path", name: "id" } },
        schemas: { Body: { type: "object" } },
      },
    } as OpenApiDocument;
    const schema = extractOperation(document, "e-create", "e create");
    expect(schema.parameters).toEqual([{ in: "path", name: "id" }]);
    expect(schema.requestBody).toEqual({ schema: { type: "object" } });
  });

  it("leaves a self-referencing schema as a reference", () => {
    const document = {
      paths: {
        "/e": {
          post: {
            operationId: "e-create",
            requestBody: { $ref: "#/components/schemas/Node" },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: "object",
            properties: { child: { $ref: "#/components/schemas/Node" } },
          },
        },
      },
    } as unknown as OpenApiDocument;
    expect(extractOperation(document, "e-create", "e create")).toMatchObject({
      requestBody: {
        type: "object",
        properties: { child: { $ref: "#/components/schemas/Node" } },
      },
    });
  });
});

describe("cachePath", () => {
  it("is per profile under the cache home", () => {
    expect(cachePath("dev", { XDG_CACHE_HOME: "/tmp/c" })).toBe(
      "/tmp/c/lexidraw/dev/openapi.json",
    );
  });
});

describe("loadDocument", () => {
  it("fetches once, then serves the cache until the TTL passes", async () => {
    const stub = startStub(() => Response.json(fixture));
    const cacheHome = await mkdtemp(join(tmpdir(), "lexidraw-cli-"));
    const env = { XDG_CACHE_HOME: cacheHome };
    const options = {
      profile: "dev",
      baseUrl: stub.baseUrl,
      refresh: false,
      env,
    };
    try {
      await loadDocument(options);
      expect(stub.requests).toHaveLength(1);
      expect(stub.requests[0]?.path).toBe("/api/v1/openapi.json");
      // Unauthenticated: the schema is how a caller discovers the API.
      expect(stub.requests[0]?.auth).toBeNull();

      await loadDocument(options);
      expect(stub.requests).toHaveLength(1);

      await loadDocument({ ...options, now: Date.now() + CACHE_TTL_MS + 1 });
      expect(stub.requests).toHaveLength(2);

      await loadDocument({ ...options, refresh: true });
      expect(stub.requests).toHaveLength(3);
    } finally {
      stub.stop();
    }
  });
});

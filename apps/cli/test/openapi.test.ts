import { describe, expect, it } from "bun:test";
import { mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CACHE_TTL_MS,
  cachePath,
  extractOperation,
  loadDocument,
  operationSchema,
  type OpenApiDocument,
} from "../src/openapi";
import { resolveProfile } from "../src/profile";
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
      summary: "Load one entity",
    });
    expect(schema.parameters).toEqual([
      { in: "path", name: "id", schema: { type: "string" }, required: true },
    ]);
    expect(schema.requestBody).toBeNull();
  });

  it("describes the successful response as well as the input", () => {
    const schema = extractOperation(fixture, "entities-load", "doc get");
    expect(schema.response).toMatchObject({ type: "object" });
    expect(
      Object.keys((schema.response as { properties: object }).properties),
    ).toContain("title");
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
    expect(() => extractOperation(fixture, "doc-append", "doc append")).toThrow(
      /--refresh/,
    );
  });

  it("inlines references inside the document", () => {
    const document = {
      paths: {
        "/e": {
          post: {
            operationId: "e-create",
            parameters: [{ $ref: "#/components/parameters/Id" }],
            requestBody: { schema: { $ref: "#/components/schemas/Body" } },
            responses: {
              200: {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Body" },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        parameters: { Id: { in: "path", name: "id" } },
        schemas: { Body: { type: "object" } },
      },
    } as unknown as OpenApiDocument;
    const schema = extractOperation(document, "e-create", "e create");
    expect(schema.parameters).toEqual([{ in: "path", name: "id" }]);
    expect(schema.requestBody).toEqual({ schema: { type: "object" } });
    expect(schema.response).toEqual({ type: "object" });
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
  it("is keyed by profile and by the origin the profile points at", () => {
    const env = { XDG_CACHE_HOME: "/tmp/c" };
    expect(cachePath(resolveProfile("prod", {}), env)).toBe(
      "/tmp/c/lexidraw/prod/https-lexidraw.vercel.app/openapi.json",
    );
    expect(
      cachePath(
        resolveProfile("prod", { LEXIDRAW_URL: "http://evil.test" }),
        env,
      ),
    ).toBe("/tmp/c/lexidraw/prod/http-evil.test/openapi.json");
  });
});

describe("loadDocument", () => {
  it("fetches once, then serves the cache until the TTL passes", async () => {
    const stub = startStub(() => Response.json(fixture));
    const cacheHome = await mkdtemp(join(tmpdir(), "lexidraw-cli-"));
    const env = { XDG_CACHE_HOME: cacheHome };
    const options = {
      profile: resolveProfile("dev", { LEXIDRAW_URL: stub.baseUrl }),
      refresh: false,
      env,
    };
    try {
      expect(await loadDocument(options)).toMatchObject({ cached: false });
      expect(stub.requests).toHaveLength(1);
      expect(stub.requests[0]?.path).toBe("/api/v1/openapi.json");
      // Unauthenticated: the schema is how a caller discovers the API.
      expect(stub.requests[0]?.auth).toBeNull();

      expect(await loadDocument(options)).toMatchObject({ cached: true });
      expect(stub.requests).toHaveLength(1);

      await loadDocument({ ...options, now: Date.now() + CACHE_TTL_MS + 1 });
      expect(stub.requests).toHaveLength(2);

      await loadDocument({ ...options, refresh: true });
      expect(stub.requests).toHaveLength(3);
    } finally {
      stub.stop();
    }
  });

  it("treats a cache file dated in the future as stale", async () => {
    const stub = startStub(() => Response.json(fixture));
    const cacheHome = await mkdtemp(join(tmpdir(), "lexidraw-cli-"));
    const env = { XDG_CACHE_HOME: cacheHome };
    const profile = resolveProfile("dev", { LEXIDRAW_URL: stub.baseUrl });
    try {
      await loadDocument({ profile, refresh: false, env });
      const future = new Date(Date.now() + 60_000);
      await utimes(cachePath(profile, env), future, future);
      expect(
        await loadDocument({ profile, refresh: false, env }),
      ).toMatchObject({ cached: false });
      expect(stub.requests).toHaveLength(2);
    } finally {
      stub.stop();
    }
  });
});

describe("operationSchema", () => {
  it("refetches once when only a cached document lacks the operation", async () => {
    let served: OpenApiDocument = { paths: {} };
    const stub = startStub(() => Response.json(served));
    const cacheHome = await mkdtemp(join(tmpdir(), "lexidraw-cli-"));
    const options = {
      profile: resolveProfile("dev", { LEXIDRAW_URL: stub.baseUrl }),
      refresh: false,
      env: { XDG_CACHE_HOME: cacheHome },
      command: "doc get",
      operationId: "entities-load",
    };
    try {
      await expect(operationSchema(options)).rejects.toMatchObject({
        code: "OPERATION_NOT_IN_SCHEMA",
      });
      expect(stub.requests).toHaveLength(1);

      served = fixture;
      expect(await operationSchema(options)).toMatchObject({
        path: "/entities/{id}",
      });
      // The stale cache was read, missed, and replaced.
      expect(stub.requests).toHaveLength(2);
    } finally {
      stub.stop();
    }
  });
});

/// <reference types="bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  TRPC_ERROR_CODE_HTTP_STATUS,
  type OpenAPIObject,
} from "trpc-to-openapi";

import { API_ERROR_CODES, API_ERROR_STATUS } from "./error-codes";

const testDir = join(import.meta.dir, "..", "..", "test");

/**
 * Generating the document means importing the whole router, which only loads
 * with `server-only` and the validated env stubbed out. Those stubs are
 * process-global, so they run in a child process rather than leaking into
 * every other test file in the suite.
 */
function generate(): OpenAPIObject {
  const result = Bun.spawnSync({
    cmd: [
      "bun",
      "--preload",
      join(testDir, "stub-env.ts"),
      join(testDir, "print-openapi.ts"),
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`generating the document failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.toString());
}

let document: OpenAPIObject;

beforeAll(() => {
  document = generate();
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

  it("exposes the caller identity as GET /me", () => {
    const operation = document.paths?.["/me"]?.get;
    expect(operation).toBeDefined();
    expect(operation?.operationId).toBe("auth-me");
    expect(operation?.tags).toEqual(["auth"]);
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
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

  // The v1 surface, as docs/agent-access.md promises it.
  const expectedOperations = [
    ["/me", "get", "auth"],
    ["/entities", "get", "entities"],
    ["/entities", "post", "entities"],
    ["/entities/search", "get", "entities"],
    ["/entities/{id}", "get", "entities"],
    ["/entities/{id}", "put", "entities"],
    ["/entities/{id}", "patch", "entities"],
    ["/entities/{id}", "delete", "entities"],
    ["/entities/{id}/tags", "get", "entities"],
    ["/entities/{id}/tags", "put", "entities"],
    ["/entities/{id}/shares", "get", "entities"],
    ["/entities/{id}/shares", "post", "entities"],
    ["/entities/{id}/shares/{userId}", "patch", "entities"],
    ["/entities/{id}/shares/{userId}", "delete", "entities"],
    ["/tags", "get", "entities"],
  ] as const;

  it.each(expectedOperations)("exposes %s %s", (path, method, tag) => {
    const operation = document.paths?.[path]?.[method];
    expect(operation).toBeDefined();
    expect(operation?.tags).toEqual([tag]);
    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  });

  it("exposes nothing else", () => {
    const operations = Object.entries(document.paths ?? {}).flatMap(
      ([path, item]) =>
        Object.keys(item ?? {}).map((method) => `${method} ${path}`),
    );
    expect(operations.toSorted()).toEqual(
      expectedOperations
        .map(([path, method]) => `${method} ${path}`)
        .toSorted(),
    );
  });

  // The routers that stay tRPC-only; a stray `meta.openapi` would show up as a
  // path naming one of them.
  it.each(["admin", "tts", "backup", "snapshot", "image", "llm"])(
    "keeps %s off the REST surface",
    (router) => {
      const paths = Object.keys(document.paths ?? {});
      expect(
        paths.filter((path) => path.toLowerCase().includes(router)),
      ).toEqual([]);
    },
  );

  it("documents one error body listing the stable codes", () => {
    const schema = document.components?.schemas?.ErrorResponse;
    expect(schema).toMatchObject({
      properties: { code: { enum: [...API_ERROR_CODES] } },
      required: ["message", "code"],
    });
    const refs = JSON.stringify(document.paths).match(
      /#\/components\/schemas\/[^"]+/g,
    );
    expect([...new Set(refs)]).toEqual(["#/components/schemas/ErrorResponse"]);
  });
});

describe("API_ERROR_STATUS", () => {
  it("maps each code to the status the transport returns", () => {
    for (const code of API_ERROR_CODES) {
      const status: number = API_ERROR_STATUS[code];
      expect(status).toBe(TRPC_ERROR_CODE_HTTP_STATUS[code]);
    }
  });

  /**
   * The adapter throws before any procedure runs — a malformed body, a wrong
   * content type, an unroutable path — so those codes reach clients without
   * passing through the router. Read from the installed package rather than
   * restated here, so an upgrade that adds one fails this test.
   */
  it("covers every code the REST adapter itself throws", async () => {
    const adapters = join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "node_modules",
      "trpc-to-openapi",
      "dist",
      "esm",
      "adapters",
    );
    const sources = new Bun.Glob("**/*.mjs").scanSync({ cwd: adapters });
    const thrown = new Set<string>();
    for (const file of sources) {
      const text = await Bun.file(join(adapters, file)).text();
      for (const match of text.matchAll(/code: '([A-Z_]+)'/g)) {
        if (match[1]) thrown.add(match[1]);
      }
    }
    expect(thrown.size).toBeGreaterThan(0);
    const known: readonly string[] = API_ERROR_CODES;
    expect([...thrown].filter((code) => !known.includes(code))).toEqual([]);
  });
});

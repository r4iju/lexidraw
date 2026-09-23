/// <reference types="bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type { OpenAPIObject } from "trpc-to-openapi";

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

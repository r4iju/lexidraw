import { describe, expect, it } from "bun:test";

import type { CliError } from "../src/errors";
import { type ApiResponse, expectOk } from "../src/http";

function caught(response: ApiResponse): CliError {
  try {
    expectOk(response, "the call failed");
  } catch (error) {
    return error as CliError;
  }
  throw new Error("expectOk answered where it should have thrown");
}

describe("expectOk", () => {
  it("returns the body of a 2xx", () => {
    expect(expectOk({ status: 200, body: { id: "doc-1" } }, "no")).toEqual({
      id: "doc-1",
    });
  });

  it("keeps the fields of `data` a caller can act on", () => {
    const error = caught({
      status: 409,
      body: {
        code: "CONFLICT",
        message: "Document was modified at 2026-01-01T00:00:00.000Z",
        data: {
          code: "CONFLICT",
          path: "documents.append",
          currentUpdatedAt: "2026-01-01T00:00:00.000Z",
          candidates: [{ nth: 1, blockIndex: 0, tag: "h1", text: "# Same" }],
          stack: "Error: at handler",
          zodError: null,
        },
      },
    });
    expect(error.code).toBe("CONFLICT");
    expect(error.details).toEqual({
      status: 409,
      data: {
        code: "CONFLICT",
        path: "documents.append",
        currentUpdatedAt: "2026-01-01T00:00:00.000Z",
        candidates: [{ nth: 1, blockIndex: 0, tag: "h1", text: "# Same" }],
      },
    });
  });

  it("drops a zodError, which `issues` already says", () => {
    const error = caught({
      status: 400,
      body: {
        code: "BAD_REQUEST",
        message: "Input validation failed",
        issues: [{ message: "markdown: markdown must not be blank" }],
        data: {
          path: "documents.replaceFromMarkdown",
          zodError: {
            formErrors: [],
            fieldErrors: { markdown: ["markdown must not be blank"] },
          },
        },
      },
    });
    expect(error.details).toEqual({
      status: 400,
      issues: [{ message: "markdown: markdown must not be blank" }],
      data: { path: "documents.replaceFromMarkdown" },
    });
  });
});

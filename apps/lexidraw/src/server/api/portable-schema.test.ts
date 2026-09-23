/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { portableJsonSchema } from "./portable-schema";

/**
 * The rewrite hands back the type it was given, which is the caller's
 * document; here the input is a literal and the answer is compared as JSON.
 */
function rewritten(schema: Record<string, unknown>): Record<string, unknown> {
  return portableJsonSchema(schema);
}

describe("a list-valued type", () => {
  test("becomes an anyOf over the members, keeping its siblings", () => {
    expect(
      rewritten({
        properties: {
          parentId: {
            description: "the directory",
            type: ["string", "null"],
          },
        },
      }),
    ).toEqual({
      properties: {
        parentId: {
          description: "the directory",
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
    });
  });

  test("is rewritten wherever it sits", () => {
    expect(
      rewritten({ oneOf: [{ items: { type: ["number", "null"] } }] }),
    ).toEqual({
      oneOf: [{ items: { anyOf: [{ type: "number" }, { type: "null" }] } }],
    });
  });
});

describe("a node that already carries an anyOf", () => {
  test("keeps it, and the type union joins it under allOf", () => {
    expect(
      rewritten({
        type: ["string", "null"],
        anyOf: [{ minLength: 1 }, { type: "null" }],
      }),
    ).toEqual({
      anyOf: [{ minLength: 1 }, { type: "null" }],
      allOf: [{ anyOf: [{ type: "string" }, { type: "null" }] }],
    });
  });

  test("keeps an allOf it already had as well", () => {
    expect(
      rewritten({
        type: ["string", "null"],
        anyOf: [{ minLength: 1 }],
        allOf: [{ maxLength: 8 }],
      }),
    ).toEqual({
      anyOf: [{ minLength: 1 }],
      allOf: [
        { maxLength: 8 },
        { anyOf: [{ type: "string" }, { type: "null" }] },
      ],
    });
  });
});

describe("a keyword whose value is data", () => {
  test("is left alone, however schema-shaped it looks", () => {
    const element = { type: ["rectangle", "ellipse"] };
    expect(
      rewritten({
        type: ["object", "null"],
        default: element,
        example: element,
        examples: [element],
        const: element,
        enum: [element],
      }),
    ).toEqual({
      anyOf: [{ type: "object" }, { type: "null" }],
      default: element,
      example: element,
      examples: [element],
      const: element,
      enum: [element],
    });
  });
});

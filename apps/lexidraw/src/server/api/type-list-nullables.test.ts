/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { portableJsonSchema } from "./portable-schema";
import { typeListNullables } from "./type-list-nullables";

/**
 * The rewrite hands back the type it was given, which is the caller's
 * document; here the input is a literal and the answer is compared as JSON.
 */
function rewritten(schema: Record<string, unknown>): Record<string, unknown> {
  return typeListNullables(schema);
}

describe("a nullable spelled as an anyOf with a null member", () => {
  test("becomes the member with null in its type list, keeping its siblings", () => {
    expect(
      rewritten({
        properties: {
          updatedAt: {
            description: "when",
            anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
          },
        },
      }),
    ).toEqual({
      properties: {
        updatedAt: {
          description: "when",
          type: ["string", "null"],
          format: "date-time",
        },
      },
    });
  });

  test("lets null through an enum as well as the type", () => {
    expect(
      rewritten({
        anyOf: [{ type: "string", enum: ["ready", "error"] }, { type: "null" }],
      }),
    ).toEqual({ type: ["string", "null"], enum: ["ready", "error", null] });
  });

  test("is rewritten wherever it sits, objects included", () => {
    expect(
      rewritten({
        items: {
          anyOf: [
            {
              type: "object",
              properties: {
                n: { anyOf: [{ type: "number" }, { type: "null" }] },
              },
            },
            { type: "null" },
          ],
        },
      }),
    ).toEqual({
      items: {
        type: ["object", "null"],
        properties: { n: { type: ["number", "null"] } },
      },
    });
  });

  test("undoes the portable rewrite", () => {
    const schema = {
      properties: {
        at: { type: ["string", "null"], format: "date-time" },
        list: { type: ["array", "null"], items: { type: "string" } },
      },
    };
    expect(rewritten(portableJsonSchema(schema))).toEqual(schema);
  });
});

describe("a union this spelling cannot say", () => {
  test.each([
    [
      "two members besides null",
      { anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }] },
    ],
    [
      "a reference",
      { anyOf: [{ $ref: "#/components/schemas/X" }, { type: "null" }] },
    ],
    [
      "a member and a sibling that disagree",
      {
        description: "outer",
        anyOf: [{ type: "string", description: "inner" }, { type: "null" }],
      },
    ],
  ])("is refused: %s", (_case, schema) => {
    expect(() => rewritten(schema)).toThrow();
  });

  test("leaves an anyOf without a null member alone", () => {
    const schema = { anyOf: [{ type: "boolean" }, { const: "true" }] };
    expect(rewritten(schema)).toEqual(schema);
  });
});

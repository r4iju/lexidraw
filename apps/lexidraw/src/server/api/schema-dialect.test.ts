/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import { inDialect } from "./schema-dialect";

describe("portable", () => {
  describe("a list-valued type", () => {
    test("becomes an anyOf over the members, keeping its siblings", () => {
      expect(
        inDialect<unknown>(
          {
            properties: {
              parentId: {
                description: "the directory",
                type: ["string", "null"],
              },
            },
          },
          "portable",
        ),
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
        inDialect<unknown>(
          { oneOf: [{ items: { type: ["number", "null"] } }] },
          "portable",
        ),
      ).toEqual({
        oneOf: [{ items: { anyOf: [{ type: "number" }, { type: "null" }] } }],
      });
    });
  });

  describe("a node that already carries an anyOf", () => {
    test("keeps it, and the type union joins it under allOf", () => {
      expect(
        inDialect<unknown>(
          {
            type: ["string", "null"],
            anyOf: [{ minLength: 1 }, { type: "null" }],
          },
          "portable",
        ),
      ).toEqual({
        anyOf: [{ minLength: 1 }, { type: "null" }],
        allOf: [{ anyOf: [{ type: "string" }, { type: "null" }] }],
      });
    });

    test("keeps an allOf it already had as well", () => {
      expect(
        inDialect<unknown>(
          {
            type: ["string", "null"],
            anyOf: [{ minLength: 1 }],
            allOf: [{ maxLength: 8 }],
          },
          "portable",
        ),
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
        inDialect<unknown>(
          {
            type: ["object", "null"],
            default: element,
            example: element,
            examples: [element],
            const: element,
            enum: [element],
          },
          "portable",
        ),
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
});

describe("type-list-nullables", () => {
  describe("a nullable spelled as an anyOf with a null member", () => {
    test("becomes the member with null in its type list, keeping its siblings", () => {
      expect(
        inDialect<unknown>(
          {
            properties: {
              updatedAt: {
                description: "when",
                anyOf: [
                  { type: "string", format: "date-time" },
                  { type: "null" },
                ],
              },
            },
          },
          "type-list-nullables",
        ),
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
        inDialect<unknown>(
          {
            anyOf: [
              { type: "string", enum: ["ready", "error"] },
              { type: "null" },
            ],
          },
          "type-list-nullables",
        ),
      ).toEqual({ type: ["string", "null"], enum: ["ready", "error", null] });
    });

    test("is rewritten wherever it sits, objects included", () => {
      expect(
        inDialect<unknown>(
          {
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
          },
          "type-list-nullables",
        ),
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
      expect(
        inDialect<unknown>(
          inDialect(schema, "portable"),
          "type-list-nullables",
        ),
      ).toEqual(schema);
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
      expect(() => inDialect<unknown>(schema, "type-list-nullables")).toThrow();
    });

    test("leaves an anyOf without a null member alone", () => {
      const schema = { anyOf: [{ type: "boolean" }, { const: "true" }] };
      expect(inDialect<unknown>(schema, "type-list-nullables")).toEqual(schema);
    });
  });
});

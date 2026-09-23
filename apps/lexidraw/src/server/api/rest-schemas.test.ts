/// <reference types="bun" />
import { describe, expect, it } from "bun:test";
import { createDocument } from "zod-openapi";
import { z } from "zod";

import { AccessLevel, EntityType } from "@packages/types";
import {
  accessLevelOut,
  entityTypeOut,
  isoDate,
  queryBoolean,
  stringList,
} from "./rest-schemas";

describe("queryBoolean", () => {
  it("passes the booleans a tRPC caller sends", () => {
    expect(queryBoolean.parse(true)).toBe(true);
    expect(queryBoolean.parse(false)).toBe(false);
  });

  // The reason this schema exists: z.coerce.boolean() reads "false" as true.
  it('reads "false" as false', () => {
    expect(queryBoolean.parse("false")).toBe(false);
    expect(queryBoolean.parse("true")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const value of ["", "1", "yes", 0, null]) {
      expect(queryBoolean.safeParse(value).success).toBe(false);
    }
  });
});

describe("stringList", () => {
  const tags = stringList(z.string(), "Tag names");
  const types = stringList(
    z.enum(["document", "drawing", "directory", "url"]),
    "Entity types",
  );

  it("passes an array through", () => {
    expect(tags.parse(["a", "b"])).toEqual(["a", "b"]);
  });

  it("wraps the bare string a single repetition arrives as", () => {
    expect(tags.parse("a")).toEqual(["a"]);
  });

  it("splits a comma-separated list", () => {
    expect(tags.parse("a,b,c")).toEqual(["a", "b", "c"]);
    expect(tags.parse("a,,b")).toEqual(["a", "b"]);
  });

  it("rejects values outside the enum, in either form", () => {
    expect(types.parse("url,document")).toEqual(["url", "document"]);
    expect(types.safeParse("folder").success).toBe(false);
    expect(types.safeParse("url,folder").success).toBe(false);
    expect(types.safeParse(["url", "folder"]).success).toBe(false);
  });

  it("names the legal values in the document", () => {
    const description = z.toJSONSchema(types, { io: "input" });
    expect(JSON.stringify(description)).toContain(
      "each one of document, drawing, directory, url",
    );
  });
});

/** The schema as the OpenAPI generator renders it in a response body. */
function documented(schema: z.ZodType): unknown {
  const document = createDocument({
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    paths: {
      "/x": {
        get: {
          responses: {
            200: {
              description: "ok",
              content: { "application/json": { schema } },
            },
          },
        },
      },
    },
  });
  // @ts-expect-error the document is built right here, so the path exists
  return document.paths["/x"].get.responses[200].content["application/json"]
    .schema;
}

describe("isoDate", () => {
  it("keeps the Date a tRPC caller receives", () => {
    const now = new Date();
    expect(isoDate.parse(now)).toBe(now);
  });

  it("is a date-time string in the document", () => {
    expect(documented(isoDate)).toMatchObject({
      type: "string",
      format: "date-time",
    });
  });

  it("rejects the ISO string itself, which the column never holds", () => {
    expect(isoDate.safeParse(new Date().toISOString()).success).toBe(false);
  });
});

describe("entityTypeOut", () => {
  it("narrows the plain text column to the enum", () => {
    expect(entityTypeOut.parse("drawing")).toBe(EntityType.DRAWING);
  });

  it("fails loudly on a value outside the enum", () => {
    expect(entityTypeOut.safeParse("folder").success).toBe(false);
  });

  it("documents the closed set", () => {
    expect(documented(entityTypeOut)).toMatchObject({
      enum: ["drawing", "document", "directory", "url"],
    });
  });
});

describe("accessLevelOut", () => {
  it("narrows the plain text column to the enum", () => {
    expect(accessLevelOut.parse("EDIT")).toBe(AccessLevel.EDIT);
    expect(accessLevelOut.safeParse("OWNER").success).toBe(false);
  });
});

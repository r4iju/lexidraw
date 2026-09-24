import { describe, expect, test } from "bun:test";
import { outlineLevels } from "./outline";

describe("table of contents indentation", () => {
  test("follows the outline, not the heading tag", () => {
    expect(outlineLevels(["h2", "h3", "h3", "h2", "h4"])).toEqual([
      0, 1, 1, 0, 1,
    ]);
  });

  test("a skipped level indents once", () => {
    expect(outlineLevels(["h1", "h3", "h2", "h3"])).toEqual([0, 1, 1, 2]);
  });

  test("headings of the same rank line up", () => {
    expect(outlineLevels(["h1", "h1", "h2", "h1"])).toEqual([0, 0, 1, 0]);
  });
});

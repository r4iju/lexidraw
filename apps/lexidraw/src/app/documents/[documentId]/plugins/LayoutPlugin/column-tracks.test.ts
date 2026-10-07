/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { moveSplit, shares, splitValue, template } from "./column-tracks";

describe("column tracks", () => {
  test("a plain fr template is its shares", () => {
    expect(shares("1fr 2.5fr  3fr", [10, 25, 30])).toEqual([1, 2.5, 3]);
  });

  test("another template becomes shares of the measured widths", () => {
    expect(shares("200px 1fr", [200, 600])).toEqual([0.5, 1.5]);
    expect(shares("repeat(2, 1fr)", [300, 300])).toEqual([1, 1]);
  });

  test("moving a split shares the pair anew and leaves the others", () => {
    expect(moveSplit([1, 1, 2], 0, 0.75, 0.1)).toEqual([1.5, 0.5, 2]);
  });

  test("a split stops short of either edge", () => {
    expect(moveSplit([1, 1], 0, 0.99, 0.2)).toEqual([1.6, 0.4]);
    expect(moveSplit([1, 1], 0, -1, 0.2)).toEqual([0.4, 1.6]);
  });

  test("shares are written with at most two decimals", () => {
    expect(template(moveSplit([1, 1, 1], 1, 1 / 3, 0.1))).toBe(
      "1fr 0.67fr 1.33fr",
    );
  });

  test("a split's value is the left column's percent of the pair", () => {
    expect(splitValue([1, 3, 1], 0)).toBe(25);
    expect(splitValue([1, 1], 0)).toBe(50);
  });
});

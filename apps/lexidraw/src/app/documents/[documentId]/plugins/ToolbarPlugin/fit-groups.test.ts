/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { fitGroups } from "./fit-groups";

describe("fitGroups", () => {
  test("shows every group when they all fit, with no room kept for More", () => {
    expect(fitGroups([100, 100, 100], 300, 40)).toBe(3);
    expect(fitGroups([100, 100, 100], 1000, 40)).toBe(3);
  });

  test("keeps room for More once anything overflows", () => {
    // 100 + 100 + 40 fits in 250; a third group would not.
    expect(fitGroups([100, 100, 100], 250, 40)).toBe(2);
    // 100 + 100 + 40 does not fit in 239, so the second group goes too.
    expect(fitGroups([100, 100, 100], 239, 40)).toBe(1);
  });

  test("collapses from the end, keeping the order of priority", () => {
    expect(fitGroups([60, 200, 30, 30], 140, 40)).toBe(1);
  });

  test("puts everything in More when not even the first group fits", () => {
    expect(fitGroups([100, 100], 120, 40)).toBe(0);
    expect(fitGroups([100], 0, 40)).toBe(0);
  });

  test("an empty toolbar shows nothing and needs no More", () => {
    expect(fitGroups([], 500, 40)).toBe(0);
  });
});

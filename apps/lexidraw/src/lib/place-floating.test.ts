/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { placeFloating } from "./place-floating";

const viewport = { top: 0, left: 0, right: 1280, bottom: 900 };
const toolbar = { width: 300, height: 40 };

describe("placeFloating", () => {
  test("centres a toolbar above the selection", () => {
    const target = { top: 400, left: 600, width: 80, height: 20 };
    expect(placeFloating(target, toolbar, viewport, { side: "above" })).toEqual(
      { left: 490, top: 350, side: "above" },
    );
  });

  test("flips below a selection near the top of the visible area", () => {
    const target = { top: 70, left: 600, width: 80, height: 20 };
    const bounds = { ...viewport, top: 56 };
    expect(placeFloating(target, toolbar, bounds, { side: "above" })).toEqual({
      left: 490,
      top: 100,
      side: "below",
    });
  });

  test("stays on screen at the left edge", () => {
    const target = { top: 400, left: 4, width: 30, height: 20 };
    const place = placeFloating(target, toolbar, viewport, { side: "above" });
    expect(place.left).toBe(8);
  });

  test("stays on screen at the right edge", () => {
    const target = { top: 400, left: 1250, width: 30, height: 20 };
    const place = placeFloating(target, toolbar, viewport, { side: "above" });
    expect(place.left + toolbar.width).toBe(1272);
  });

  test("starts at the left of the target when asked to", () => {
    const target = { top: 100, left: 200, width: 40, height: 20 };
    expect(
      placeFloating(target, toolbar, viewport, {
        side: "below",
        align: "start",
      }),
    ).toEqual({ left: 200, top: 130, side: "below" });
  });

  test("flips a menu above the caret near the bottom of the viewport", () => {
    const target = { top: 860, left: 200, width: 0, height: 20 };
    const menu = { width: 192, height: 240 };
    expect(
      placeFloating(target, menu, viewport, { side: "below", align: "start" }),
    ).toEqual({ left: 200, top: 610, side: "above" });
  });

  test("keeps the preferred side when neither side has room", () => {
    const target = { top: 100, left: 200, width: 0, height: 20 };
    const menu = { width: 192, height: 800 };
    const bounds = { ...viewport, bottom: 400 };
    expect(
      placeFloating(target, menu, bounds, { side: "below", align: "start" })
        .side,
    ).toBe("below");
  });

  test("is pinned to the left margin when wider than the visible area", () => {
    const target = { top: 400, left: 100, width: 30, height: 20 };
    const narrow = { ...viewport, right: 320 };
    expect(
      placeFloating(target, { width: 400, height: 40 }, narrow, {
        side: "above",
      }).left,
    ).toBe(8);
  });
});

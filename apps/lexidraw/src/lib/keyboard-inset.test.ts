import { describe, expect, test } from "bun:test";
import { keyboardInset } from "./keyboard-inset";

describe("keyboard inset", () => {
  test("nothing covers the page while the keyboard is down", () => {
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0);
  });

  test("the keyboard covers what the visual viewport lost at the bottom", () => {
    expect(keyboardInset(800, { height: 460, offsetTop: 0 })).toBe(340);
  });

  test("a viewport scrolled down inside the page is not taken for a keyboard", () => {
    expect(keyboardInset(800, { height: 460, offsetTop: 120 })).toBe(220);
  });

  test("a pinch zoom never makes the inset negative", () => {
    expect(keyboardInset(800, { height: 400, offsetTop: 500 })).toBe(0);
  });

  test("without a visual viewport there is no keyboard to measure", () => {
    expect(keyboardInset(800, undefined)).toBe(0);
  });
});

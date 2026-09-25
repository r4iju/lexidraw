/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { Modifier } from "@dnd-kit/core";
import { besidePointer } from "./beside-pointer";

type Args = Parameters<Modifier>[0];

const WINDOW = { width: 1280, height: 900 };
const CHIP = { width: 200, height: 40 };
// A list row across the page, grabbed near its right end.
const ROW = { left: 0, top: 200, width: 1200, height: 56 };

/** Where the chip's top-left lands, in the viewport. */
function chipAt({
  grab,
  moved,
  touch = false,
  window = WINDOW,
}: {
  grab: { x: number; y: number };
  moved: { x: number; y: number };
  touch?: boolean;
  window?: { width: number; height: number };
}) {
  const point = { clientX: grab.x, clientY: grab.y };
  const activatorEvent = (touch ? { touches: [point] } : point) as never;
  const rect = { ...ROW, right: ROW.width, bottom: ROW.top + ROW.height };
  const transform = besidePointer(CHIP)({
    activatorEvent,
    activeNodeRect: rect,
    draggingNodeRect: rect,
    overlayNodeRect: rect,
    windowRect: {
      ...window,
      left: 0,
      top: 0,
      right: window.width,
      bottom: window.height,
    },
    transform: { ...moved, scaleX: 1, scaleY: 1 },
  } as unknown as Args);
  return { x: ROW.left + transform.x, y: ROW.top + transform.y };
}

describe("the drag ghost follows the pointer without covering what is under it", () => {
  test("a mouse holds it just below and right of the pointer", () => {
    // Grabbed at (1100, 220), then dragged up onto the app bar at (300, 24).
    const at = chipAt({
      grab: { x: 1100, y: 220 },
      moved: { x: -800, y: -196 },
    });
    expect(at.x).toBeGreaterThan(300);
    expect(at.x).toBeLessThan(300 + 24);
    expect(at.y).toBeGreaterThan(24);
    expect(at.y).toBeLessThan(24 + 24);
  });

  test("a finger holds it above the finger, where the hand doesn't hide it", () => {
    const at = chipAt({
      grab: { x: 100, y: 500 },
      moved: { x: 50, y: 0 },
      touch: true,
    });
    expect(at.y + CHIP.height).toBeLessThan(500);
    expect(at.x).toBeGreaterThan(150);
  });

  test("near the right edge it goes to the pointer's left, still clear of it", () => {
    const at = chipAt({
      grab: { x: 300, y: 220 },
      moved: { x: 0, y: 0 },
      window: { width: 375, height: 812 },
    });
    expect(at.x + CHIP.width).toBeLessThan(300);
    expect(at.x).toBeGreaterThanOrEqual(0);
  });

  test("a finger at the top of the screen holds it below instead, on screen", () => {
    const at = chipAt({
      grab: { x: 100, y: 24 },
      moved: { x: 0, y: 0 },
      touch: true,
    });
    expect(at.y).toBeGreaterThan(24);
  });
});

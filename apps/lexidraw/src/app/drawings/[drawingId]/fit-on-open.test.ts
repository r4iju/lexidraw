/// <reference types="bun" />
import { expect, test } from "bun:test";
import { fitOnOpen } from "./fit-on-open";

const view = { width: 1000, height: 600, scrollX: 0, scrollY: 0, zoom: 1 };

/** The scene rectangle a view shows. */
function shown(v: {
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  zoom: number;
}) {
  return {
    left: -v.scrollX,
    top: -v.scrollY,
    right: -v.scrollX + v.width / v.zoom,
    bottom: -v.scrollY + v.height / v.zoom,
  };
}

test("a drawing already in view opens where it was left", () => {
  expect(fitOnOpen([100, 100, 400, 300], view)).toBeNull();
});

test("an empty drawing opens where it was left", () => {
  expect(fitOnOpen(null, view)).toBeNull();
});

test("a drawing off-screen opens with all of it in view, at no more than 100%", () => {
  const fitted = fitOnOpen([3000, 2000, 3100, 2050], view);
  expect(fitted).not.toBeNull();
  if (!fitted) return;
  expect(fitted.zoom).toBe(1);
  const area = shown({ ...view, ...fitted });
  expect(area.left).toBeLessThanOrEqual(3000);
  expect(area.right).toBeGreaterThanOrEqual(3100);
  expect(area.top).toBeLessThanOrEqual(2000);
  expect(area.bottom).toBeGreaterThanOrEqual(2050);
});

test("a drawing larger than the screen zooms out until it fits", () => {
  const fitted = fitOnOpen([-2000, -500, 2000, 1500], view);
  expect(fitted).not.toBeNull();
  if (!fitted) return;
  expect(fitted.zoom).toBeLessThan(1);
  const area = shown({ ...view, ...fitted });
  expect(area.left).toBeLessThanOrEqual(-2000);
  expect(area.right).toBeGreaterThanOrEqual(2000);
  expect(area.top).toBeLessThanOrEqual(-500);
  expect(area.bottom).toBeGreaterThanOrEqual(1500);
});

test("a drawing cut off at one edge is brought fully into view", () => {
  const fitted = fitOnOpen([900, 100, 1200, 200], view);
  expect(fitted).not.toBeNull();
  if (!fitted) return;
  const area = shown({ ...view, ...fitted });
  expect(area.left).toBeLessThanOrEqual(900);
  expect(area.right).toBeGreaterThanOrEqual(1200);
});

// The canvas controls float over its edges: a shape in the corner is hidden
// under the menu button though it is on screen.
test("a drawing tucked into a corner, under the controls, is brought clear of them", () => {
  const fitted = fitOnOpen([0, 0, 160, 70], view);
  expect(fitted).not.toBeNull();
  if (!fitted) return;
  expect(fitted.zoom).toBe(1);
  const area = shown({ ...view, ...fitted });
  expect(area.left).toBeLessThanOrEqual(0 - 48);
  expect(area.top).toBeLessThanOrEqual(0 - 48);
});

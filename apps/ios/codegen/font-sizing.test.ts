import { expect, test } from "bun:test";
import { fontSizing } from "./font-sizing";

test("font-size steps retain web thresholds, bounds and default", () => {
  const settings = fontSizing();
  expect(settings.default).toBe(15);
  expect(settings.minimum).toBe(8);
  expect(settings.maximum).toBe(72);
  expect(settings.increment(15)).toBe(17);
  expect(settings.decrement(48)).toBe(36);
  expect(settings.increment(72)).toBe(72);
  expect(settings.decrement(4)).toBe(8);
});

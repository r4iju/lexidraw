import { expect, test } from "bun:test";
import { leastScale } from "./diagram-scale";

// Mermaid's kinds, as each names itself in its drawing's aria-roledescription.
test("a pie, drawn with 17px labels, shrinks to fit a phone's 358px column from 524px", () => {
  expect(524 * leastScale("pie")).toBeLessThanOrEqual(358);
});

test("a flowchart shrinks no further than keeps its 14px text at 11px", () => {
  const scale = leastScale("flowchart-v2");
  expect(14 * scale).toBeGreaterThanOrEqual(11);
  expect(14 * scale).toBeLessThan(11.5);
});

test("a gantt, laid out for its column with 10px axis labels, never shrinks", () => {
  expect(leastScale("gantt")).toBe(1);
});

import { expect, test } from "bun:test";
import { JSDOM } from "jsdom";
import { ganttWidth } from "./gantt-width";

const { DOMParser } = new JSDOM().window;

/** A gantt as Mermaid draws it at 400px: 75px each side, an axis tick every 50px. */
const GANTT = new DOMParser().parseFromString(
  `<svg xmlns="http://www.w3.org/2000/svg" aria-roledescription="gantt" viewBox="0 0 400 180">
    <g class="grid" transform="translate(75, 130)">
      ${[0, 50, 100, 150, 200, 250]
        .map(
          (x, i) =>
            `<g class="tick" transform="translate(${x},0)"><line y2="-100"></line><text font-size="10">2026-09-0${i + 1}</text></g>`,
        )
        .join("")}
    </g>
  </svg>`,
  "image/svg+xml",
).documentElement;
const SIDES = 150;

test("a gantt whose axis labels would overlap is laid out wide enough to part them", () => {
  // Ten characters at 6px: each label is 60px, wider than the 50px between ticks.
  const width = ganttWidth(GANTT, 400, SIDES, (label) => label.length * 6);
  const spacing = ((width - SIDES) / (400 - SIDES)) * 50;
  expect(spacing).toBeGreaterThan(60 + 4);
  expect(spacing).toBeLessThan(60 + 30);
});

test("a gantt whose axis labels fit keeps the width it was drawn at", () => {
  expect(ganttWidth(GANTT, 400, SIDES, (label) => label.length * 3)).toBe(400);
});

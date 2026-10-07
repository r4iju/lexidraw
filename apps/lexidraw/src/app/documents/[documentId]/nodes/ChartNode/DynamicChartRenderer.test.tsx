/// <reference types="bun" />
import { afterEach, expect, test } from "bun:test";
import { act, type ComponentProps } from "react";
import { installDom, render } from "~/test/dom";

installDom();
const { default: DynamicChartRenderer } = await import(
  "./DynamicChartRenderer"
);

// jsdom has no layout: the chart's own container gets the frame's size, text
// Recharts measures is 7px a character, and everything else takes no room.
const frame = { width: 640, height: 320 };
const CHARACTER = 7;
const size = (element: Element) =>
  element.classList.contains("recharts-responsive-container")
    ? frame
    : element.id === "recharts_measurement_span"
      ? { width: (element.textContent ?? "").length * CHARACTER, height: 14 }
      : { width: 0, height: 0 };
Object.defineProperties(window.HTMLElement.prototype, {
  getBoundingClientRect: {
    configurable: true,
    value(this: Element) {
      const { width, height } = size(this);
      return {
        width,
        height,
        top: 0,
        left: 0,
        x: 0,
        y: 0,
        right: width,
        bottom: height,
      };
    },
  },
  clientWidth: {
    configurable: true,
    get(this: Element) {
      return size(this).width;
    },
  },
  clientHeight: {
    configurable: true,
    get(this: Element) {
      return size(this).height;
    },
  },
  offsetWidth: {
    configurable: true,
    get(this: Element) {
      return size(this).width;
    },
  },
  offsetHeight: {
    configurable: true,
    get(this: Element) {
      return size(this).height;
    },
  },
});

let unmount: (() => Promise<void>) | undefined;
afterEach(async () => {
  await unmount?.();
  unmount = undefined;
  Object.assign(frame, { width: 640, height: 320 });
});

const week = [
  { name: "Mon", a: 12, b: 7 },
  { name: "Tue", a: 9, b: 11 },
  { name: "Wed", a: 15, b: 6 },
  { name: "Thu", a: 7, b: 13 },
  { name: "Fri", a: 18, b: 9 },
];
const twoSeries = {
  a: { label: "Alpha", color: "chart-1" },
  b: { label: "Beta", color: "chart-2" },
};

async function draw(
  props: Partial<ComponentProps<typeof DynamicChartRenderer>> &
    Pick<ComponentProps<typeof DynamicChartRenderer>, "chartType">,
) {
  const view = await render(
    <DynamicChartRenderer
      data={week}
      config={twoSeries}
      width="inherit"
      height="inherit"
      {...props}
    />,
  );
  unmount = view.unmount;
  // Recharts settles over several effect passes; legend entries come last.
  for (let pass = 0; pass < 5; pass++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  return document.body;
}

test("an area chart draws one filled area per series", async () => {
  const body = await draw({ chartType: "area" });
  expect(body.textContent).not.toContain("Unsupported");
  expect(body.querySelectorAll(".recharts-area")).toHaveLength(2);
});

test("a radar chart draws one polygon per series around the categories", async () => {
  const body = await draw({ chartType: "radar" });
  expect(body.querySelectorAll(".recharts-radar")).toHaveLength(2);
  expect(
    [...body.querySelectorAll(".recharts-polar-angle-axis-tick")].map(
      (tick) => tick.textContent,
    ),
  ).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
});

test("a scatter chart places each point by its numeric x value", async () => {
  const body = await draw({
    chartType: "scatter",
    data: [
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 10, y: 2 },
    ],
    config: { y: { label: "Y", color: "chart-3" } },
  });
  const xs = [...body.querySelectorAll(".recharts-scatter-symbol path")].map(
    (point) => Number(point.getAttribute("cx") ?? point.getAttribute("x")),
  );
  expect(xs).toHaveLength(3);
  const [one = 0, two = 0, ten = 0] = xs;
  // Nine units to the last point, one to the second.
  expect((ten - one) / (two - one)).toBeCloseTo(9, 0);
});

test("a composed chart draws the first series as bars and the rest as lines", async () => {
  const body = await draw({
    chartType: "composed",
    data: week.map((day, index) => ({ ...day, c: index })),
    config: { ...twoSeries, c: { label: "Gamma", color: "chart-3" } },
  });
  expect(body.querySelectorAll(".recharts-bar")).toHaveLength(1);
  expect(
    body.querySelectorAll(".recharts-bar .recharts-bar-rectangle"),
  ).toHaveLength(5);
  expect(body.querySelectorAll(".recharts-line")).toHaveLength(2);
});

const meals = [
  { name: "Rice", value: 40 },
  { name: "Soup", value: 25 },
  { name: "Fish", value: 20 },
  { name: "Tea", value: 15 },
];

test("a pie chart colours every slice differently", async () => {
  const body = await draw({
    chartType: "pie",
    data: meals,
    config: { value: { label: "Share", color: "chart-1" } },
  });
  const fills = [...body.querySelectorAll(".recharts-pie-sector path")].map(
    (slice) => slice.getAttribute("fill"),
  );
  expect(fills).toHaveLength(4);
  expect(new Set(fills).size).toBe(4);
});

test("a pie chart's legend names every slice with its share", async () => {
  const body = await draw({
    chartType: "pie",
    data: meals,
    config: { value: { label: "Share", color: "chart-1" } },
  });
  const legend = body.querySelector(".recharts-legend-wrapper");
  expect(legend?.textContent).toBe("Rice40%Soup25%Fish20%Tea15%");
});

test("pie slices past the five chart colours still differ", async () => {
  const body = await draw({
    chartType: "pie",
    data: ["N", "S", "E", "W", "C", "O", "X"].map((name) => ({
      name,
      value: 10,
    })),
    config: {},
  });
  const fills = [...body.querySelectorAll(".recharts-pie-sector path")].map(
    (slice) => slice.getAttribute("fill"),
  );
  expect(new Set(fills).size).toBe(7);
});

test("a line chart keeps its end points and their labels inside the frame", async () => {
  frame.width = 358;
  const body = await draw({ chartType: "line" });
  const dots = [...body.querySelectorAll(".recharts-line-dots circle")];
  expect(dots.length).toBeGreaterThan(0);
  for (const dot of dots) {
    const cx = Number(dot.getAttribute("cx"));
    const reach = Number(dot.getAttribute("r")) + 2;
    expect(cx - reach).toBeGreaterThanOrEqual(0);
    expect(cx + reach).toBeLessThanOrEqual(frame.width);
  }
  const lastDot = Number(dots.at(-1)?.getAttribute("cx"));
  const fri = [...body.querySelectorAll(".recharts-xAxis-tick-labels text")].find(
    (label) => label.textContent === "Fri",
  );
  expect(Number(fri?.getAttribute("x"))).toBeCloseTo(lastDot, 0);
  // Room for half a short label on either side of its point.
  expect(lastDot).toBeLessThanOrEqual(frame.width - 16);
});

test("long category labels on a phone all show, wrapped within their bar", async () => {
  frame.width = 358;
  const names = [
    "A very long category name",
    "Another long category label",
    "東京都の長いカテゴリ名",
  ];
  const body = await draw({
    chartType: "bar",
    data: names.map((name, index) => ({ name, value: index + 3 })),
    config: { value: { label: "Count", color: "chart-4" } },
  });
  const labels = [...body.querySelectorAll(".recharts-xAxis-tick-labels text")];
  expect(labels).toHaveLength(3);
  const band = Number(
    body.querySelector(".recharts-bar-rectangle path")?.getAttribute("width"),
  );
  for (const label of labels) {
    const lines = [...label.querySelectorAll("tspan")].map(
      (line) => line.textContent ?? "",
    );
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const line of lines)
      expect(line.length * CHARACTER).toBeLessThanOrEqual(band * 1.25);
  }
  expect(labels[0]?.textContent).toStartWith("A very long");
});

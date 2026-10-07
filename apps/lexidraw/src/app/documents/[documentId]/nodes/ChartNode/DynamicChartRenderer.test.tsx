/// <reference types="bun" />
import { afterEach, expect, test } from "bun:test";
import { act, type ComponentProps } from "react";
import { installDom, render } from "~/test/dom";

installDom();
const { default: DynamicChartRenderer } = await import(
  "./DynamicChartRenderer"
);

// jsdom has no layout: the chart's own container gets the frame's size and
// everything inside it (legend, labels) takes no room.
const frame = { width: 640, height: 320 };
const sized = (element: Element) =>
  element.classList.contains("recharts-responsive-container");
const size = (element: Element) =>
  sized(element) ? frame : { width: 0, height: 0 };
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

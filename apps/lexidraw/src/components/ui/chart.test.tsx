import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChartContainer } from "./chart";

test("chart series resolve token names without baking a theme into saved data", () => {
  const markup = renderToStaticMarkup(
    <ChartContainer config={{ meals: { label: "Meals", color: "chart-1" } }}>
      <div />
    </ChartContainer>,
  );
  expect(markup).toContain("--color-meals: var(--chart-1)");
});

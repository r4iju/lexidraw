import { expect, test } from "bun:test";
import { createSVGPreview } from "./svg-preview";

test("SVG previews retain source dimensions and deduplicate the original source", async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="blue"/></svg>';
  let calls = 0;
  const render = createSVGPreview(async (source) => {
    calls++;
    expect(Buffer.from(source).toString()).toBe(svg);
    return {
      png: "cG5n",
      width: 600,
      height: 300,
      rasterWidth: 1200,
      rasterHeight: 600,
    };
  }, "test");
  const [first, second] = await Promise.all([
    render(Buffer.from(svg)),
    render(Buffer.from(svg)),
  ]);
  expect(calls).toBe(1);
  expect(first).toEqual(second);
  expect(first.width).toBe(600);
  expect(first.height).toBe(300);
});

test("oversize SVG sources are refused before launching a renderer", async () => {
  let calls = 0;
  const render = createSVGPreview(async () => {
    calls++;
    return {
      png: "cG5n",
      width: 1,
      height: 1,
      rasterWidth: 2,
      rasterHeight: 2,
    };
  }, "test");
  await expect(
    render(Buffer.from(`<svg>${"a".repeat(8_000_000)}</svg>`)),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

test("large SVG intrinsic size remains intact when its raster preview is bounded", async () => {
  const render = createSVGPreview(
    async () => ({
      png: "cG5n",
      width: 5000,
      height: 5000,
      rasterWidth: 2048,
      rasterHeight: 2048,
    }),
    "test",
  );
  const result = await render(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"/>',
    ),
  );
  expect(result.width).toBe(5000);
  expect(result.height).toBe(5000);
});

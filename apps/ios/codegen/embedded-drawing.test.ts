import { expect, test } from "bun:test";
import {
  EMBEDDED_DRAWING_STYLE_PATH,
  FIGURE_STYLE_PATH,
  swiftForFigureStyle,
  swiftForEmbeddedDrawingStyle,
} from "./embedded-drawing";

test("embedded drawing sizing and export settings follow the web", async () => {
  const committed = await Bun.file(EMBEDDED_DRAWING_STYLE_PATH).text();
  expect(committed).toBe(await swiftForEmbeddedDrawingStyle());
});

test("document figures keep the web column and caption metrics", async () => {
  const committed = await Bun.file(FIGURE_STYLE_PATH).text();
  expect(committed).toBe(await swiftForFigureStyle());
});

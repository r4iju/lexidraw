import { expect, test } from "bun:test";
import {
  RENDERED_EMBED_STYLE_PATH,
  swiftForRenderedEmbedStyle,
} from "./rendered-embeds";

test("native rendered embed defaults match the web constructors and fonts", async () => {
  expect(await Bun.file(RENDERED_EMBED_STYLE_PATH).text()).toBe(
    await swiftForRenderedEmbedStyle(),
  );
});

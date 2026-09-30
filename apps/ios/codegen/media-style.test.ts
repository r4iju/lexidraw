import { expect, test } from "bun:test";
import { MEDIA_STYLE_PATH, swiftForMediaStyle } from "./media";

test("native image geometry stays current with web CSS", async () => {
  expect(await Bun.file(MEDIA_STYLE_PATH).text()).toBe(
    await swiftForMediaStyle(),
  );
});

import { expect, test } from "bun:test";
import { MEDIA_IMAGES_PATH, swiftForMediaImages } from "./media";

test("native image insertion and upload limit come from the web", async () => {
  expect(await Bun.file(MEDIA_IMAGES_PATH).text()).toBe(swiftForMediaImages());
});

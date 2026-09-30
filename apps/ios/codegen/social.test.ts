import { expect, test } from "bun:test";
import { EMOJI_ALIASES_PATH, swiftForEmojiAliases } from "./social";

test("native emoji aliases follow the current web shortcode table", async () => {
  const generated = swiftForEmojiAliases();
  expect(generated.includes('"smile": "\\u{1f604}"')).toBe(true);
  expect(generated.includes('"+1": "\\u{1f44d}"')).toBe(true);
  expect(await Bun.file(EMOJI_ALIASES_PATH).text()).toBe(generated);
});

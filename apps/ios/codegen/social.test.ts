import { expect, test } from "bun:test";
import {
  EMOJI_ALIASES_PATH,
  POLL_STYLE_PATH,
  swiftForEmojiAliases,
  swiftForPollStyle,
} from "./social";

test("native emoji aliases follow the current web shortcode table", async () => {
  const generated = swiftForEmojiAliases();
  expect(generated.includes('"smile": "\\u{1f604}"')).toBe(true);
  expect(generated.includes('"+1": "\\u{1f44d}"')).toBe(true);
  expect(await Bun.file(EMOJI_ALIASES_PATH).text()).toBe(generated);
});

test("native poll width follows the actual web card", async () => {
  const generated = await swiftForPollStyle();
  expect(generated.includes("maximumWidth: Double = 520")).toBe(true);
  expect(generated.includes("static let emptyOptionJSON =")).toBe(true);
  expect(generated.includes("static let insertionNodeJSON =")).toBe(true);
  expect(await Bun.file(POLL_STYLE_PATH).text()).toBe(generated);
});

import { expect, test } from "bun:test";
import {
  FOOTNOTE_STYLE_PATH, swiftForFootnoteStyle,
  EMOJI_ALIASES_PATH,
  POLL_STYLE_PATH,
  swiftForEmojiAliases,
  SOCIAL_STYLE_PATH,
  swiftForSocialStyle,
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

test("native mention styling follows the effective node DOM style", async () => {
  expect(await Bun.file(SOCIAL_STYLE_PATH).text()).toBe(
    await swiftForSocialStyle(),
  );
});

test("native footnote dimensions follow actual document CSS", async () => {
  expect(await Bun.file(FOOTNOTE_STYLE_PATH).text()).toBe(await swiftForFootnoteStyle());
});

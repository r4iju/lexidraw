import { expect, test } from "bun:test";
import {
  FOOTNOTE_STYLE_PATH, swiftForFootnoteStyle,
  COMMENT_DATA_PATH, swiftForCommentData,
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

test("native hashtags and keywords take the colour and weight the document theme gives them", async () => {
  const generated = await swiftForSocialStyle();
  expect(generated).toContain(
    '"hashtag": EntityTextStyle(color: WebSocialStyle.info, weight: nil)',
  );
  expect(generated).toContain(
    '"keyword": EntityTextStyle(color: WebSocialStyle.primary, weight: 600)',
  );
  expect(await Bun.file(SOCIAL_STYLE_PATH).text()).toBe(generated);
});

test("native footnote dimensions follow actual document CSS", async () => {
  expect(await Bun.file(FOOTNOTE_STYLE_PATH).text()).toBe(await swiftForFootnoteStyle());
});

test("native annotation colors follow the web comment theme", async () => {
  const generated = await swiftForSocialStyle();
  expect(generated.includes("static let commentMark = ThemeColor(")).toBe(true);
  expect(generated.includes("static let commentBorder = ThemeColor(")).toBe(true);
  expect(generated.includes("static let commentMarkActive = ThemeColor(")).toBe(true);
  expect(await Bun.file(SOCIAL_STYLE_PATH).text()).toBe(generated);
});

test("native comment insertion uses web marker and store defaults", async () => {
  const generated = await swiftForCommentData();
  expect(generated.includes("static let emptyCommentJSON =")).toBe(true);
  expect(generated.includes("static let emptyThreadNodeJSON =")).toBe(true);
  expect(await Bun.file(COMMENT_DATA_PATH).text()).toBe(generated);
});

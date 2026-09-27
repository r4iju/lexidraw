import { expect, test } from "bun:test";
import {
  LINK_PROTOCOLS_PATH,
  LINKS_PATH,
  swiftForLinkProtocols,
  swiftForLinks,
  swiftRawString,
} from "./links";

test("the committed link configuration is a fresh codegen of the web editor's", async () => {
  const committed = await Bun.file(LINKS_PATH).text();
  expect(committed).toBe(await swiftForLinks());
});

test("the committed link protocols are a fresh codegen of the web editor's", async () => {
  const committed = await Bun.file(LINK_PROTOCOLS_PATH).text();
  expect(committed).toBe(swiftForLinkProtocols());
});

test("the link protocols are the ones the web opens a link with", () => {
  expect(swiftForLinkProtocols()).toContain(
    'let supportedURLProtocols: Set<String> = ["http:", "https:", "mailto:", "sms:", "tel:"]',
  );
});

test("a raw string takes enough hashes that nothing in it ends or escapes it", () => {
  expect(swiftRawString('a"b')).toBe('#"a"b"#');
  expect(swiftRawString('a"#b')).toBe('##"a"#b"##');
  expect(swiftRawString("a\\#b")).toBe('##"a\\#b"##');
});

test("a raw string of lines is a multi-line literal", () => {
  expect(swiftRawString("a\nb")).toBe('#"""\na\nb\n"""#');
});

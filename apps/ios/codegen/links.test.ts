import { expect, test } from "bun:test";
import { LINKS_PATH, swiftForLinks, swiftRawString } from "./links";

test("the committed link configuration is a fresh codegen of the web editor's", async () => {
  const committed = await Bun.file(LINKS_PATH).text();
  expect(committed).toBe(await swiftForLinks());
});

test("a raw string takes enough hashes that nothing in it ends or escapes it", () => {
  expect(swiftRawString('a"b')).toBe('#"a"b"#');
  expect(swiftRawString('a"#b')).toBe('##"a"#b"##');
  expect(swiftRawString("a\\#b")).toBe('##"a\\#b"##');
});

test("a raw string of lines is a multi-line literal", () => {
  expect(swiftRawString("a\nb")).toBe('#"""\na\nb\n"""#');
});

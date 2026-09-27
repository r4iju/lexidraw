import { expect, test } from "bun:test";
import { LINKS_PATH, swiftForLinks, swiftRawString } from "./links";

test("the committed link configuration is a fresh codegen of the web editor's", async () => {
  const committed = await Bun.file(LINKS_PATH).text();
  expect(committed).toBe(swiftForLinks());
});

test("a raw string takes enough hashes that no quote in it ends it", () => {
  expect(swiftRawString('a"b')).toBe('#"a"b"#');
  expect(swiftRawString('a"#b')).toBe('##"a"#b"##');
});

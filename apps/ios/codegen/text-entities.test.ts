import { expect, test } from "bun:test";
import { TEXT_ENTITIES_PATH, swiftForTextEntities } from "./text-entities";

test("text entity patterns and emoji pairs follow the actual mounted plugins", async () => {
  const generated = await swiftForTextEntities();
  expect(generated).toContain("static let hashtag = JSRegExp(");
  expect(generated).toContain("static let keyword = JSRegExp(");
  expect(await Bun.file(TEXT_ENTITIES_PATH).text()).toBe(generated);
});

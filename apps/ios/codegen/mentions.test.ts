import { expect, test } from "bun:test";
import { unlink } from "node:fs/promises";
import { matchAtSignMention } from "../../lexidraw/src/app/documents/[documentId]/plugins/MentionsPlugin/source";
import { MENTIONS_PATH, swiftForMentions } from "./mentions";

test("native mention matcher matches the actual source across punctuation, whitespace and UTF16 bounds", async () => {
  const inputs = [
    "@Aay",
    "hello @Aay",
    "(@Aay",
    "@ ",
    "@a.",
    "@Mr. Smith",
    "@abc\n",
    "@abc\r\n",
    "@abc\u0085",
    "@" + "😀".repeat(37) + "a",
    "@" + "😀".repeat(38),
  ];
  for (let unit = 0; unit <= 0xffff; unit++) {
    const character = String.fromCharCode(unit);
    if (/\s/.test(character))
      inputs.push(character + "@Aay", "@a" + character + "b");
  }
  const alphabet = [
    "a",
    "A",
    " ",
    ".",
    "-",
    "@",
    "/",
    "😀",
    "é",
    "\u0085",
    "\n",
    "_",
    "(",
    ")",
    "$",
    "|",
  ];
  let seed = 134;
  for (let index = 0; index < 2000; index++) {
    let text = index % 2 ? "@" : "prefix @";
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const count = seed % 100;
    for (let unit = 0; unit < count; unit++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      text += alphabet[seed % alphabet.length];
    }
    inputs.push(text);
  }
  const path = `/tmp/lexidraw-mention-matcher-${process.pid}.swift`;
  await Bun.write(
    path,
    (await Bun.file(
      new URL(
        "../Sources/EditorModelInterface/JSRegExp.swift",
        import.meta.url,
      ),
    ).text()) +
      (await swiftForMentions()).replace("import EditorModelInterface\n", "") +
      `
let data = FileHandle.standardInput.readDataToEndOfFile()
let units = try JSONSerialization.jsonObject(with: data) as! [[UInt16]]
let inputs = units.map { String(decoding: $0, as: UTF16.self) }
let results: [Any] = inputs.map { input in
  guard let match = MentionTypeaheadConfiguration.match(input) else { return NSNull() }
  return ["leadOffset": match.leadOffset, "matchingString": match.matchingString, "replaceableString": match.replaceableString] as [String: Any]
}
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: results))
`,
  );
  try {
    const process = Bun.spawn(["swift", path], {
      stdin: Buffer.from(
        JSON.stringify(
          inputs.map((input) =>
            input.split("").map((unit) => unit.charCodeAt(0)),
          ),
        ),
      ),
      stdout: "pipe",
      stderr: "pipe",
    });
    const actual = await new Response(process.stdout).text();
    const error = await new Response(process.stderr).text();
    expect(await process.exited, error).toBe(0);
    const native = JSON.parse(actual);
    const expected = inputs.map((input) => matchAtSignMention(input, 1));
    const mismatch = inputs.findIndex(
      (_, index) =>
        JSON.stringify(native[index]) !== JSON.stringify(expected[index]) &&
        (native[index]?.leadOffset !== expected[index]?.leadOffset ||
          native[index]?.matchingString !== expected[index]?.matchingString ||
          native[index]?.replaceableString !==
            expected[index]?.replaceableString),
    );
    expect(
      mismatch,
      mismatch < 0
        ? ""
        : JSON.stringify({
            input: inputs[mismatch],
            native: native[mismatch],
            source: expected[mismatch],
          }),
    ).toBe(-1);
    expect(await Bun.file(MENTIONS_PATH).text()).toBe(await swiftForMentions());
  } finally {
    await unlink(path);
  }
}, 30000);

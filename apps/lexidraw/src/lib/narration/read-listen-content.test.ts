import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { readListenContent } from "./read-listen-content";
import { replaceDocumentRoot } from "../document-payload";
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      new URL(`./fixtures/saved-recording-v1/${name}.json`, import.meta.url),
    ),
  );
const original = {
  kind: "saved-recording",
  text: "  Legacy <script>雪 & hello</script>\n",
  audioUrl: "https://example.invalid/saved.mp3?x=%2F&y=1",
} as const;
test("injected ordinary content read exposes original saved media without a generated job", async () => {
  const raw = fixture("valid"),
    before = raw.slice();
  const result = await readListenContent(
    async () => ({ raw, storageType: "text" }),
    async () => ({ segments: [], stitchedUrl: undefined }),
  );
  expect(result).toEqual({
    segments: [],
    stitchedUrl: undefined,
    savedRecording: original,
  });
  expect(raw).toEqual(before);
});
for (const [name, reason] of [
  ["duplicate", "corrupt-payload"],
  ["extra-audio", "unsupported-tts"],
  ["unsupported-version", "unsupported-payload"],
] as const) {
  test(`injected ${name} read returns STOP without changing bytes or generated content`, async () => {
    const raw = fixture(name),
      before = raw.slice(),
      segments = [
        {
          index: 0,
          text: "Generated",
          audioUrl: "https://example.invalid/generated",
        },
      ];
    const result = await readListenContent(
      async () => ({ raw, storageType: "text" }),
      async () => ({ segments }),
    );
    expect(result.savedRecording).toEqual({ kind: "stop", reason });
    expect(result.segments).toBe(segments);
    expect(raw).toEqual(before);
  });
}
test("root-only edit read keeps original recording unrelated to edited text", async () => {
  const raw = fixture("valid"),
    before = raw.slice();
  const revised = replaceDocumentRoot(raw, {
    kind: "replace-root",
    elements: new TextDecoder()
      .decode(fixture("none"))
      .replace("No audio", "Later edit"),
  });
  const result = await readListenContent(
    async () => ({ raw: revised, storageType: "text" }),
    async () => ({ segments: [] }),
  );
  expect(new TextDecoder().decode(revised)).toContain('"text":"Later edit"');
  expect(result.savedRecording).toEqual(original);
  expect(raw).toEqual(before);
  expect(new TextDecoder().decode(revised)).toContain(
    '"unknown":{"retain":"\\u2603","number":1.00}',
  );
});
test("manifest content return is wired to injected read seam", () => {
  const source = readFileSync(
    new URL("../../server/api/routers/tts.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf(
    "      return ",
    source.indexOf("  getDocumentTtsManifest:"),
  );
  const manifest = source.slice(start, source.indexOf("    }),", start));
  expect(manifest).toContain("return readListenContent(");
});

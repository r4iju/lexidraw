import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { projectSavedRecording } from "./saved-recording";
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      new URL(`./fixtures/saved-recording-v1/${name}.json`, import.meta.url),
    ),
  );
const valid = fixture("valid");
const none = fixture("none");
const bytes = (value: string) => new TextEncoder().encode(value);
const replaceAudio = (audio: string) =>
  bytes(
    `${new TextDecoder().decode(none).trim().slice(0, -1)},"tts":${audio}}`,
  );

test("projects only original saved text and URL without changing source bytes", () => {
  const before = valid.slice();
  const expected = {
    kind: "saved-recording",
    text: "  Legacy <script>雪 & hello</script>\n",
    audioUrl: "https://example.invalid/saved.mp3?x=%2F&y=1",
  } as const;
  expect(projectSavedRecording(valid, "text")).toEqual(expected);
  expect(projectSavedRecording(valid.buffer, "text")).toEqual(expected);
  expect(projectSavedRecording(valid, "text")).toEqual(expected);
  expect(valid).toEqual(before);
  const textDetail = bytes(
    new TextDecoder().decode(valid).replace('"detail":0', '"detail":1'),
  );
  expect(projectSavedRecording(textDetail, "text")).toEqual(expected);
});
test("no recording means a supported full document without tts, never an unsupported root", () => {
  expect(projectSavedRecording(none, "text")).toEqual({ kind: "none" });
  const emptyRoot = bytes(
    '{"root":{"children":[],"direction":null,"format":"","indent":0,"type":"root","version":1}}',
  );
  expect(projectSavedRecording(emptyRoot, "text")).toEqual({ kind: "none" });
  expect(projectSavedRecording(fixture("unsupported-version"), "text")).toEqual(
    { kind: "stop", reason: "unsupported-payload" },
  );
});
for (const [label, raw] of [
  ["escaped duplicate audio key", fixture("duplicate")],
  [
    "duplicate top-level tts",
    bytes(`${new TextDecoder().decode(valid).trim().slice(0, -1)},"tts":null}`),
  ],
  [
    "duplicate unknown metadata",
    bytes(
      new TextDecoder()
        .decode(valid)
        .replace('"number":1.00', '"number":1.00,"number":2'),
    ),
  ],
  ["trailing junk", bytes(`${new TextDecoder().decode(valid)}false`)],
  ["invalid JSON", bytes('{"root":')],
  ["fatal UTF8", new Uint8Array([0xc3, 0x28])],
  ["BOM", bytes(`\ufeff${new TextDecoder().decode(valid)}`)],
  ["depth bounds", replaceAudio(`${"[".repeat(258)}0${"]".repeat(258)}`)],
] as const)
  test(`${label} STOP with no partial saved media`, () => {
    const before = raw.slice();
    expect(projectSavedRecording(raw, "text")).toEqual({
      kind: "stop",
      reason: "corrupt-payload",
    });
    expect(raw).toEqual(before);
  });
for (const [label, audio] of [
  ["null", "null"],
  ["primitive", '"audio"'],
  ["array", "[]"],
  ["empty object", "{}"],
  ["missing URL", '{"text":"Secret"}'],
  ["wrong type", '{"text":"Secret","audioUrl":7}'],
  ["blank text", '{"text":"  ","audioUrl":"https://example.invalid/audio"}'],
  ["blank URL", '{"text":"Secret","audioUrl":"\\n "}'],
  [
    "structured generated",
    '{"provider":"local","id":"job","segments":[],"stitchedUrl":"https://example.invalid/generated"}',
  ],
  [
    "nested",
    '{"audio":{"text":"Secret","audioUrl":"https://example.invalid/audio"}}',
  ],
] as const)
  test(`${label} audio is unsupported, never no recording`, () => {
    expect(projectSavedRecording(replaceAudio(audio), "text")).toEqual({
      kind: "stop",
      reason: "unsupported-tts",
    });
  });
test("additional audio fields STOP while retaining bytes", () => {
  const raw = fixture("extra-audio"),
    before = raw.slice();
  expect(projectSavedRecording(raw, "text")).toEqual({
    kind: "stop",
    reason: "unsupported-tts",
  });
  expect(raw).toEqual(before);
});
for (const [label, raw] of [
  [
    "node version",
    bytes(
      new TextDecoder()
        .decode(valid)
        .replace('"type":"text","version":1', '"type":"text","version":2'),
    ),
  ],
] as const)
  test(`${label} prevents playable saved projection`, () => {
    expect(projectSavedRecording(raw, "text")).toEqual({
      kind: "stop",
      reason: "unsupported-payload",
    });
  });
test("non-TEXT storage STOP", () => {
  expect(projectSavedRecording(valid, "blob")).toEqual({
    kind: "stop",
    reason: "corrupt-payload",
  });
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { projectSavedRecording } from "./saved-recording";
const original = readFileSync(
  new URL("./fixtures/saved-recording-v1/valid.json", import.meta.url),
  "utf8",
);
const persisted = original.replace(
  '"type":"paragraph"',
  '"textFormat":0,"textStyle":"","type":"paragraph"',
);
const bytes = (text: string) => new TextEncoder().encode(text);
const expected = {
  kind: "saved-recording" as const,
  text: "  Legacy <script>雪 & hello</script>\n",
  audioUrl: "https://example.invalid/saved.mp3?x=%2F&y=1",
};
test("ordinary persisted paragraph fields preserve exact recording and none distinction", () => {
  expect(projectSavedRecording(bytes(persisted), "text")).toEqual(expected);
  const envelope = JSON.parse(persisted);
  delete envelope.tts;
  expect(
    projectSavedRecording(bytes(JSON.stringify(envelope)), "text"),
  ).toEqual({ kind: "none" });
});
test("persisted compatibility gates supported defaults before rejecting unknown fields, versions, nodes and format state", () => {
  expect(projectSavedRecording(bytes(persisted), "text")).toEqual(expected);
  for (const [from, to] of [
    ['"textFormat":0', '"textFormat":1'],
    ['"textFormat":0', '"textFormat":"0"'],
    ['"textStyle":""', '"textStyle":"color:red"'],
    ['"textStyle":""', '"textStyle":null'],
    ['"textFormat":0,', ""],
    ['"textStyle":"",', ""],
    ['"type":"paragraph"', '"type":"heading"'],
    ['"type":"paragraph","version":1', '"type":"paragraph","version":2'],
    ['"type":"root","version":1', '"type":"root","version":2'],
    ['"type":"text","version":1', '"type":"text","version":2'],
    ['"textFormat":0', '"unknown":true,"textFormat":0'],
    ['"type":"root"', '"unknown":true,"type":"root"'],
    ['"detail":0', '"unknown":true,"detail":0'],
    ['"format":""', '"format":"center"'],
    ['"direction":null', '"direction":"rtl"'],
    ['"indent":0', '"indent":1'],
    ['"format":0', '"format":1'],
  ] as const) {
    expect(persisted).toContain(from);
    expect(
      projectSavedRecording(bytes(persisted.replace(from, to)), "text"),
    ).toEqual({ kind: "stop", reason: "unsupported-payload" });
  }
});
test("persisted compatibility keeps byte grammar, budgets and exact audio validation", () => {
  expect(projectSavedRecording(bytes(persisted), "text")).toEqual(expected);
  const corrupt = [
    `${persisted}false`,
    persisted.replace('"textFormat":0', '"textFormat":0,"textFormat":0'),
    persisted.replace('"number":1.00', '"number":1.00,"number":2'),
    persisted.replace('"textFormat":0', '"textFormat":0,"text\\u0046ormat":0'),
    '{"root":',
    `\ufeff${persisted}`,
    persisted.replace(
      '"number":1.00',
      `"number":${"[".repeat(258)}0${"]".repeat(258)}`,
    ),
    persisted.replace('"number":1.00', `"number":[${"0,".repeat(1_000_000)}0]`),
  ];
  for (const raw of [...corrupt.map(bytes), new Uint8Array([0xc3, 0x28])])
    expect(projectSavedRecording(raw, "text")).toEqual({
      kind: "stop",
      reason: "corrupt-payload",
    });
  for (const audio of [
    null,
    {},
    { text: "x", audioUrl: 7 },
    { text: " ", audioUrl: "x" },
    { text: "x", audioUrl: " " },
    { text: "x", audioUrl: "x", extra: true },
    { segments: [] },
  ] as const) {
    const envelope = JSON.parse(persisted);
    envelope.tts = audio;
    expect(
      projectSavedRecording(bytes(JSON.stringify(envelope)), "text"),
    ).toEqual({ kind: "stop", reason: "unsupported-tts" });
  }
  const raw = bytes(persisted),
    before = raw.slice();
  projectSavedRecording(raw, "text");
  expect(raw).toEqual(before);
});

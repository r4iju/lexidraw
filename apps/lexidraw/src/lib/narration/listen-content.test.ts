import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { listenContent } from "./listen-content";
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      new URL(`./fixtures/saved-recording-v1/${name}.json`, import.meta.url),
    ),
  );
test("ordinary content exposes a saved recording with no generated job", () => {
  const generated = { segments: [], stitchedUrl: undefined };
  expect(listenContent(generated, fixture("valid"), "text")).toEqual({
    segments: [],
    stitchedUrl: undefined,
    savedRecording: {
      kind: "saved-recording",
      text: "  Legacy <script>雪 & hello</script>\n",
      audioUrl: "https://example.invalid/saved.mp3?x=%2F&y=1",
    },
  });
  expect(generated).toEqual({ segments: [], stitchedUrl: undefined });
});
test("saved STOP leaves generated content and identities untouched", () => {
  const segments = [
    {
      index: 0,
      text: "Generated",
      audioUrl: "https://example.invalid/generated",
    },
  ];
  const generated = {
    segments,
    stitchedUrl: "https://example.invalid/stitched",
  };
  const result = listenContent(generated, fixture("extra-audio"), "text");
  expect(result.savedRecording).toEqual({
    kind: "stop",
    reason: "unsupported-tts",
  });
  expect(result.segments).toBe(segments);
  expect(result.stitchedUrl).toBe("https://example.invalid/stitched");
  expect(generated).toEqual({
    segments: [
      {
        index: 0,
        text: "Generated",
        audioUrl: "https://example.invalid/generated",
      },
    ],
    stitchedUrl: "https://example.invalid/stitched",
  });
});

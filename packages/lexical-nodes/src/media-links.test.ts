import { expect, test } from "bun:test";
import { figmaEmbedUrl, mediaLink } from "./media-links.js";

test("an embed links to its source only when its id can name one", () => {
  expect(mediaLink("youtube", "dQw4w9WgXcQ")).toBe(
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  expect(mediaLink("youtube", "a-b_c-d_e-f")).toBe(
    "https://www.youtube.com/watch?v=a-b_c-d_e-f",
  );
  expect(mediaLink("tweet", "20")).toBe("https://x.com/i/web/status/20");
  expect(mediaLink("figma", "LKQ4FJ4bTnCSjedbRpk931")).toBe(
    "https://www.figma.com/file/LKQ4FJ4bTnCSjedbRpk931",
  );
  for (const id of ["", "fixture-unavailable", "dQw4w9WgXc", "dQw4w9WgXcQQ"])
    expect(mediaLink("youtube", id)).toBeUndefined();
  for (const id of ["", "abc", "12 34", "123456789012345678901"])
    expect(mediaLink("tweet", id)).toBeUndefined();
  for (const id of ["", "fixture-unavailable", "LKQ4FJ4bTnCSjedbRpk93"])
    expect(mediaLink("figma", id)).toBeUndefined();
});

test("a Figma file is embedded through an encoded embed address", () => {
  expect(
    figmaEmbedUrl("https://www.figma.com/file/LKQ4FJ4bTnCSjedbRpk931"),
  ).toBe(
    "https://www.figma.com/embed?embed_host=lexidraw&url=https%3A%2F%2Fwww.figma.com%2Ffile%2FLKQ4FJ4bTnCSjedbRpk931",
  );
});

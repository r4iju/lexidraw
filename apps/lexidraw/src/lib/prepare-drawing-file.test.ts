/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { preparation } from "./prepare-drawing-file";

describe("an image put in a drawing", () => {
  test.each([
    ["image/png", 1440, 900],
    ["image/jpeg", 900, 1440],
    ["image/gif", 800, 600],
    ["image/webp", 10, 10],
    ["image/avif", 1440, 1440],
  ] as const)(
    "is kept as picked when a %s of %ix%i",
    (mimeType, width, height) => {
      expect(preparation(mimeType, { width, height })).toEqual({
        kind: "keep",
        mimeType,
      });
    },
  );

  test("is kept as the editor normalized it when an SVG, however large", () => {
    expect(
      preparation("image/svg+xml", { width: 10_000, height: 10_000 }),
    ).toEqual({ kind: "keep", mimeType: "image/svg+xml" });
  });

  test.each([
    ["image/png", 2880, 1000, "image/png", 1440, 500],
    ["image/jpeg", 1000, 2880, "image/jpeg", 500, 1440],
    ["image/webp", 1441, 1441, "image/webp", 1440, 1440],
  ] as const)(
    "is scaled to 1440 on its longer side when a larger %s of %ix%i",
    (mimeType, width, height, type, toWidth, toHeight) => {
      expect(preparation(mimeType, { width, height })).toEqual({
        kind: "scale",
        mimeType: type,
        width: toWidth,
        height: toHeight,
      });
    },
  );

  test.each([
    ["image/gif", 3000, 1500, 1440, 720],
    ["image/avif", 2000, 1000, 1440, 720],
    ["image/bmp", 100, 50, 100, 50],
    ["image/x-icon", 32, 32, 32, 32],
  ] as const)(
    "becomes a PNG when a %s of %ix%i, which a drawing stores only small or not at all",
    (mimeType, width, height, toWidth, toHeight) => {
      expect(preparation(mimeType, { width, height })).toEqual({
        kind: "scale",
        mimeType: "image/png",
        width: toWidth,
        height: toHeight,
      });
    },
  );

  test("keeps at least a pixel on its shorter side", () => {
    expect(preparation("image/png", { width: 20_000, height: 1 })).toEqual({
      kind: "scale",
      mimeType: "image/png",
      width: 1440,
      height: 1,
    });
  });
});

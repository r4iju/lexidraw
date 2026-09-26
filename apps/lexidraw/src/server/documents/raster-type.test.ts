/// <reference types="bun" />
import { expect, test } from "bun:test";
import { type RasterType, rasterTypeOf } from "./raster-type";

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part,
    ),
  );

test.each<[string, Uint8Array, RasterType | undefined]>([
  ["a PNG", bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
  ["a JPEG", bytes([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
  ["a GIF", bytes("GIF89a"), "image/gif"],
  ["a WebP", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "image/webp"],
  ["an AVIF", bytes([0, 0, 0, 0x1c], "ftypavif"), "image/avif"],
  ["an icon", bytes([0, 0, 1, 0, 1, 0]), "image/x-icon"],
  ["an SVG", bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"), undefined],
  ["a HEIC", bytes([0, 0, 0, 0x18], "ftypheic"), undefined],
  ["a WAV", bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "), undefined],
  ["a page", bytes("<!doctype html>"), undefined],
])("%s is %s", (_, data, type) => {
  expect(rasterTypeOf(data)).toBe(type);
});

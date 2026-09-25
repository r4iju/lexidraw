/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { imageSizeOf } from "./image-size";

/** 37×23 pictures as their encoders wrote them. */
const SAMPLES = {
  png: "iVBORw0KGgoAAAANSUhEUgAAACUAAAAXEAIAAABT3s2xAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAHdElNRQfqCRkGGyTKsrvZAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTA5LTI1VDA2OjI3OjM2KzAwOjAw+UGjwgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0wOS0yNVQwNjoyNzozNiswMDowMIgcG34AAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMDktMjVUMDY6Mjc6MzYrMDA6MDDfCTqhAAAAmElEQVRYw+2YMQ2AMBBFX5NuZYYdAQhAACoo4kAFAhCAAHbYjxlUXC699Cl4L/m5Jg3fh2OCzJA2aw21vHuHbrLWUMu7Wugfaw0toizQrNYaWoTjhHGw1tAivtnzaYmSoal5ZVLHWTLxXVznSYbk9t1zP856WsrFe14dZ8GE/oGrtdZQy+smuHdrDbW8tIHM1hpqeQB+f8t+Tp4uMES6zBwAAAAASUVORK5CYII=",
  gif: "R0lGODlhJQAXAPQAAP8AAPMADOgAF9wAI9EALsUAOrkARq4AUaIAXZcAaIsAdHQAi2gAl10AolEArkYAuToAxS4A0SMA3BcA6AwA8wAA/4AAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAAAAAAALAAAAAAlABcAAAXBICCOZGmeKBCsbOu+cBwIdG3feK4LQ+//wKBwOCAYj8ikcskkFJ7QqHRKrRYM2Kx2y+16DYeweEwum88HhHrNbrvfcERiTq/b7/h8QsHv+/+AgYIKFoWGh4iJiosWC46PkJGSk5QLDJeYmZqbnJ0MDaChoqOkpaYNDqmqq6ytrq8OD7KztLW2t7gPELu8vb6/wMEQEcTFxsfIycoREs3Oz9DR0tMSE9bX2Nna29wTFN/g4eLj5OUUFejp6uvs7e4VIQA7",
  jpeg: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAXACUDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAQF/8QAFRABAQAAAAAAAAAAAAAAAAAAABL/xAAWAQEBAQAAAAAAAAAAAAAAAAAABgP/xAAaEQACAgMAAAAAAAAAAAAAAAAAAhNhFBVR/9oADAMBAAIRAxEAPwDBstPZbfX0UmdZRZaeyzX0M6yixPYa+hnWTWWCwiThKysLLAiTglYWARJwSsf/2Q==",
  progressiveJpeg:
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wgARCAAXACUDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAME/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUC/9oADAMBAAIQAxAAAAHAm3SomKJiQsSgAP/EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEAAQUCf//EABcRAQADAAAAAAAAAAAAAAAAAAABEhP/2gAIAQMBAT8B3bt1pWlaX//EABcRAQADAAAAAAAAAAAAAAAAAAABEhT/2gAIAQIBAT8Bzs7OrCsKw//EABQQAQAAAAAAAAAAAAAAAAAAADD/2gAIAQEABj8Cf//EABUQAQEAAAAAAAAAAAAAAAAAAAAR/9oACAEBAAE/Iaqqqqqqqqqv/9oADAMBAAIAAwAAABAIIL777//EABYRAQEBAAAAAAAAAAAAAAAAAHEAIP/aAAgBAwEBPxBSlir/xAAWEQEBAQAAAAAAAAAAAAAAAAAAYXH/2gAIAQIBAT8Qwwwmmm//xAAUEAEAAAAAAAAAAAAAAAAAAAAw/9oACAEBAAE/EH//AP8A/9k=",
  lossyWebp:
    "UklGRmIAAABXRUJQVlA4IFYAAADwAwCdASolABcAPxGEulc4qCWkpWgDECIJagDK4pBvARf8AoNeTYHsAP7q5aQ/mPUAZBZ/v/4j3a+E58GYti+0FTv6iQTE/6YKuScULfHAo9olgUAAAA==",
  losslessWebp:
    "UklGRkgAAABXRUJQVlA4TDwAAAAvJIAFALmM6H9sYsCj/xHUtm3D8P/TnToKCQj/95IJCIr8Hy3Utm3DuGfPFR4ilAyoU3zgUBnwh7+DRAA=",
  alphaWebp:
    "UklGRg4BAABXRUJQVlA4WAoAAAAQAAAAJAAAFgAAQUxQSGoAAAARR0AmYBm1BgI4JRFHRIRwTxjY1taeJEHXSAWtS0lJyUgO39xxGyCi/wzctm3E7t3e/YL4DNSseTCYsA9AbXBBhETvl5T6cUgWrVW2aR0yaJ0K6pjtSrfrMvJJCuevxn6usvkDVv8p2kAAVlA4IH4AAACwAwCdASolABcAPw10tFAsJyWisBqqqYAhiWwAw0ASoCh6+PMvAAD+54vt3cEzzYVZPv4C3jTIIt/3c9jaI7RX50xIe1DQ/A/4V/xbtI4Ufbc0uMljYws1dVM8RehPZBlmk2Y7Mo548Fy2X/4nQ1wGG4J++108gNRU6mAAAAA=",
  avif: "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAADkAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgUBsAAAAABRpc3BlAAAAAAAAACUAAAAXAAAAEHBpeGkAAAAAAwwMDAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAABBbWRhdBIACglYFSSzWgIaDcIyKhxHh4Xd19994sUUANyoNyCvBV4tGkmFLZBtRrtkxtWxmbQ1TjoZc1YcWA==",
};

const bytes = (base64: string) =>
  Uint8Array.from(Buffer.from(base64, "base64"));

/** A JPEG whose Exif says it is shown turned a quarter, as a phone writes it. */
function turned(jpeg: Uint8Array, orientation: number) {
  const tiff = [
    ...[0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08],
    ...[0x00, 0x01],
    ...[0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01],
    ...[0x00, orientation, 0x00, 0x00],
    ...[0x00, 0x00, 0x00, 0x00],
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const length = payload.length + 2;
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    length >> 8,
    length & 0xff,
    ...payload,
    ...jpeg.subarray(2),
  ]);
}

const svg = (source: string) => new TextEncoder().encode(source);

describe("a picture's size, from its first bytes", () => {
  test("PNG, GIF, JPEG, WebP and AVIF", () => {
    for (const [format, base64] of Object.entries(SAMPLES))
      expect([format, imageSizeOf(bytes(base64))]).toEqual([
        format,
        { width: 37, height: 23 },
      ]);
  });

  test("a JPEG shown turned a quarter is as tall as it is stored wide", () => {
    const jpeg = bytes(SAMPLES.jpeg);
    expect(imageSizeOf(turned(jpeg, 6))).toEqual({ width: 23, height: 37 });
    expect(imageSizeOf(turned(jpeg, 3))).toEqual({ width: 37, height: 23 });
  });

  test("an SVG that says how big it is, in pixels", () => {
    expect(
      imageSizeOf(
        svg(
          '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="640" height="360px" viewBox="0 0 64 36"></svg>',
        ),
      ),
    ).toEqual({ width: 640, height: 360 });
    expect(
      imageSizeOf(svg('<svg viewBox="0 0 64 36" width="100%"></svg>')),
    ).toBeUndefined();
  });

  test("the first bytes alone, before the size arrives, are not a size", () => {
    for (const base64 of Object.values(SAMPLES))
      expect(imageSizeOf(bytes(base64).subarray(0, 6))).toBeUndefined();
    expect(
      imageSizeOf(svg("<html><body>Not found</body></html>")),
    ).toBeUndefined();
  });
});

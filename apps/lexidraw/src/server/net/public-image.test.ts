/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { Resolve } from "@packages/lib/public-address";
import { readPublicImage } from "./public-image";
import type { Hop } from "./public-fetch";

const resolve: Resolve = async () => [{ address: "93.184.215.14", family: 4 }];
const PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACUAAAAXEAI=", "base64"),
);
const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

const serving =
  (
    bytes: Uint8Array<ArrayBuffer>,
    contentType: string,
    asked: string[] = [],
  ): Hop =>
  async (url) => {
    asked.push(url.href);
    return new Response(bytes, { headers: { "content-type": contentType } });
  };

describe("a link's picture, read to keep", () => {
  test("is kept as the picture its bytes say it is, whatever it was served as", async () => {
    const image = await readPublicImage("https://news.example/cover", {
      resolve,
      hop: serving(PNG, "image/jpeg"),
    });
    expect(image?.contentType).toBe("image/png");
    expect(image?.bytes).toEqual(PNG);
  });

  test("is not kept when it is SVG or no picture at all", async () => {
    for (const [bytes, type] of [
      [SVG, "image/svg+xml"],
      [SVG, "image/png"],
      [new TextEncoder().encode("<html></html>"), "image/png"],
    ] as const)
      expect(
        await readPublicImage("https://news.example/cover", {
          resolve,
          hop: serving(bytes, type),
        }),
      ).toBeUndefined();
  });

  test("is not asked for at a private address", async () => {
    const asked: string[] = [];
    for (const src of [
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "http://[::ffff:a9fe:a9fe]/",
      "http://0xa9fea9fe/",
    ])
      expect(
        await readPublicImage(src, {
          resolve,
          hop: serving(PNG, "image/png", asked),
        }),
      ).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("is not kept past the size allowed", async () => {
    const big = new Uint8Array(2048);
    big.set(PNG);
    expect(
      await readPublicImage("https://news.example/cover", {
        resolve,
        hop: serving(big, "image/png"),
        maxBytes: 1024,
      }),
    ).toBeUndefined();
  });
});

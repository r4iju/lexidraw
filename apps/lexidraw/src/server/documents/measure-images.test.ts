/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { measureImages } from "./measure-images";

const image = (src: string, extra: Record<string, unknown> = {}) => ({
  type: "image",
  version: 1,
  src,
  altText: "",
  width: 0,
  height: 0,
  maxWidth: 800,
  showCaption: false,
  ...extra,
});
const paragraph = (...children: unknown[]) => ({
  type: "paragraph",
  version: 1,
  children,
});
const documentOf = (...children: unknown[]) =>
  JSON.stringify({ root: { type: "root", version: 1, children } });

/** The natural sizes a document stores, image by image. */
const naturals = (elements: string) =>
  (
    JSON.parse(elements) as {
      root: { children: { children: { $?: { natural?: unknown } }[] }[] };
    }
  ).root.children.flatMap((block) =>
    block.children.map((child) => child.$?.natural),
  );

describe("a document's pictures are measured as it is written", () => {
  test("an outside picture without a size gets one; the rest are left as they are", async () => {
    const asked: string[] = [];
    const written = await measureImages(
      documentOf(
        paragraph(image("https://images.example/wide.jpg")),
        paragraph(
          image("https://images.example/kept.jpg", {
            $: { natural: { width: 10, height: 10 } },
          }),
        ),
        paragraph(image("/images/banner.png")),
        paragraph(image("https://images.example/broken.jpg")),
      ),
      {
        probe: async (src) => {
          asked.push(src);
          return src.endsWith("wide.jpg")
            ? { width: 1600, height: 1200 }
            : undefined;
        },
      },
    );
    expect(naturals(written)).toEqual([
      { width: 1600, height: 1200 },
      { width: 10, height: 10 },
      undefined,
      undefined,
    ]);
    expect(asked.sort()).toEqual([
      "https://images.example/broken.jpg",
      "https://images.example/wide.jpg",
    ]);
  });

  test("pictures are measured together, a few per write, each address once", async () => {
    let running = 0;
    let most = 0;
    const asked: string[] = [];
    const sources = Array.from(
      { length: 12 },
      (_, index) => `https://images.example/${index % 10}.png`,
    );
    const written = await measureImages(
      documentOf(...sources.map((src) => paragraph(image(src)))),
      {
        limit: 8,
        probe: async (src) => {
          asked.push(src);
          running++;
          most = Math.max(most, running);
          await new Promise((settle) => setTimeout(settle, 10));
          running--;
          return { width: 4, height: 3 };
        },
      },
    );
    expect(asked).toHaveLength(8);
    expect(new Set(asked).size).toBe(8);
    expect(most).toBe(8);
    // The two that repeat an address measured with it; 8 and 9 wait.
    expect(naturals(written).map(Boolean)).toEqual([
      ...Array(8).fill(true),
      false,
      false,
      true,
      true,
    ]);
  });

  test("a write with nothing to measure, or that is not a document, is stored as sent", async () => {
    const probe = async () => ({ width: 1, height: 1 });
    const plain = documentOf(paragraph({ type: "text", text: "Hi" }));
    expect(await measureImages(plain, { probe })).toBe(plain);
    const drawing = JSON.stringify([
      { type: "image", src: "https://images.example/a.png" },
    ]);
    expect(await measureImages(drawing, { probe })).toBe(drawing);
    expect(await measureImages("not json", { probe })).toBe("not json");
  });

  test("a picture that could not be measured is not asked for again for a while", async () => {
    let now = 0;
    const asked: string[] = [];
    const probe = async (src: string) => {
      asked.push(src);
      return undefined;
    };
    const elements = documentOf(
      paragraph(image("https://images.example/down.png")),
    );
    const failures = new Map<string, number>();
    await measureImages(elements, { probe, failures, now: () => now });
    await measureImages(elements, { probe, failures, now: () => now });
    now += 11 * 60 * 1000;
    await measureImages(elements, { probe, failures, now: () => now });
    expect(asked).toHaveLength(2);
  });
});

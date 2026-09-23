/// <reference types="bun" />
import { describe, expect, it } from "bun:test";

import {
  type DrawingTools,
  InvalidDrawingError,
  normalizeDrawingElements,
  type SkeletonConverter,
} from "./normalize";
import {
  type DrawingElement,
  DrawingElements,
  isSkeletonElement,
  MAX_DRAWING_ELEMENTS,
  MERMAID_REJECTION,
} from "./skeleton-schema";

/** Stands in for the converter so the pure half needs no DOM. */
const converted: SkeletonConverter = (skeleton) =>
  skeleton.map((element, index) => ({
    ...(element as Record<string, unknown>),
    id: (element as { id?: string }).id ?? `generated-${index}`,
    version: 1,
    seed: 1,
  }));

/** The real restorer is Excalidraw's; here it only has to not interfere. */
const tools =
  (convert: SkeletonConverter = converted): (() => Promise<DrawingTools>) =>
  async () => ({ convert, restore: (elements) => elements });

const normalize = (
  elements: readonly DrawingElement[],
  convert?: SkeletonConverter,
) => normalizeDrawingElements(elements, tools(convert));

const parse = (elements: unknown[]): DrawingElement[] =>
  DrawingElements.parse(elements);

const raw = (id: string, over: Record<string, unknown> = {}) => ({
  type: "rectangle",
  id,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  version: 7,
  versionNonce: 1,
  seed: 2,
  isDeleted: false,
  ...over,
});

describe("isSkeletonElement", () => {
  it("reads an element with no editor bookkeeping as shorthand", () => {
    const [element] = parse([{ type: "rectangle", x: 0, y: 0 }]);
    expect(isSkeletonElement(element as DrawingElement)).toBe(true);
  });

  it("reads a stored element as canonical", () => {
    const [element] = parse([raw("a")]);
    expect(isSkeletonElement(element as DrawingElement)).toBe(false);
  });

  it("reads a stored element carrying a label as shorthand", () => {
    const [element] = parse([raw("a", { label: { text: "hi" } })]);
    expect(isSkeletonElement(element as DrawingElement)).toBe(true);
  });

  it("reads a sticky note as shorthand", () => {
    const [element] = parse([
      { type: "stickynote", x: 0, y: 0, text: "hi", version: 1 },
    ]);
    expect(isSkeletonElement(element as DrawingElement)).toBe(true);
  });
});

describe("normalizeDrawingElements", () => {
  it("stores raw elements untouched", async () => {
    const input = [raw("a"), raw("b", { x: 30 })];
    expect(await normalize(parse(input))).toEqual(input);
  });

  it("keeps deleted elements, so a read and write back loses nothing", async () => {
    const input = [raw("a", { isDeleted: true })];
    expect(await normalize(parse(input))).toEqual(input);
  });

  it("sends shorthand through the converter", async () => {
    const result = await normalize(
      parse([{ type: "rectangle", id: "a", x: 0, y: 0, label: { text: "A" } }]),
    );
    expect(result).toEqual([
      {
        type: "rectangle",
        id: "a",
        x: 0,
        y: 0,
        label: { text: "A" },
        version: 1,
        seed: 1,
      },
    ]);
  });

  it("expands a sticky note into a filled labelled rectangle", async () => {
    const [note] = await normalize(
      parse([{ type: "stickynote", id: "n", x: 5, y: 6, text: "todo" }]),
    );
    expect(note).toMatchObject({
      type: "rectangle",
      id: "n",
      x: 5,
      y: 6,
      width: 180,
      height: 180,
      backgroundColor: "#fff9db",
      fillStyle: "solid",
      label: { text: "todo" },
    });
    expect(note).not.toHaveProperty("text");
  });

  it("keeps a caller's background colour on a sticky note", async () => {
    const [note] = await normalize(
      parse([
        {
          type: "stickynote",
          id: "n",
          x: 0,
          y: 0,
          text: "todo",
          backgroundColor: "#ffc9c9",
        },
      ]),
    );
    expect(note).toMatchObject({ backgroundColor: "#ffc9c9" });
  });

  it("puts the converted batch where the first shorthand element was", async () => {
    const first = raw("first");
    const last = raw("last");
    const result = await normalize(
      parse([first, { type: "rectangle", id: "s", x: 0, y: 0 }, last]),
      // Two elements out of one, the way a labelled shape converts.
      (skeleton) => [
        ...(skeleton as readonly Record<string, unknown>[]),
        { id: "label", type: "text" },
      ],
    );
    expect(result.map((element) => element.id)).toEqual([
      "first",
      "s",
      "label",
      "last",
    ]);
  });

  it("refuses a duplicate id", async () => {
    expect(normalize(parse([raw("a"), raw("a")]))).rejects.toThrow(
      InvalidDrawingError,
    );
  });

  it("refuses a binding to an id the converter will not see", async () => {
    expect(
      normalize(
        parse([
          raw("box"),
          { type: "arrow", x: 0, y: 0, start: { id: "box" } },
        ]),
      ),
    ).rejects.toThrow(/not a skeleton element/);
  });

  it("refuses a frame child the converter will not see", async () => {
    expect(
      normalize(parse([raw("box"), { type: "frame", children: ["box"] }])),
    ).rejects.toThrow(/not a skeleton element/);
  });

  it("accepts bindings among shorthand elements", async () => {
    expect(
      normalize(
        parse([
          { type: "rectangle", id: "a", x: 0, y: 0 },
          { type: "rectangle", id: "b", x: 300, y: 0 },
          { type: "arrow", x: 10, y: 10, start: { id: "a" }, end: { id: "b" } },
          { type: "frame", id: "f", children: ["a", "b"] },
        ]),
      ),
    ).resolves.toBeDefined();
  });
});

describe("DrawingElements", () => {
  it("rejects a non-numeric dimension", () => {
    const result = DrawingElements.safeParse([
      { type: "rectangle", id: "a", x: 0, y: 0, width: "x", height: 10 },
    ]);
    expect(result.success).toBe(false);
  });

  it("rejects an element type the editor does not store", () => {
    expect(
      DrawingElements.safeParse([
        { type: "nonsense", id: "a", x: 0, y: 0, width: 1, height: 1 },
      ]).success,
    ).toBe(false);
  });

  // Mermaid parses, so the refusal can carry its own message instead of
  // arriving as "Input validation failed"; normalizing is what refuses it.
  it("lets mermaid through the schema so normalizing can name it", async () => {
    for (const element of [
      { type: "mermaid", definition: "graph TD;" },
      { type: "rectangle", x: 0, y: 0, mermaid: "graph TD;" },
      { mermaid: "graph TD;" },
    ]) {
      const parsed = DrawingElements.parse([element]);
      expect(normalize(parsed)).rejects.toThrow(MERMAID_REJECTION);
    }
  });

  const issuePaths = (elements: unknown[]) =>
    DrawingElements.safeParse(elements).error?.issues.map((issue) =>
      issue.path.join("."),
    );

  it("measures an element against the shape it is, not the other one", () => {
    // Canonical but for the missing height: the shorthand would have taken it,
    // which is how an unchecked element used to reach the converter.
    expect(
      issuePaths([
        raw("a"),
        { type: "rectangle", id: "b", x: 0, y: 0, width: 1, version: 1 },
      ]),
    ).toEqual(["1.height"]);
  });

  it("refuses shorthand fields that are not objects", () => {
    expect(issuePaths([{ type: "arrow", x: 0, y: 0, start: "box" }])).toEqual([
      "0.start",
    ]);
    expect(
      issuePaths([{ type: "rectangle", x: 0, y: 0, label: "hello" }]),
    ).toEqual(["0.label"]);
  });

  it("refuses points that are not pairs of numbers", () => {
    expect(
      issuePaths([
        raw("a", {
          type: "arrow",
          points: [
            [0, 0],
            ["10", 5],
          ],
        }),
      ]),
    ).toEqual(["0.points.1.0"]);
  });

  it("refuses a stored text element with no text", () => {
    expect(issuePaths([raw("t", { type: "text" })])).toEqual(["0.text"]);
  });

  it("refuses anything that is not an element object", () => {
    expect(issuePaths(["rectangle"])).toEqual(["0"]);
  });

  it("refuses more elements than the editor can open", () => {
    const many = Array.from({ length: MAX_DRAWING_ELEMENTS + 1 }, (_, i) =>
      raw(`e${i}`),
    );
    expect(DrawingElements.safeParse(many).success).toBe(false);
    expect(DrawingElements.safeParse(many.slice(1)).success).toBe(true);
  });
});

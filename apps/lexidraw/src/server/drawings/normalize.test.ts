/// <reference types="bun" />
import { describe, expect, it } from "bun:test";

import {
  InvalidDrawingError,
  isSkeletonElement,
  normalizeDrawingElements,
  type SkeletonConverter,
} from "./normalize";
import {
  type DrawingElement,
  DrawingElements,
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
  it("stores raw elements untouched", () => {
    const input = [raw("a"), raw("b", { x: 30 })];
    expect(normalizeDrawingElements(parse(input), converted)).toEqual(input);
  });

  it("keeps deleted elements, so a read and write back loses nothing", () => {
    const input = [raw("a", { isDeleted: true })];
    expect(normalizeDrawingElements(parse(input), converted)).toEqual(input);
  });

  it("sends shorthand through the converter", () => {
    const result = normalizeDrawingElements(
      parse([{ type: "rectangle", id: "a", x: 0, y: 0, label: { text: "A" } }]),
      converted,
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

  it("expands a sticky note into a filled labelled rectangle", () => {
    const [note] = normalizeDrawingElements(
      parse([{ type: "stickynote", id: "n", x: 5, y: 6, text: "todo" }]),
      converted,
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

  it("keeps a caller's background colour on a sticky note", () => {
    const [note] = normalizeDrawingElements(
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
      converted,
    );
    expect(note).toMatchObject({ backgroundColor: "#ffc9c9" });
  });

  it("puts the converted batch where the first shorthand element was", () => {
    const first = raw("first");
    const last = raw("last");
    const result = normalizeDrawingElements(
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

  it("refuses a duplicate id", () => {
    expect(() =>
      normalizeDrawingElements(parse([raw("a"), raw("a")]), converted),
    ).toThrow(InvalidDrawingError);
  });

  it("refuses a binding to an id the converter will not see", () => {
    expect(() =>
      normalizeDrawingElements(
        parse([
          raw("box"),
          { type: "arrow", x: 0, y: 0, start: { id: "box" } },
        ]),
        converted,
      ),
    ).toThrow(/not a skeleton element/);
  });

  it("refuses a frame child the converter will not see", () => {
    expect(() =>
      normalizeDrawingElements(
        parse([raw("box"), { type: "frame", children: ["box"] }]),
        converted,
      ),
    ).toThrow(/not a skeleton element/);
  });

  it("accepts bindings among shorthand elements", () => {
    expect(() =>
      normalizeDrawingElements(
        parse([
          { type: "rectangle", id: "a", x: 0, y: 0 },
          { type: "rectangle", id: "b", x: 300, y: 0 },
          { type: "arrow", x: 10, y: 10, start: { id: "a" }, end: { id: "b" } },
          { type: "frame", id: "f", children: ["a", "b"] },
        ]),
        converted,
      ),
    ).not.toThrow();
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
  it("lets mermaid through the schema so normalizing can name it", () => {
    for (const element of [
      { type: "mermaid", definition: "graph TD;" },
      { type: "rectangle", x: 0, y: 0, mermaid: "graph TD;" },
    ]) {
      const parsed = DrawingElements.parse([element]);
      expect(() => normalizeDrawingElements(parsed, converted)).toThrow(
        MERMAID_REJECTION,
      );
    }
  });
});

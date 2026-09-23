/// <reference types="bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";

import type { CanonicalElement } from "./skeleton-schema";

const script = join(
  import.meta.dir,
  "..",
  "..",
  "test",
  "normalize-drawing.ts",
);

type Run = {
  elements: CanonicalElement[];
  before: string[];
  after: string[];
};

function run(elements: unknown[]): Run {
  const result = Bun.spawnSync({
    cmd: ["bun", script, JSON.stringify(elements)],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`normalizing failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout.toString());
}

function normalize(elements: unknown[]): CanonicalElement[] {
  return run(elements).elements;
}

const byId = (elements: CanonicalElement[], id: string) =>
  elements.find((element) => element.id === id);

let elements: CanonicalElement[];

beforeAll(() => {
  elements = normalize([
    {
      type: "rectangle",
      id: "start",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
      label: { text: "Start" },
    },
    {
      type: "rectangle",
      id: "end",
      x: 400,
      y: 0,
      width: 200,
      height: 100,
      label: { text: "End" },
    },
    {
      type: "arrow",
      id: "flow",
      x: 210,
      y: 50,
      label: { text: "then" },
      start: { id: "start" },
      end: { id: "end" },
    },
    { type: "stickynote", id: "note", x: 0, y: 300, text: "remember" },
    { type: "frame", id: "frame", children: ["start", "end"], name: "Flow" },
  ]);
});

describe("the skeleton converter", () => {
  it("keeps the ids the caller addressed its elements by", () => {
    for (const id of ["start", "end", "flow", "note", "frame"]) {
      expect(byId(elements, id)).toBeDefined();
    }
  });

  it("turns a label into a text element bound to its container", () => {
    const container = byId(elements, "start");
    const bound = container?.boundElements as { type: string; id: string }[];
    const label = bound.find((entry) => entry.type === "text");
    expect(byId(elements, label?.id as string)).toMatchObject({
      type: "text",
      text: "Start",
      containerId: "start",
    });
    // The arrow bound to it is there too, which is how the editor finds it.
    expect(bound.map((entry) => entry.type).sort()).toEqual(["arrow", "text"]);
  });

  it("gives a label real dimensions without a canvas", () => {
    const text = elements.find((element) => element.text === "Start");
    expect(text?.width).toBeGreaterThan(0);
    expect(text?.height).toBeGreaterThan(0);
  });

  it("binds an arrow to the elements its start and end name", () => {
    expect(byId(elements, "flow")).toMatchObject({
      startBinding: { elementId: "start" },
      endBinding: { elementId: "end" },
    });
  });

  it("puts a frame's children in the frame", () => {
    expect(byId(elements, "start")?.frameId).toBe("frame");
    expect(byId(elements, "end")?.frameId).toBe("frame");
    expect(byId(elements, "frame")?.type).toBe("frame");
  });

  it("makes a sticky note a filled rectangle carrying its text", () => {
    const note = byId(elements, "note");
    expect(note).toMatchObject({
      type: "rectangle",
      backgroundColor: "#fff9db",
      fillStyle: "solid",
    });
    const bound = note?.boundElements as { id: string }[];
    expect(byId(elements, bound[0]?.id as string)?.text).toBe("remember");
  });

  it("stamps every element with the fields the editor expects", () => {
    for (const element of elements) {
      expect(element).toMatchObject({
        id: expect.any(String),
        version: expect.any(Number),
        versionNonce: expect.any(Number),
        seed: expect.any(Number),
        isDeleted: false,
      });
    }
  });
});

it("leaves the globals as it found them", () => {
  // Drawing writes share a process with page rendering, and a `window` left
  // behind sends every later render down its browser branch.
  const result = run([{ type: "rectangle", id: "a", x: 0, y: 0 }]);
  expect(result.after).toEqual(result.before);
  expect(result.after).not.toContain("window");
});

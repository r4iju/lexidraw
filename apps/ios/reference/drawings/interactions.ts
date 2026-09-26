/**
 * What a person does in the editor, as steps both the web editor and the iOS
 * editor can replay: the recorder plays each script in web Excalidraw and
 * keeps the elements it ends with, and `DrawingKitTests` plays it again on
 * iOS and expects the same elements.
 *
 * Points are in scene coordinates, which are the page's own: the editor sits
 * at the top left, unscrolled and unzoomed.
 */
import type { Skeleton } from "./scenes.js";

type Point = [number, number];
type Pointer = "mouse" | "pen" | "touch";

export type Step =
  | {
      tool:
        | "selection"
        | "rectangle"
        | "diamond"
        | "ellipse"
        | "line"
        | "freedraw"
        | "text";
    }
  | { down: Point; pointer?: Pointer; pressure?: number }
  | { move: Point; pressure?: number }
  | { up: Point }
  | { doubleTap: Point }
  | { type: string }
  | { press: "Escape" | "Delete" | "undo" | "redo" };

export type Interaction = {
  name: string;
  before?: Skeleton[];
  steps: Step[];
};

/** A press, a drag through `path` and a lift where it ends. */
function drag(from: Point, path: Point[], pointer: Pointer = "touch"): Step[] {
  const end = path[path.length - 1] ?? from;
  return [
    { down: from, pointer },
    ...path.map((move): Step => ({ move })),
    { up: end },
  ];
}

const tap = (at: Point, pointer: Pointer = "touch"): Step[] => [
  { down: at, pointer },
  { up: at },
];

const filled: Skeleton = {
  type: "rectangle",
  id: "box",
  x: 200,
  y: 150,
  width: 160,
  height: 100,
  backgroundColor: "#a5d8ff",
  fillStyle: "solid",
  seed: 7,
};

/** A pencil stroke whose pressure rises and falls along a wave. */
const stroke: Step[] = [
  { down: [120, 300], pointer: "pen", pressure: 0.2 },
  ...Array.from({ length: 24 }, (_, index): Step => {
    const t = (index + 1) / 24;
    return {
      move: [120 + t * 300, 300 + Math.sin(t * Math.PI * 2) * 60],
      pressure: 0.2 + Math.sin(t * Math.PI) * 0.7,
    };
  }),
  { up: [420, 300] },
];

export const INTERACTIONS: Interaction[] = [
  ...(["rectangle", "diamond", "ellipse"] as const).map(
    (tool): Interaction => ({
      name: `draw-${tool}`,
      steps: [
        { tool },
        ...drag(
          [100, 120],
          [
            [140, 150],
            [260, 210],
            [310, 240],
          ],
        ),
      ],
    }),
  ),
  {
    name: "draw-backwards",
    steps: [
      { tool: "rectangle" },
      ...drag(
        [300, 300],
        [
          [250, 260],
          [180, 220],
        ],
      ),
    ],
  },
  {
    name: "draw-line",
    steps: [
      { tool: "line" },
      ...drag(
        [100, 100],
        [
          [180, 140],
          [320, 210],
        ],
      ),
    ],
  },
  { name: "draw-with-pencil", steps: [{ tool: "freedraw" }, ...stroke] },
  {
    name: "draw-with-finger",
    steps: [
      { tool: "freedraw" },
      ...drag(
        [100, 100],
        [
          [130, 120],
          [170, 115],
          [220, 160],
          [260, 150],
        ],
      ),
    ],
  },
  {
    name: "write-text",
    steps: [
      { tool: "text" },
      ...tap([150, 200]),
      { type: "Hello there" },
      { press: "Escape" },
    ],
  },
  {
    name: "move",
    before: [filled],
    steps: drag(
      [280, 200],
      [
        [300, 210],
        [340, 250],
        [360, 270],
      ],
    ),
  },
  {
    name: "resize",
    before: [filled],
    steps: [
      ...tap([280, 200]),
      ...drag(
        [370, 260],
        [
          [400, 280],
          [430, 320],
        ],
      ),
    ],
  },
  {
    name: "rotate",
    before: [filled],
    steps: [
      ...tap([280, 200]),
      ...drag(
        [280, 120],
        [
          [320, 130],
          [380, 170],
        ],
      ),
    ],
  },
  {
    name: "delete",
    before: [filled],
    steps: [...tap([280, 200]), { press: "Delete" }],
  },
  {
    name: "resize-labelled-box",
    before: [{ ...filled, label: { text: "Hello there friend" } }],
    steps: [
      ...tap([230, 170]),
      ...drag(
        [370, 260],
        [
          [340, 250],
          [300, 240],
        ],
      ),
    ],
  },
  {
    // The first step measures the box's narrowest against A-Z and 0-9; later
    // ones against the characters wrapping the label has measured by then.
    name: "narrow-a-labelled-box",
    before: [{ ...filled, label: { text: "i".repeat(40) } }],
    steps: [
      ...tap([230, 170]),
      ...drag(
        [370, 200],
        [
          [330, 200],
          [260, 200],
          [205, 200],
        ],
      ),
    ],
  },
  {
    name: "resize-text",
    before: [{ type: "text", x: 200, y: 150, text: "Scale me", seed: 3 }],
    steps: [
      ...tap([230, 160]),
      ...drag(
        [290, 180],
        [
          [320, 190],
          [350, 210],
        ],
      ),
    ],
  },
  {
    name: "select-by-box-and-move",
    before: [
      filled,
      { type: "ellipse", x: 400, y: 300, width: 80, height: 60, seed: 5 },
    ],
    steps: [
      ...drag(
        [150, 100],
        [
          [300, 250],
          [500, 380],
        ],
      ),
      ...drag(
        [280, 200],
        [
          [290, 230],
          [320, 260],
        ],
      ),
    ],
  },
  {
    name: "rewrap-text",
    before: [
      { type: "text", x: 200, y: 150, text: "Hello there\nfriend", seed: 3 },
    ],
    steps: [
      ...tap([230, 160]),
      ...drag(
        [306, 175],
        [
          [280, 175],
          [250, 175],
        ],
      ),
    ],
  },
  {
    name: "label-a-box",
    before: [filled],
    steps: [
      { tool: "text" },
      ...tap([280, 200]),
      { type: "A label that wraps inside the box" },
      { press: "Escape" },
    ],
  },
  {
    name: "double-tap-to-label",
    before: [filled],
    steps: [
      ...tap([280, 200]),
      ...tap([280, 200]),
      { doubleTap: [280, 200] },
      { type: "Hi" },
      { press: "Escape" },
    ],
  },
  {
    name: "double-tap-to-edit-text",
    before: [{ type: "text", x: 200, y: 150, text: "Scale me", seed: 3 }],
    steps: [
      ...tap([230, 160]),
      ...tap([230, 160]),
      { doubleTap: [230, 160] },
      { type: " more" },
      { press: "Escape" },
    ],
  },
  {
    name: "label-grows-box",
    before: [{ ...filled, width: 80, height: 40 }],
    steps: [
      { tool: "text" },
      ...tap([240, 170]),
      { type: "Grow this box please" },
      { press: "Escape" },
    ],
  },
  {
    name: "delete-labelled-box",
    before: [{ ...filled, label: { text: "Hello there friend" } }],
    steps: [...tap([230, 170]), { press: "Delete" }],
  },
  {
    name: "move-a-line",
    before: [
      {
        type: "line",
        x: 100,
        y: 100,
        points: [
          [0, 0],
          [120, 40],
          [240, 0],
        ],
        seed: 9,
      },
    ],
    steps: drag(
      [220, 140],
      [
        [240, 160],
        [260, 200],
      ],
    ),
  },
  {
    name: "undo-text",
    steps: [
      { tool: "text" },
      ...tap([150, 200]),
      { type: "Gone" },
      { press: "Escape" },
      { press: "undo" },
    ],
  },
  {
    name: "undo-and-redo",
    steps: [
      { tool: "rectangle" },
      ...drag([100, 100], [[200, 180]]),
      { tool: "ellipse" },
      ...drag([300, 100], [[400, 180]]),
      { press: "undo" },
      { press: "undo" },
      { press: "redo" },
    ],
  },
];

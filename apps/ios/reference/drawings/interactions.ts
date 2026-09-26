/**
 * What a person does in the editor, as steps both the web editor and the iOS
 * editor can replay: the recorder plays each script in web Excalidraw and
 * keeps the elements it ends with, and `DrawingKitTests` plays it again on
 * iOS and expects the same elements.
 *
 * Points are in scene coordinates, which are the page's own: the editor sits
 * at the top left, unscrolled and unzoomed.
 */
import type { ImageFile, Skeleton } from "./scenes.js";

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
        | "arrow"
        | "freedraw"
        | "text";
    }
  | { down: Point; pointer?: Pointer; pressure?: number }
  | { move: Point; pressure?: number }
  | { up: Point }
  | { doubleTap: Point }
  | { type: string }
  | { press: "Escape" | "Delete" | "undo" | "redo" | "group" | "ungroup" }
  | { style: Style; value: string | number }
  | { drop: Point; file: string };

/** What the style panel changes, as the web's `currentItem…` names it. */
export type Style =
  | "strokeColor"
  | "backgroundColor"
  | "fillStyle"
  | "strokeWidth"
  | "strokeStyle"
  | "roughness";

/** An image a step drops: a drawn one, or an SVG file as written. */
export type DroppedFile = ImageFile | { svg: string };

export type Interaction = {
  name: string;
  before?: Skeleton[];
  /** Images the steps drop, recorded beside the fixture as scenes' are. */
  files?: Record<string, DroppedFile>;
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

const picture: Skeleton = {
  type: "image",
  id: "picture",
  x: 200,
  y: 150,
  width: 160,
  height: 100,
  fileId: "photo",
  status: "saved",
  seed: 7,
};

/** Two outlined shapes an arrow can join, and a filled one. */
const left: Skeleton = {
  type: "rectangle",
  id: "left",
  x: 100,
  y: 150,
  width: 120,
  height: 80,
  seed: 11,
};
const right: Skeleton = {
  type: "ellipse",
  id: "right",
  x: 400,
  y: 170,
  width: 120,
  height: 80,
  seed: 12,
};
const diamond: Skeleton = {
  type: "diamond",
  id: "diamond",
  x: 250,
  y: 330,
  width: 120,
  height: 100,
  seed: 13,
};

/** A frame, empty unless given children, and shapes to put in and around it. */
const frame = (children: string[] = []): Skeleton => ({
  type: "frame",
  id: "frame",
  x: 300,
  y: 100,
  width: 400,
  height: 300,
  children,
});
const framed: Skeleton = {
  type: "rectangle",
  id: "framed",
  x: 340,
  y: 140,
  width: 100,
  height: 80,
  seed: 21,
};
const loose: Skeleton = {
  type: "rectangle",
  id: "loose",
  x: 80,
  y: 150,
  width: 120,
  height: 80,
  seed: 22,
};
const cornered: Skeleton = {
  type: "ellipse",
  id: "cornered",
  x: 580,
  y: 300,
  width: 90,
  height: 70,
  seed: 23,
};

/** An arrow from near the rectangle's right side to inside the ellipse's left. */
const joinLeftToRight: Step[] = [
  { tool: "arrow" },
  ...drag(
    [215, 190],
    [
      [260, 195],
      [350, 205],
      [405, 210],
    ],
  ),
];

/** Selects the group `at` is in, then its shape alone by a double tap. */
const enterGroupAt = (at: Point): Step[] => [
  ...tap(at),
  ...tap(at),
  { doubleTap: at },
];

/** Presses the right ellipse's outline and drags it down and along. */
const dragRightEllipse: Step[] = drag(
  [401, 210],
  [
    [415, 225],
    [431, 240],
  ],
);

/** Selects every shape the scripts start from, with a box around them. */
const selectAll: Step[] = drag(
  [60, 60],
  [
    [300, 300],
    [620, 460],
  ],
);

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
  {
    name: "draw-arrow",
    steps: [
      { tool: "arrow" },
      ...drag(
        [100, 100],
        [
          [180, 140],
          [320, 210],
        ],
      ),
    ],
  },
  { name: "bind-arrow", before: [left, right], steps: joinLeftToRight },
  {
    name: "bind-arrow-from-a-filled-box-to-a-diamond",
    before: [filled, diamond],
    steps: [
      { tool: "arrow" },
      ...drag(
        [280, 200],
        [
          [300, 280],
          [310, 336],
        ],
      ),
    ],
  },
  {
    name: "arrow-follows-a-moved-shape",
    before: [left, right],
    steps: [
      ...joinLeftToRight,
      ...drag(
        [519, 210],
        [
          [530, 240],
          [560, 300],
        ],
      ),
    ],
  },
  {
    name: "arrow-follows-a-resized-shape",
    before: [left, right],
    steps: [
      ...joinLeftToRight,
      ...tap([100, 190]),
      ...drag(
        [230, 240],
        [
          [245, 260],
          [260, 290],
        ],
      ),
    ],
  },
  {
    name: "arrow-follows-a-rotated-shape",
    before: [left, right],
    steps: [
      ...joinLeftToRight,
      ...tap([100, 190]),
      ...drag(
        [160, 120],
        [
          [200, 130],
          [260, 170],
        ],
      ),
    ],
  },
  {
    name: "arrow-dragged-away-lets-go",
    before: [left, right],
    steps: [
      ...joinLeftToRight,
      ...drag(
        [250, 194],
        [
          [250, 254],
          [250, 324],
        ],
      ),
    ],
  },
  {
    name: "arrow-nudged-stays-bound",
    before: [left, right],
    steps: [
      ...joinLeftToRight,
      ...drag(
        [250, 194],
        [
          [250, 198],
          [250, 202],
        ],
      ),
    ],
  },
  {
    name: "delete-a-bound-shape",
    before: [left, right],
    steps: [...joinLeftToRight, ...tap([519, 210]), { press: "Delete" }],
  },
  {
    name: "group-and-move",
    before: [left, right, diamond],
    steps: [
      ...drag(
        [60, 60],
        [
          [300, 200],
          [560, 290],
        ],
      ),
      { press: "group" },
      ...tap([700, 600]),
      ...tap([100, 190]),
      ...drag(
        [100, 190],
        [
          [120, 220],
          [140, 260],
        ],
      ),
    ],
  },
  {
    name: "ungroup",
    before: [left, right, diamond],
    steps: [
      ...drag(
        [60, 60],
        [
          [300, 200],
          [560, 290],
        ],
      ),
      { press: "group" },
      ...tap([700, 600]),
      ...tap([100, 190]),
      { press: "ungroup" },
    ],
  },
  {
    // Whether undo takes the editor back into the group it left shows in
    // what a press on another of the group's shapes then drags.
    name: "undo-leaving-a-group",
    before: [left, right, diamond],
    steps: [
      ...selectAll,
      { press: "group" },
      ...tap([700, 600]),
      ...enterGroupAt([100, 190]),
      ...tap([700, 600]),
      { press: "undo" },
      ...dragRightEllipse,
    ],
  },
  {
    // A tap on one of a group's shapes picks the group, or the shape while
    // editing it, so what the drag moves shows whether undo left the group.
    name: "undo-entering-a-group",
    before: [left, right, diamond],
    steps: [
      ...selectAll,
      { press: "group" },
      ...tap([700, 600]),
      ...enterGroupAt([100, 190]),
      { press: "undo" },
      ...tap([401, 210]),
      ...dragRightEllipse,
    ],
  },
  {
    name: "resize-a-selection",
    before: [left, right, diamond],
    steps: [
      ...selectAll,
      ...drag(
        [533, 443],
        [
          [560, 470],
          [600, 520],
        ],
      ),
    ],
  },
  {
    name: "resize-a-selection-from-a-side",
    before: [left, right, diamond],
    steps: [
      ...selectAll,
      ...drag(
        [533, 290],
        [
          [500, 290],
          [440, 290],
        ],
      ),
    ],
  },
  {
    name: "rotate-a-selection",
    before: [left, right, diamond],
    steps: [
      ...selectAll,
      ...drag(
        [310, 128],
        [
          [360, 130],
          [420, 170],
        ],
      ),
    ],
  },
  {
    name: "resize-a-selection-with-an-arrow",
    before: [left, right],
    steps: [
      ...joinLeftToRight,
      ...drag(
        [60, 60],
        [
          [300, 200],
          [560, 290],
        ],
      ),
      ...drag(
        [533, 263],
        [
          [560, 290],
          [600, 330],
        ],
      ),
    ],
  },
  {
    name: "restyle-a-shape",
    before: [{ ...filled, label: { text: "Styled" } }],
    steps: [
      ...tap([280, 200]),
      { style: "strokeColor", value: "#e03131" },
      { style: "backgroundColor", value: "#ffec99" },
      { style: "fillStyle", value: "cross-hatch" },
      { style: "strokeWidth", value: 4 },
      { style: "strokeStyle", value: "dashed" },
      { style: "roughness", value: 0 },
    ],
  },
  {
    name: "style-then-draw",
    steps: [
      { tool: "ellipse" },
      { style: "strokeColor", value: "#1971c2" },
      { style: "backgroundColor", value: "#b2f2bb" },
      { style: "fillStyle", value: "hachure" },
      { style: "strokeWidth", value: 1 },
      { style: "strokeStyle", value: "dotted" },
      { style: "roughness", value: 2 },
      ...drag(
        [100, 120],
        [
          [200, 180],
          [300, 240],
        ],
      ),
    ],
  },
  {
    // Taller than the editor allows a placed image to be, so it is shrunk.
    name: "place-an-image",
    files: {
      photo: {
        width: 960,
        height: 640,
        colors: ["#e03131", "#2f9e44", "#1971c2", "#f08c00"],
      },
    },
    steps: [{ drop: [400, 300], file: "photo" }],
  },
  {
    // Sized by its viewBox, which the editor writes in as its size.
    name: "place-an-svg",
    files: {
      logo: {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect x="10" y="10" width="100" height="60" fill="#1971c2"/></svg>',
      },
    },
    steps: [{ drop: [400, 300], file: "logo" }],
  },
  {
    name: "resize-an-image-from-a-corner",
    before: [picture],
    steps: [
      ...tap([280, 200]),
      ...drag(
        [190, 140],
        [
          [170, 150],
          [140, 160],
        ],
      ),
    ],
  },
  {
    name: "resize-an-image-from-a-side",
    before: [picture],
    steps: [
      ...tap([280, 200]),
      ...drag(
        [370, 200],
        [
          [340, 210],
          [300, 220],
        ],
      ),
    ],
  },
  {
    // Each new element is in the frame its first point is in.
    name: "draw-in-a-frame",
    before: [frame()],
    steps: [
      { tool: "rectangle" },
      ...drag(
        [340, 140],
        [
          [400, 180],
          [440, 220],
        ],
      ),
      { tool: "ellipse" },
      ...drag(
        [620, 330],
        [
          [700, 400],
          [760, 450],
        ],
      ),
      { tool: "rectangle" },
      ...drag(
        [80, 440],
        [
          [130, 480],
          [180, 520],
        ],
      ),
      { tool: "line" },
      ...drag(
        [350, 300],
        [
          [400, 330],
          [450, 360],
        ],
      ),
      { tool: "arrow" },
      ...drag(
        [120, 300],
        [
          [250, 290],
          [420, 270],
        ],
      ),
      { tool: "freedraw" },
      ...drag(
        [500, 250],
        [
          [530, 270],
          [560, 260],
          [590, 290],
        ],
      ),
      { tool: "text" },
      ...tap([360, 360]),
      { type: "Framed" },
      { press: "Escape" },
    ],
  },
  {
    name: "drag-into-a-frame",
    before: [frame(), loose],
    steps: drag(
      [80, 190],
      [
        [240, 220],
        [380, 250],
      ],
    ),
  },
  {
    name: "drag-out-of-a-frame",
    before: [framed, frame(["framed"])],
    steps: drag(
      [340, 180],
      [
        [250, 300],
        [100, 480],
      ],
    ),
  },
  {
    // Let go outside the frame, the shape leaves it though it still overlaps.
    name: "drag-partly-out-of-a-frame",
    before: [cornered, frame(["cornered"])],
    steps: drag(
      [670, 335],
      [
        [690, 335],
        [710, 335],
      ],
    ),
  },
  {
    name: "move-a-frame",
    before: [framed, cornered, frame(["framed", "cornered"]), loose],
    steps: drag(
      [300, 250],
      [
        [280, 280],
        [250, 320],
      ],
    ),
  },
  {
    name: "resize-a-frame",
    before: [framed, cornered, frame(["framed", "cornered"])],
    steps: [
      ...tap([300, 250]),
      ...drag(
        [710, 410],
        [
          [650, 350],
          [560, 290],
        ],
      ),
    ],
  },
  {
    // A group takes its shapes out of the frames they were in.
    name: "group-across-a-frame",
    before: [framed, frame(["framed"]), loose],
    steps: [
      ...drag(
        [60, 120],
        [
          [300, 200],
          [460, 240],
        ],
      ),
      { press: "group" },
    ],
  },
  {
    // A shape the frame only held as part of its group is let go with it.
    name: "ungroup-in-a-frame",
    before: [
      { ...framed, groupIds: ["pair"] },
      { ...cornered, x: 760, groupIds: ["pair"] },
      frame(["framed", "cornered"]),
    ],
    steps: [...tap([340, 180]), { press: "ungroup" }],
  },
  {
    // Dragged into a frame, a shape leaves the group being edited, and a
    // group left with one shape is no group.
    name: "drag-out-of-a-group-into-a-frame",
    before: [
      frame(),
      { ...loose, groupIds: ["pair"] },
      { ...loose, id: "partner", y: 300, groupIds: ["pair"] },
    ],
    steps: [
      ...enterGroupAt([105, 150]),
      ...drag(
        [105, 150],
        [
          [240, 180],
          [405, 210],
        ],
      ),
    ],
  },
];

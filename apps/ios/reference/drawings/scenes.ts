/**
 * The drawings the iOS renderer is checked against, as the skeletons
 * `convertToExcalidrawElements` takes. The recorder turns each into canonical
 * elements in the browser, so text is measured with the real fonts and labels
 * and bindings come out as the editor makes them.
 *
 * Every element names its seed: the seed is what rough.js draws the wobble
 * from, and a random one would make every recording a different drawing.
 */

export type Skeleton = Record<string, unknown> & { type: string };

/**
 * An image a scene shows, drawn by the recorder as four flat quadrants in
 * these colours (top left, top right, bottom left, bottom right) and saved
 * as a PNG beside the fixture, so both renderers are given the same pixels.
 */
export type ImageFile = {
  width: number;
  height: number;
  colors: [string, string, string, string];
};

export type Scene = {
  name: string;
  elements: Skeleton[];
  files?: Record<string, ImageFile>;
};

let nextSeed = 1;
function seeded<T extends Skeleton>(element: T): T {
  return { seed: nextSeed++ * 7919, ...element };
}

function row(
  items: Record<string, unknown>[],
  base: Skeleton,
  step: number,
): Skeleton[] {
  return items.map((item, index) =>
    seeded({ ...base, x: 20 + index * step, ...item }),
  );
}

const box = { type: "rectangle", y: 20, width: 120, height: 80 };

/** A wave, so a stroke has both curvature and straight runs. */
function wave(count: number, width: number, amplitude: number): number[][] {
  return Array.from({ length: count }, (_, index) => {
    const t = index / (count - 1);
    return [t * width, Math.sin(t * Math.PI * 3) * amplitude];
  });
}

function freedraw(
  id: string,
  x: number,
  y: number,
  points: number[][],
  extra: Record<string, unknown> = {},
): Skeleton {
  const last = points[points.length - 1] ?? [0, 0];
  const xs = points.map((point) => point[0] ?? 0);
  const ys = points.map((point) => point[1] ?? 0);
  return seeded({
    type: "freedraw",
    id,
    x,
    y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    points,
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: last,
    ...extra,
  });
}

export const SCENES: Scene[] = [
  {
    name: "rectangles",
    elements: [
      ...row(
        [
          { roughness: 0, strokeWidth: 1 },
          { roughness: 1, strokeWidth: 2 },
          { roughness: 2, strokeWidth: 4 },
          { roughness: 1, roundness: { type: 3 } },
          { roughness: 2, roundness: { type: 2 }, strokeWidth: 1 },
        ],
        box,
        150,
      ),
      seeded({
        type: "rectangle",
        x: 20,
        y: 130,
        width: 360,
        height: 160,
        roundness: { type: 3 },
        strokeColor: "#1971c2",
      }),
      seeded({
        type: "rectangle",
        x: 420,
        y: 130,
        width: 12,
        height: 160,
        strokeColor: "#e03131",
      }),
    ],
  },
  {
    name: "diamonds-and-ellipses",
    elements: [
      ...row(
        [
          { roughness: 0 },
          { roughness: 1, strokeWidth: 1 },
          { roughness: 2, strokeWidth: 4 },
          { roughness: 1, roundness: { type: 2 } },
          { roughness: 0, roundness: { type: 2 }, width: 200 },
        ],
        { type: "diamond", y: 20, width: 120, height: 90 },
        150,
      ),
      ...row(
        [
          { roughness: 0 },
          { roughness: 1, strokeWidth: 1 },
          { roughness: 2, strokeWidth: 4 },
          { roughness: 1, width: 90, height: 90 },
          { roughness: 1, width: 300, height: 40 },
        ],
        { type: "ellipse", y: 140, width: 120, height: 80 },
        150,
      ),
    ],
  },
  {
    name: "fills",
    elements: [
      ...row(
        [
          { fillStyle: "hachure" },
          { fillStyle: "cross-hatch" },
          { fillStyle: "solid" },
          { fillStyle: "zigzag" },
          { fillStyle: "hachure", strokeWidth: 4, roughness: 0 },
        ],
        { ...box, backgroundColor: "#ffc9c9" },
        150,
      ),
      ...row(
        [
          { fillStyle: "hachure" },
          { fillStyle: "cross-hatch", roughness: 2 },
          { fillStyle: "solid", roughness: 0 },
          { fillStyle: "zigzag", strokeWidth: 1 },
          { fillStyle: "solid", roundness: { type: 2 } },
        ],
        {
          type: "ellipse",
          y: 130,
          width: 120,
          height: 80,
          backgroundColor: "#a5d8ff",
        },
        150,
      ),
      ...row(
        [
          { fillStyle: "hachure" },
          { fillStyle: "cross-hatch" },
          { fillStyle: "solid", roundness: { type: 2 } },
          { fillStyle: "zigzag", roughness: 0 },
          { fillStyle: "hachure", roundness: { type: 3 }, type: "rectangle" },
        ],
        {
          type: "diamond",
          y: 240,
          width: 120,
          height: 90,
          backgroundColor: "#b2f2bb",
          strokeColor: "#2f9e44",
        },
        150,
      ),
    ],
  },
  {
    name: "stroke-styles",
    elements: [
      ...row(
        [
          { strokeStyle: "dashed" },
          { strokeStyle: "dotted" },
          { strokeStyle: "dashed", strokeWidth: 4, roundness: { type: 3 } },
          { strokeStyle: "dotted", strokeWidth: 1, roughness: 0 },
        ],
        box,
        150,
      ),
      ...row(
        [
          { strokeStyle: "dashed" },
          { strokeStyle: "dotted", strokeWidth: 4 },
          {
            strokeStyle: "dashed",
            type: "diamond",
            backgroundColor: "#ffec99",
          },
          {
            strokeStyle: "dotted",
            type: "diamond",
            roundness: { type: 2 },
          },
        ],
        { type: "ellipse", y: 130, width: 120, height: 80 },
        150,
      ),
      ...row(
        [
          { strokeStyle: "dashed" },
          { strokeStyle: "dotted", roundness: { type: 2 } },
          { strokeStyle: "dashed", strokeWidth: 4, endArrowhead: "triangle" },
        ],
        {
          type: "arrow",
          y: 260,
          points: [
            [0, 0],
            [60, 40],
            [130, 0],
          ],
          endArrowhead: "arrow",
        },
        180,
      ),
    ],
  },
  {
    name: "opacity-and-rotation",
    elements: [
      ...row(
        [
          { opacity: 30, backgroundColor: "#e03131", fillStyle: "solid" },
          { opacity: 60, angle: 0.4, backgroundColor: "#1971c2" },
          { angle: 2.2, type: "ellipse", backgroundColor: "#ffec99" },
          { angle: -0.7, type: "diamond", roundness: { type: 2 } },
        ],
        { ...box, y: 40, backgroundColor: "transparent" },
        170,
      ),
      seeded({
        type: "line",
        x: 40,
        y: 200,
        angle: 0.3,
        opacity: 50,
        strokeWidth: 4,
        points: [
          [0, 0],
          [120, 40],
          [240, 0],
        ],
      }),
      seeded({
        type: "text",
        x: 360,
        y: 200,
        angle: -0.35,
        text: "Tilted text",
        fontSize: 28,
        opacity: 70,
      }),
    ],
  },
  {
    name: "lines",
    elements: [
      seeded({
        type: "line",
        x: 20,
        y: 40,
        points: [
          [0, 0],
          [80, 60],
          [160, 0],
          [240, 60],
        ],
      }),
      seeded({
        type: "line",
        x: 300,
        y: 40,
        roundness: { type: 2 },
        points: [
          [0, 0],
          [80, 60],
          [160, 0],
          [240, 60],
        ],
      }),
      seeded({
        type: "line",
        x: 20,
        y: 150,
        backgroundColor: "#d0bfff",
        fillStyle: "hachure",
        points: [
          [0, 0],
          [140, 20],
          [100, 120],
          [10, 90],
          [0, 0],
        ],
      }),
      seeded({
        type: "line",
        x: 220,
        y: 150,
        backgroundColor: "#99e9f2",
        fillStyle: "solid",
        roundness: { type: 2 },
        points: [
          [0, 0],
          [140, 20],
          [100, 120],
          [10, 90],
          [0, 0],
        ],
      }),
      seeded({
        type: "line",
        x: 420,
        y: 150,
        roughness: 0,
        strokeWidth: 1,
        points: [
          [0, 0],
          [120, 120],
        ],
      }),
    ],
  },
  {
    name: "arrowheads",
    elements: [
      ...[
        "arrow",
        "bar",
        "dot",
        "circle",
        "circle_outline",
        "triangle",
        "triangle_outline",
        "diamond",
        "diamond_outline",
        "crowfoot_one",
        "crowfoot_many",
        "crowfoot_one_or_many",
      ].map((head, index) =>
        seeded({
          type: "arrow",
          x: 40 + (index % 3) * 200,
          y: 30 + Math.floor(index / 3) * 70,
          points: [
            [0, 0],
            [150, 20],
          ],
          startArrowhead: index % 2 ? head : null,
          endArrowhead: head,
          strokeWidth: index % 4 === 3 ? 4 : 2,
        }),
      ),
      seeded({
        type: "arrow",
        x: 40,
        y: 330,
        roundness: { type: 2 },
        points: [
          [0, 0],
          [120, -40],
          [260, 30],
          [420, 0],
        ],
        endArrowhead: "triangle",
        startArrowhead: "dot",
      }),
      seeded({
        type: "arrow",
        x: 40,
        y: 400,
        roughness: 0,
        points: [
          [0, 0],
          [0, 60],
          [200, 60],
          [200, 20],
        ],
        endArrowhead: "arrow",
        elbowed: true,
        roundness: null,
      }),
      seeded({
        type: "arrow",
        x: 320,
        y: 400,
        points: [
          [0, 0],
          [4, 3],
        ],
        endArrowhead: "arrow",
      }),
    ],
  },
  {
    name: "text",
    elements: [
      ...[1, 2, 3, 5, 6, 7, 8, 9].map((fontFamily, index) =>
        seeded({
          type: "text",
          x: 20,
          y: 20 + index * 44,
          fontFamily,
          fontSize: 24,
          text: `Family ${fontFamily}: The quick brown fox, 0123 éå!`,
        }),
      ),
      ...(["left", "center", "right"] as const).map((textAlign, index) =>
        seeded({
          type: "text",
          x: 620,
          y: 20 + index * 110,
          fontFamily: 5,
          fontSize: 20,
          textAlign,
          strokeColor: ["#e03131", "#2f9e44", "#1971c2"][index],
          text: "First line\nsecond, longer line\nthird",
        }),
      ),
      seeded({
        type: "text",
        x: 620,
        y: 360,
        fontFamily: 6,
        fontSize: 36,
        text: "Big 36",
      }),
    ],
  },
  {
    name: "bound-text",
    elements: [
      seeded({
        type: "rectangle",
        x: 20,
        y: 20,
        width: 200,
        height: 100,
        backgroundColor: "#a5d8ff",
        fillStyle: "solid",
        roundness: { type: 3 },
        label: { text: "Centered label" },
      }),
      seeded({
        type: "ellipse",
        x: 260,
        y: 20,
        width: 200,
        height: 120,
        label: {
          text: "An ellipse label that wraps onto lines",
          strokeColor: "#e03131",
        },
      }),
      seeded({
        type: "diamond",
        x: 500,
        y: 10,
        width: 200,
        height: 140,
        label: { text: "Diamond", fontFamily: 8, fontSize: 28 },
      }),
      seeded({
        type: "rectangle",
        x: 20,
        y: 180,
        width: 200,
        height: 140,
        label: {
          text: "Top left",
          textAlign: "left",
          verticalAlign: "top",
          fontFamily: 2,
        },
      }),
      seeded({
        type: "rectangle",
        x: 260,
        y: 180,
        width: 200,
        height: 140,
        angle: 0.3,
        label: {
          text: "Bottom right, rotated",
          textAlign: "right",
          verticalAlign: "bottom",
        },
      }),
    ],
  },
  {
    name: "arrow-labels",
    elements: [
      seeded({
        type: "arrow",
        x: 20,
        y: 60,
        points: [
          [0, 0],
          [300, 0],
        ],
        label: { text: "straight" },
      }),
      seeded({
        type: "arrow",
        x: 20,
        y: 160,
        roundness: { type: 2 },
        points: [
          [0, 0],
          [150, -60],
          [300, 20],
        ],
        label: { text: "curved middle point" },
      }),
      seeded({
        type: "arrow",
        x: 380,
        y: 60,
        roundness: { type: 2 },
        points: [
          [0, 0],
          [80, 120],
          [200, 60],
          [260, 180],
        ],
        label: { text: "even", fontSize: 16 },
      }),
      seeded({
        type: "arrow",
        x: 60,
        y: 260,
        angle: 0.5,
        points: [
          [0, 0],
          [240, 0],
        ],
        strokeColor: "#9c36b5",
        label: { text: "rotated" },
      }),
      seeded({
        type: "arrow",
        x: 380,
        y: 300,
        points: [
          [0, 0],
          [120, 20],
          [240, -10],
        ],
        label: { text: "short" },
        endArrowhead: null,
      }),
    ],
  },
  {
    name: "freedraw",
    elements: [
      freedraw("simulated", 20, 60, wave(40, 260, 30)),
      freedraw("pressure", 320, 60, wave(40, 260, 30), {
        simulatePressure: false,
        pressures: wave(40, 1, 1).map(
          ([t = 0]) => 0.2 + 0.6 * Math.sin(t * Math.PI),
        ),
        strokeWidth: 4,
        strokeColor: "#1971c2",
      }),
      freedraw(
        "loop",
        40,
        160,
        Array.from({ length: 36 }, (_, index) => {
          const angle = (index / 35) * Math.PI * 2;
          return [
            80 + Math.cos(angle) * 80 - 80,
            60 + Math.sin(angle) * 60 - 60 + index * 0.1,
          ];
        }),
        { backgroundColor: "#ffc9c9", fillStyle: "hachure" },
      ),
      freedraw("dot", 300, 200, [[0, 0]], { strokeWidth: 4 }),
      freedraw("open", 360, 180, wave(12, 200, 50), {
        lastCommittedPoint: null,
        strokeWidth: 1,
        angle: 0.6,
      }),
    ],
  },
  {
    name: "frame",
    elements: [
      seeded({
        type: "rectangle",
        id: "inside",
        x: 60,
        y: 80,
        width: 140,
        height: 90,
        backgroundColor: "#b2f2bb",
        fillStyle: "solid",
      }),
      seeded({
        type: "ellipse",
        id: "overhang",
        x: 260,
        y: 150,
        width: 200,
        height: 120,
        backgroundColor: "#ffec99",
        fillStyle: "cross-hatch",
      }),
      seeded({
        type: "text",
        id: "caption",
        x: 70,
        y: 200,
        text: "In the frame",
      }),
      seeded({
        type: "frame",
        id: "frame",
        x: 40,
        y: 40,
        width: 340,
        height: 240,
        name: "A frame with a name far too long to fit above it",
        children: ["inside", "overhang", "caption"],
      }),
      seeded({
        type: "rectangle",
        x: 440,
        y: 20,
        width: 80,
        height: 60,
      }),
    ],
  },
  {
    name: "flowchart",
    elements: [
      seeded({
        type: "rectangle",
        id: "start",
        x: 40,
        y: 40,
        width: 180,
        height: 70,
        roundness: { type: 3 },
        backgroundColor: "#b2f2bb",
        fillStyle: "solid",
        label: { text: "Start" },
      }),
      seeded({
        type: "diamond",
        id: "decide",
        x: 30,
        y: 180,
        width: 200,
        height: 120,
        backgroundColor: "#ffec99",
        fillStyle: "hachure",
        label: { text: "Ready?" },
      }),
      seeded({
        type: "ellipse",
        id: "done",
        x: 340,
        y: 200,
        width: 160,
        height: 80,
        backgroundColor: "#a5d8ff",
        fillStyle: "cross-hatch",
        label: { text: "Done", fontFamily: 6 },
      }),
      seeded({
        type: "arrow",
        x: 130,
        y: 110,
        points: [
          [0, 0],
          [0, 70],
        ],
        start: { id: "start" },
        end: { id: "decide" },
      }),
      seeded({
        type: "arrow",
        x: 230,
        y: 240,
        points: [
          [0, 0],
          [110, 0],
        ],
        start: { id: "decide" },
        end: { id: "done" },
        label: { text: "yes" },
      }),
      seeded({
        type: "text",
        x: 280,
        y: 60,
        text: "Plan the week",
        fontSize: 28,
        strokeColor: "#9c36b5",
      }),
      freedraw("underline", 280, 100, wave(24, 200, 6), {
        strokeColor: "#9c36b5",
      }),
    ],
  },
  {
    name: "images",
    files: {
      photo: {
        width: 64,
        height: 48,
        colors: ["#e03131", "#2f9e44", "#1971c2", "#f08c00"],
      },
    },
    elements: [
      seeded({
        type: "image",
        x: 20,
        y: 20,
        width: 160,
        height: 120,
        fileId: "photo",
        status: "saved",
      }),
      seeded({
        type: "image",
        x: 220,
        y: 30,
        width: 120,
        height: 90,
        angle: 0.3,
        roundness: { type: 3 },
        fileId: "photo",
        status: "saved",
      }),
      seeded({
        type: "image",
        x: 380,
        y: 20,
        width: 120,
        height: 90,
        scale: [-1, 1],
        crop: {
          x: 16,
          y: 12,
          width: 32,
          height: 24,
          naturalWidth: 64,
          naturalHeight: 48,
        },
        fileId: "photo",
        status: "saved",
      }),
      seeded({
        type: "image",
        x: 20,
        y: 180,
        width: 120,
        height: 90,
        fileId: "not-uploaded",
        status: "pending",
      }),
      seeded({
        type: "image",
        x: 180,
        y: 180,
        width: 120,
        height: 90,
        fileId: "not-uploaded",
        status: "error",
      }),
      seeded({
        type: "image",
        x: 340,
        y: 180,
        width: 120,
        height: 90,
        opacity: 50,
        fileId: "photo",
        status: "saved",
      }),
    ],
  },
];

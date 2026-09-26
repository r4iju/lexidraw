/// <reference lib="dom" />
/**
 * Runs in the browser the recorder drives. It turns a scene into canonical
 * elements with the editor's own converter, exports it with `exportToCanvas`
 * and hands back what the export drew: every canvas call that leaves a mark,
 * with the state it drew with, and the PNG it came to.
 *
 * Path points are recorded in device pixels as they are added, because that
 * is when a canvas applies the transform to them; two renderers that reach
 * the same pixels through different transform steps then record the same
 * path. A canvas drawn into another canvas is recorded as a layer holding
 * its own calls, since that is how the arrow label cut-out is drawn.
 */
import {
  convertToExcalidrawElements,
  exportToCanvas,
  restoreElements,
} from "@excalidraw/excalidraw";

type Event = Record<string, unknown>;

const logs = new WeakMap<CanvasRenderingContext2D, Event[]>();
const fonts = new WeakMap<CanvasRenderingContext2D, string>();
const path2DSources = new WeakMap<Path2D, string>();

function log(context: CanvasRenderingContext2D): Event[] {
  let events = logs.get(context);
  if (!events) {
    events = [];
    logs.set(context, events);
  }
  return events;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

function point(context: CanvasRenderingContext2D, x: number, y: number) {
  const { a, b, c, d, e, f } = context.getTransform();
  return [round(a * x + c * y + e), round(b * x + d * y + f)];
}

function matrix(context: CanvasRenderingContext2D): number[] {
  const { a, b, c, d, e, f } = context.getTransform();
  return [a, b, c, d, e, f].map(round);
}

function paint(context: CanvasRenderingContext2D): Event {
  return {
    alpha: round(context.globalAlpha),
    filter: context.filter,
  };
}

const proto = CanvasRenderingContext2D.prototype;

const fontSetter = Object.getOwnPropertyDescriptor(proto, "font")?.set;
Object.defineProperty(proto, "font", {
  ...Object.getOwnPropertyDescriptor(proto, "font"),
  set(this: CanvasRenderingContext2D, value: string) {
    fonts.set(this, value);
    fontSetter?.call(this, value);
  },
});

function wrap<K extends keyof CanvasRenderingContext2D>(
  name: K,
  record: (
    context: CanvasRenderingContext2D,
    ...args: never[]
  ) => Event | undefined,
) {
  const original = proto[name] as (...args: unknown[]) => unknown;
  Object.defineProperty(proto, name, {
    value(this: CanvasRenderingContext2D, ...args: unknown[]) {
      const event = record(this, ...(args as never[]));
      if (event) log(this).push(event);
      return original.apply(this, args);
    },
  });
}

wrap("beginPath", () => ({ op: "beginPath" }));
wrap("closePath", () => ({ op: "closePath" }));
wrap("moveTo", (context, x: number, y: number) => ({
  op: "moveTo",
  p: point(context, x, y),
}));
wrap("lineTo", (context, x: number, y: number) => ({
  op: "lineTo",
  p: point(context, x, y),
}));
wrap(
  "bezierCurveTo",
  (
    context,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x: number,
    y: number,
  ) => ({
    op: "bezierCurveTo",
    p: [
      ...point(context, x1, y1),
      ...point(context, x2, y2),
      ...point(context, x, y),
    ],
  }),
);
wrap(
  "quadraticCurveTo",
  (context, x1: number, y1: number, x: number, y: number) => ({
    op: "quadraticCurveTo",
    p: [...point(context, x1, y1), ...point(context, x, y)],
  }),
);
wrap(
  "roundRect",
  (context, x: number, y: number, w: number, h: number, r: number) => ({
    op: "roundRect",
    rect: [x, y, w, h, r].map(round),
    m: matrix(context),
  }),
);
wrap("rect", (context, x: number, y: number, w: number, h: number) => ({
  op: "rect",
  rect: [x, y, w, h].map(round),
  m: matrix(context),
}));
wrap("stroke", (context) => ({
  op: "stroke",
  style: String(context.strokeStyle),
  width: round(context.lineWidth),
  m: matrix(context).slice(0, 4),
  dash: context.getLineDash().map(round),
  dashOffset: round(context.lineDashOffset),
  cap: context.lineCap,
  join: context.lineJoin,
  ...paint(context),
}));
wrap("fill", (context, first?: Path2D | CanvasFillRule, second?: string) => {
  const style = String(context.fillStyle);
  if (first instanceof Path2D) {
    return {
      op: "fillPath2D",
      d: path2DSources.get(first) ?? "",
      rule: second ?? "nonzero",
      m: matrix(context),
      style,
      ...paint(context),
    };
  }
  return { op: "fill", rule: first ?? "nonzero", style, ...paint(context) };
});
wrap("clip", (_context, rule?: CanvasFillRule) => ({
  op: "clip",
  rule: rule ?? "nonzero",
}));

function quad(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  return [
    ...point(context, x, y),
    ...point(context, x + w, y),
    ...point(context, x + w, y + h),
    ...point(context, x, y + h),
  ];
}

wrap("fillRect", (context, x: number, y: number, w: number, h: number) => ({
  op: "fillRect",
  quad: quad(context, x, y, w, h),
  style: String(context.fillStyle),
  ...paint(context),
}));
wrap("clearRect", (context, x: number, y: number, w: number, h: number) => ({
  op: "clearRect",
  quad: quad(context, x, y, w, h),
}));
wrap("fillText", (context, text: string, x: number, y: number) => ({
  op: "fillText",
  text,
  p: point(context, x, y),
  m: matrix(context).slice(0, 4),
  font: fonts.get(context) ?? context.font,
  align: context.textAlign,
  baseline: context.textBaseline,
  style: String(context.fillStyle),
  ...paint(context),
}));
wrap("drawImage", (context, image: CanvasImageSource, ...rest: number[]) => {
  const [x = 0, y = 0, w, h] = rest.length === 8 ? rest.slice(4) : rest;
  if (image instanceof HTMLCanvasElement) {
    const inner = image.getContext("2d");
    return {
      op: "drawLayer",
      size: [image.width, image.height],
      quad: quad(context, x, y, w ?? image.width, h ?? image.height),
      events: inner ? log(inner) : [],
      ...paint(context),
    };
  }
  return {
    op: "drawImage",
    quad: quad(context, x, y, w ?? 0, h ?? 0),
    ...paint(context),
  };
});

const NativePath2D = window.Path2D;
window.Path2D = class extends NativePath2D {
  constructor(source?: Path2D | string) {
    super(source);
    if (typeof source === "string") path2DSources.set(this, source);
  }
};

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string;
    convert: (skeleton: unknown[]) => Promise<unknown[]>;
    record: (
      elements: unknown[],
      theme: "light" | "dark",
    ) => Promise<{ events: Event[]; png: string }>;
  }
}

window.EXCALIDRAW_ASSET_PATH = `${window.location.origin}/`;

async function exportScene(elements: unknown[], theme: "light" | "dark") {
  return await exportToCanvas({
    elements: elements as Parameters<typeof exportToCanvas>[0]["elements"],
    appState: {
      exportWithDarkMode: theme === "dark",
      exportScale: 2,
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
    },
    files: null,
    exportPadding: 10,
    getDimensions: (width: number, height: number) => ({
      width: width * 2,
      height: height * 2,
      scale: 2,
    }),
  });
}

/**
 * Converts with the randomness fixed, so the ids and timestamps the converter
 * makes up come out the same on every recording and the fixtures change only
 * when the editor does. The nonces, and the seeds of the labels it adds, come
 * from a generator seeded when the editor loads, so they are set to one value
 * afterwards; text is not drawn from its seed.
 */
function repeatably(make: () => unknown[]): unknown[] {
  const { random } = Math;
  const { now } = Date;
  const fill = crypto.getRandomValues.bind(crypto);
  let state = 1;
  const next = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  Math.random = next;
  Date.now = () => 1;
  crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
    if (array) {
      const bytes = new Uint8Array(
        array.buffer,
        array.byteOffset,
        array.byteLength,
      );
      for (let i = 0; i < bytes.length; i++) bytes[i] = next() * 256;
    }
    return array;
  };
  try {
    return make().map((element) => {
      const fixed = { ...(element as { type: string }), versionNonce: 1 };
      return fixed.type === "text" ? { ...fixed, seed: 1 } : fixed;
    });
  } finally {
    Math.random = random;
    Date.now = now;
    crypto.getRandomValues = fill;
  }
}

window.convert = async (skeleton) => {
  const convert = () =>
    repeatably(() =>
      restoreElements(
        convertToExcalidrawElements(
          skeleton as Parameters<typeof convertToExcalidrawElements>[0],
          { regenerateIds: false },
        ),
        null,
      ),
    );
  // Text is measured when it is converted, and a face that has not loaded
  // yet measures as the fallback; the first export is what loads the faces.
  for (const theme of ["light", "dark"] as const) {
    await exportScene(convert(), theme);
  }
  await document.fonts.ready;
  return convert();
};

window.record = async (elements, theme) => {
  const canvas = await exportScene(elements, theme);
  const context = canvas.getContext("2d");
  return {
    events: context ? log(context) : [],
    png: canvas.toDataURL("image/png"),
  };
};

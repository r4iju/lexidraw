/// <reference types="bun" />
import { beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

import { EXCALIDRAW_FONT_FAMILIES } from "./fonts.generated";

const script = join(import.meta.dir, "..", "..", "test", "render-drawing.ts");

/** One labelled box, one unlabelled box, and a labelled arrow between them. */
const DRAWING = [
  {
    type: "rectangle",
    id: "ingest",
    x: 0,
    y: 0,
    width: 220,
    height: 100,
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    label: { text: "Ingest", fontSize: 20 },
  },
  {
    type: "rectangle",
    id: "index",
    x: 420,
    y: 0,
    width: 220,
    height: 100,
    backgroundColor: "#b2f2bb",
    fillStyle: "solid",
    label: { text: "Index", fontSize: 20 },
  },
  {
    type: "arrow",
    id: "flow",
    x: 230,
    y: 50,
    label: { text: "batches" },
    start: { id: "ingest" },
    end: { id: "index" },
  },
];

type Rendered = {
  format: string;
  contentType: string;
  width: number;
  height: number;
  before: string[];
  after: string[];
  file: string;
};

let directory: string;

function spawn(
  elements: unknown,
  file: string,
  format: string,
  scale?: number,
) {
  return Bun.spawnSync({
    cmd: [
      "bun",
      script,
      JSON.stringify(elements),
      file,
      format,
      ...(scale === undefined ? [] : [String(scale)]),
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
}

function renderElements(
  elements: unknown,
  format: string,
  { scale, name }: { scale?: number; name?: string } = {},
): Rendered {
  const file = join(
    directory,
    `${name ?? `${format}-${scale ?? 1}`}.${format}`,
  );
  const result = spawn(elements, file, format, scale);
  if (result.exitCode !== 0) {
    throw new Error(`rendering failed: ${result.stderr}`);
  }
  return { ...JSON.parse(result.stdout.toString()), file };
}

const render = (format: string, scale?: number): Rendered =>
  renderElements(DRAWING, format, { scale });

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lexidraw-render-"));
});

describe("svg", () => {
  let rendered: Rendered;
  let svg: string;

  beforeAll(async () => {
    rendered = render("svg");
    svg = await Bun.file(rendered.file).text();
  });

  it("is an SVG sized to the drawing", () => {
    expect(rendered.contentType).toBe("image/svg+xml");
    expect(svg).toStartWith("<svg");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    // The two boxes are 640 scene units apart, plus the export padding.
    expect(rendered.width).toBe(660);
    expect(rendered.height).toBe(120);
  });

  it("carries every label as text, not as paths", () => {
    for (const label of ["Ingest", "Index", "batches"]) {
      expect(svg).toMatch(new RegExp(`<text[^>]*>${label}</text>`));
    }
  });

  // Inlining them is what would make the export fetch; see render.ts.
  it("names the font families instead of embedding them", () => {
    expect(svg).toContain("font-family=");
    expect(svg).toContain("Excalifont");
    expect(svg).not.toContain("@font-face");
    expect(svg).not.toContain("data:font");
  });

  it("leaves the globals as it found them", () => {
    expect(rendered.after).toEqual(rendered.before);
    expect(rendered.after).not.toContain("window");
  });
});

describe("png", () => {
  let rendered: Rendered;
  let png: Uint8Array;

  beforeAll(async () => {
    rendered = render("png");
    png = await Bun.file(rendered.file).bytes();
  });

  it("is a PNG of the drawing's size", () => {
    expect(rendered.contentType).toBe("image/png");
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(rendered.width).toBe(660);
    expect(rendered.height).toBe(120);
    expect(png.length).toBeGreaterThan(2000);
  });

  it("draws the label inside its box", () => {
    const image = decode(png);
    // The box is at 0,0 220x100 plus the padding, and its label is centred in
    // it. Dark pixels well inside a solid light blue box are the text: any
    // font at all draws some, and a missing one draws none.
    expect(
      darkPixels(image, { x: 40, y: 40, width: 140, height: 40 }),
    ).toBeGreaterThan(20);
    // The same box away from the label has none of them, so the count above
    // is the text rather than the box.
    expect(darkPixels(image, { x: 40, y: 85, width: 140, height: 10 })).toBe(0);
  });

  it("scales the raster without moving the drawing", () => {
    const scaled = render("png", 2);
    expect(scaled.width).toBe(1320);
    expect(scaled.height).toBe(240);
  });

  it("refuses a render past the pixel limit", () => {
    const huge = [
      { type: "rectangle", id: "big", x: 0, y: 0, width: 4000, height: 4000 },
    ];
    const result = spawn(huge, join(directory, "big.png"), "png", 4);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("megapixel limit");
  });
});

/**
 * A deleted element stays in a stored drawing, because a read and a write back
 * has to lose nothing; see `normalize.ts`. The export takes live elements only
 * and does not check, so one left in draws nothing and still counts towards
 * the bounds.
 */
describe("deleted elements", () => {
  const box = (over: Record<string, unknown>) => ({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    version: 7,
    versionNonce: 1,
    seed: 2,
    ...over,
  });

  it("renders a drawing with nothing live as an empty canvas", () => {
    const rendered = renderElements(
      [box({ id: "gone", isDeleted: true })],
      "svg",
      { name: "deleted-only" },
    );
    // What the editor exports for an empty scene: the padding, twice.
    expect([rendered.width, rendered.height]).toEqual([20, 20]);
  });

  it("sizes the canvas to the live elements alone", () => {
    const rendered = renderElements(
      [
        box({ id: "here", isDeleted: false }),
        box({ id: "gone", x: 5000, y: 5000, isDeleted: true }),
      ],
      "svg",
      { name: "deleted-far" },
    );
    expect([rendered.width, rendered.height]).toEqual([120, 120]);
  });
});

/**
 * Half the families the editor ships call themselves something else in their
 * own name tables, so the SVG handed to the rasteriser has them renamed; see
 * `withBundledFamilies` in render.ts. Getting that wrong is invisible in every
 * other assertion here: the text still rasterises, in the fallback face.
 */
describe("font families", () => {
  /** `FONT_FAMILY` in the pinned editor, as the ids an element stores. */
  const IDS: Record<string, number> = {
    Virgil: 1,
    Helvetica: 2,
    Cascadia: 3,
    Excalifont: 5,
    Nunito: 6,
    "Lilita One": 7,
    "Comic Shanns": 8,
    "Liberation Sans": 9,
  };

  /**
   * Wide enough that a family's own advance widths separate it from the
   * fallback's by more than the pixel or so antialiasing moves an edge by.
   */
  const SAMPLE = "Hamburgefonstiv Hamburgefonstiv Hamburgefonstiv";

  /** The families whose bundled face answers to some other name. */
  const RENAMED = Object.entries(EXCALIDRAW_FONT_FAMILIES)
    .filter(([family, face]) => face !== family)
    .map(([family]) => family);

  async function inkWidth(family: string): Promise<number> {
    const id = IDS[family];
    const rendered = renderElements(
      [
        {
          type: "text",
          id: "t",
          x: 0,
          y: 0,
          text: SAMPLE,
          fontSize: 24,
          fontFamily: id,
        },
      ],
      "png",
      { name: `family-${id}` },
    );
    return inkColumns(decode(await Bun.file(rendered.file).bytes()));
  }

  it("renames only the families that need it", () => {
    expect(RENAMED.toSorted()).toEqual([
      "Cascadia",
      "Comic Shanns",
      "Helvetica",
      "Nunito",
    ]);
  });

  it("draws a renamed family in its own face, not the fallback", async () => {
    // A family the rasteriser cannot match falls back to Excalifont, which
    // lays the same string out to the same width, to the pixel.
    const fallback = await inkWidth("Excalifont");
    for (const family of RENAMED) {
      const width = await inkWidth(family);
      expect([family, Math.abs(width - fallback) > 1]).toEqual([family, true]);
    }
  });

  it("leaves the SVG naming the drawing's own families", async () => {
    const rendered = renderElements(
      [
        {
          type: "text",
          id: "t",
          x: 0,
          y: 0,
          text: SAMPLE,
          fontSize: 24,
          fontFamily: IDS.Cascadia,
        },
      ],
      "svg",
      { name: "family-svg" },
    );
    const svg = await Bun.file(rendered.file).text();
    // The rename is for the rasteriser; a caller's SVG keeps the family the
    // drawing uses, so a viewer with the real font installed picks it up.
    expect(svg).toContain('font-family="Cascadia,');
    expect(svg).not.toContain("Cascadia Code");
  });
});

type Image = { width: number; height: number; pixels: Uint8Array };

/**
 * An 8-bit RGBA PNG back to pixels, which is the only kind resvg writes.
 * Decoded here rather than with a dependency because the one thing worth
 * asserting about a raster — that the text is on it — cannot be read off the
 * file's length.
 */
function decode(png: Uint8Array): Image {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, colour] = [png[at + 16], png[at + 17]];
      if (depth !== 8 || colour !== 6) {
        throw new Error(
          `not an 8-bit RGBA PNG: depth ${depth} colour ${colour}`,
        );
      }
    }
    if (type === "IDAT") chunks.push(body);
    at += length + 12;
  }

  const data = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = data[row * (stride + 1)] as number;
    const line = data.subarray(
      row * (stride + 1) + 1,
      (row + 1) * (stride + 1),
    );
    for (let index = 0; index < stride; index++) {
      const raw = line[index] as number;
      const left =
        index >= 4 ? (pixels[row * stride + index - 4] as number) : 0;
      const up = row > 0 ? (pixels[(row - 1) * stride + index] as number) : 0;
      const upLeft =
        row > 0 && index >= 4
          ? (pixels[(row - 1) * stride + index - 4] as number)
          : 0;
      pixels[row * stride + index] =
        (raw + predict(filter, left, up, upLeft)) & 0xff;
    }
  }
  return { width, height, pixels };
}

function predict(filter: number, left: number, up: number, upLeft: number) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4: {
      const estimate = left + up - upLeft;
      const [dLeft, dUp, dUpLeft] = [
        Math.abs(estimate - left),
        Math.abs(estimate - up),
        Math.abs(estimate - upLeft),
      ];
      if (dLeft <= dUp && dLeft <= dUpLeft) return left;
      return dUp <= dUpLeft ? up : upLeft;
    }
    default:
      throw new Error(`unknown PNG filter ${filter}`);
  }
}

/** How wide the drawn text is, as the columns carrying any ink. */
function inkColumns(image: Image): number {
  let first = image.width;
  let last = -1;
  for (let x = 0; x < image.width; x++) {
    if (darkPixels(image, { x, y: 0, width: 1, height: image.height }) > 0) {
      first = Math.min(first, x);
      last = x;
    }
  }
  return last < first ? 0 : last - first + 1;
}

function darkPixels(
  image: Image,
  box: { x: number; y: number; width: number; height: number },
): number {
  let count = 0;
  for (let y = box.y; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const at = (y * image.width + x) * 4;
      const [red, green, blue] = [
        image.pixels[at] as number,
        image.pixels[at + 1] as number,
        image.pixels[at + 2] as number,
      ];
      if (red + green + blue < 300) count += 1;
    }
  }
  return count;
}

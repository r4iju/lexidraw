import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { signInToDev } from "@packages/dev-stack";
import { appUrl } from "./app-url";

type Json = Record<string, unknown>;
type Box = { x: number; y: number; width: number; height: number };

const text = (value: string): Json => ({
  type: "text",
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: "normal",
  style: "",
});
const paragraph = (...children: (Json | string)[]): Json => ({
  type: "paragraph",
  version: 1,
  children: children.map((child) =>
    typeof child === "string" ? text(child) : child,
  ),
  direction: null,
  format: "",
  indent: 0,
});
const rootOf = (children: Json[]) => ({
  root: {
    type: "root",
    version: 1,
    children,
    direction: null,
    format: "",
    indent: 0,
  },
});
const caption = (value: string) => ({
  editorState: rootOf(value ? [paragraph(value)] : []),
});
/** A picture `width` by `height` of a disc on a pale ground. */
const picture = (width: number, height: number) =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#e0f2fe"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="#0284c7"/></svg>`,
  ).toString("base64")}`;
const placedAt = (width: string) => ({ $: { figure: { width } } });
const image = (altText: string, size: [number, number], extra: Json = {}) => ({
  type: "image",
  version: 1,
  src: picture(...size),
  altText,
  width: size[0],
  height: size[1],
  maxWidth: 800,
  showCaption: false,
  caption: caption(altText),
  ...extra,
});
const inlineImage = (position: string, extra: Json = {}) => ({
  type: "inline-image",
  version: 1,
  src: picture(160, 90),
  altText: `Inline ${position}`,
  width: 160,
  height: 90,
  position,
  showCaption: false,
  caption: caption(`Inline ${position} caption`),
  ...extra,
});
const cell = (...children: (Json | string)[]): Json => ({
  type: "tablecell",
  version: 1,
  children: [paragraph(...children)],
  headerState: 0,
  colSpan: 1,
  rowSpan: 1,
  backgroundColor: null,
  direction: null,
  format: "",
  indent: 0,
});
const table = (...cells: Json[]): Json => ({
  type: "table",
  version: 1,
  children: [
    {
      type: "tablerow",
      version: 1,
      children: cells,
      direction: null,
      format: "",
      indent: 0,
    },
  ],
  direction: null,
  format: "",
  indent: 0,
});
const rectangle = (id: string, x: number) => ({
  id,
  type: "rectangle",
  x,
  y: 0,
  width: 160,
  height: 80,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "#dbeafe",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});
const drawing = (elements: unknown[], extra: Json = {}) => ({
  type: "excalidraw",
  version: 1,
  data: JSON.stringify({ elements, appState: {}, files: {} }),
  width: "inherit",
  height: "inherit",
  ...extra,
});
const SHAPES = [rectangle("a", 0), rectangle("b", 240)];
const PROSE =
  " Text after the image runs on for long enough to wrap around a floated image on a wide screen and on a phone, so the wrap is easy to see. It goes on for one more sentence so that the paragraph is taller than the image beside it.";

/** The document the figure checks read, as `PUT /entities/{id}` takes it. */
export function figuresDocument() {
  return rootOf([
    paragraph("Before the figures."),
    paragraph(image("Quarter", [1600, 500], placedAt("25%"))),
    paragraph("Before the captioned image."),
    paragraph(image("Captioned", [600, 300], { showCaption: true })),
    paragraph(image("Portrait", [400, 1000])),
    paragraph("Left: ", inlineImage("left"), PROSE),
    paragraph("Right: ", inlineImage("right"), PROSE),
    paragraph(
      "Captioned: ",
      inlineImage("right", { altText: "Inline captioned", showCaption: true }),
      PROSE,
    ),
    paragraph("Full: ", inlineImage("full"), PROSE),
    table(
      cell("A cell"),
      cell(inlineImage("left", { altText: "Inline in a cell" })),
    ),
    paragraph(drawing(SHAPES, placedAt("wide"))),
    paragraph(drawing(SHAPES, placedAt("full"))),
    paragraph("Before the empty drawing."),
    paragraph(drawing([])),
    paragraph("After the figures."),
  ]);
}

async function open(page: Page, id: string, width: number) {
  await page.setViewport({ width, height: 900 });
  await page.goto(`${appUrl}/documents/${id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector('img[alt="Quarter"]');
  await page.waitForSelector('img[alt="Inline in a cell"]');
}

/** The text column's left edge and width. */
function column(page: Page) {
  return page.$eval(".document-content > p", (text) => {
    const rect = text.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  });
}

const box = (page: Page, selector: string): Promise<Box> =>
  page.$eval(selector, (element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });

const near = (a: number, b: number, tolerance = 1) =>
  Math.abs(a - b) <= tolerance;

/** A figure placed at a share of the column is that share of it on a wide screen. */
export async function checkFigureShares(page: Page, id: string) {
  await open(page, id, 1280);
  const text = await column(page);
  const quarter = await box(page, 'img[alt="Quarter"]');
  assert(
    near(quarter.width, text.width / 4),
    `An image at 25% is a quarter of the ${text.width}px column; got ${quarter.width}`,
  );
  await open(page, id, 390);
  const phone = await column(page);
  const phoneQuarter = await box(page, 'img[alt="Quarter"]');
  assert(
    near(phoneQuarter.width, phone.width),
    `On a phone a share is the whole ${phone.width}px column; got ${phoneQuarter.width}`,
  );
}

/** The edit control of the inline image `alt`, and how it shows. */
function inlineEditButton(page: Page, alt: string) {
  return page.$eval(`img[alt="${alt}"]`, (img) => {
    const button = img
      .closest("[data-inline-image]")
      ?.querySelector<HTMLElement>('button[aria-label="Edit inline image"]');
    if (!button) return null;
    const { x, y, width, height } = button.getBoundingClientRect();
    return {
      x,
      y,
      width,
      height,
      opacity: Number(getComputedStyle(button).opacity),
    };
  });
}

/**
 * An inline image's edit control is a small icon in its top-right corner,
 * shown on hover or selection only, in a table cell too.
 */
export async function checkInlineImageControls(page: Page, id: string) {
  await open(page, id, 1280);
  for (const alt of ["Inline left", "Inline in a cell"]) {
    await page.$eval(`img[alt="${alt}"]`, (img) =>
      img.scrollIntoView({ block: "center" }),
    );
    await page.mouse.move(0, 0);
    await new Promise((settle) => setTimeout(settle, 300));
    const resting = await inlineEditButton(page, alt);
    assert(resting, `${alt} has an edit control`);
    assert.equal(resting.opacity, 0, `${alt}: no edit control at rest`);
    await page.hover(`img[alt="${alt}"]`);
    await new Promise((settle) => setTimeout(settle, 300));
    const hovered = await inlineEditButton(page, alt);
    const picture = await box(page, `img[alt="${alt}"]`);
    assert(hovered, `${alt} has an edit control`);
    assert.equal(hovered.opacity, 1, `${alt}: the edit control shows on hover`);
    assert(
      near(hovered.width, 24) && near(hovered.height, 24),
      `${alt}: the edit control is 24px; got ${hovered.width}x${hovered.height}`,
    );
    assert(
      hovered.x >= picture.x &&
        near(hovered.x + hovered.width, picture.x + picture.width, 8) &&
        near(hovered.y, picture.y, 8),
      `${alt}: the edit control sits in the image's top-right corner`,
    );
  }
}

/** Where the text after the inline image `alt` runs, line by line. */
function linesAfter(page: Page, alt: string) {
  return page.$eval(`img[alt="${alt}"]`, (img) => {
    const paragraph = img.closest("p");
    if (!paragraph) throw new Error(`${img.alt} is in no paragraph`);
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const after = paragraph.lastElementChild;
    if (after) range.setStartBefore(after);
    return [...range.getClientRects()]
      .filter((line) => line.width > 20 && line.height < 40)
      .map(({ x, y, width, height }) => ({ x, y, width, height }));
  });
}

/** An inline image placed left or right floats with text beside it; full takes the column. */
export async function checkInlineImagePositions(page: Page, id: string) {
  for (const width of [1280, 390]) {
    await open(page, id, width);
    const text = await column(page);
    for (const side of ["left", "right"] as const) {
      const alt = `Inline ${side}`;
      const picture = await box(page, `img[alt="${alt}"]`);
      assert(
        side === "left"
          ? near(picture.x, text.left)
          : near(picture.x + picture.width, text.right),
        `${alt} at ${width}px sits at the column's ${side} edge; got x ${picture.x} in ${text.left}–${text.right}`,
      );
      assert(
        picture.width <= text.width / 2 + 1,
        `${alt} at ${width}px is at most half the column; got ${picture.width}`,
      );
      const beside = (await linesAfter(page, alt)).filter(
        (line) => line.y < picture.y + picture.height - 4,
      );
      assert(
        beside.length > 0 &&
          beside.every((line) =>
            side === "left"
              ? line.x >= picture.x + picture.width
              : line.x + line.width <= picture.x,
          ),
        `${alt} at ${width}px has the paragraph's text wrapping beside it`,
      );
      const paragraphBottom = await page.$eval(
        `img[alt="${alt}"]`,
        (img) => img.closest("p")?.getBoundingClientRect().bottom ?? 0,
      );
      assert(
        paragraphBottom >= picture.y + picture.height,
        `${alt} at ${width}px is inside its paragraph`,
      );
    }
    const full = await box(page, 'img[alt="Inline full"]');
    assert(
      near(full.width, text.width) && near(full.height, (text.width * 9) / 16),
      `Inline full at ${width}px is the ${text.width}px column at 16:9; got ${full.width}x${full.height}`,
    );
    const picture = await box(page, 'img[alt="Inline captioned"]');
    const captionBox = await page.$eval(
      'img[alt="Inline captioned"]',
      (img) => {
        const caption = img
          .closest("[data-inline-image]")
          ?.querySelector(".document-caption");
        if (!caption) return null;
        const { x, y, width, height } = caption.getBoundingClientRect();
        return { x, y, width, height };
      },
    );
    assert(captionBox, "The captioned inline image shows its caption");
    assert(
      captionBox.y >= picture.y + picture.height &&
        near(captionBox.width, picture.width) &&
        near(
          captionBox.x + captionBox.width / 2,
          picture.x + picture.width / 2,
          2,
        ),
      `At ${width}px the caption sits centred under its inline image, as wide as it; got ${captionBox.width} under ${picture.width}`,
    );
  }
}

/**
 * A selected image's controls sit on the image: its toolbar inside the
 * top-left corner, clear of the block above, its resize corners at the
 * image's corners under a caption too, and a compact edit pill.
 */
export async function checkSelectedImage(page: Page, id: string) {
  await open(page, id, 1280);
  const selector = 'img[alt="Captioned"]';
  await page.$eval(selector, (img) => img.scrollIntoView({ block: "center" }));
  await page.click(selector);
  await page.waitForSelector('[role="toolbar"][aria-label="Figure"]');
  const controls = await page.$eval(selector, (img) => {
    const rect = (element: Element | null | undefined) => {
      if (!element) return null;
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const figure = img.closest(".document-figure");
    const edit = figure?.querySelector('button[aria-label="Edit image"]');
    const corners = [
      ...(figure?.querySelectorAll(
        ".cursor-nwse-resize, .cursor-nesw-resize",
      ) ?? []),
    ].map(rect);
    return {
      above: rect(img.closest("p")?.previousElementSibling),
      toolbar: rect(figure?.querySelector('[role="toolbar"]')),
      edit: rect(edit),
      editFont: edit ? getComputedStyle(edit).fontSize : null,
      editIcon: rect(edit?.querySelector("svg")),
      corners,
    };
  });
  const picture = await box(page, selector);
  const { above, toolbar, edit, editIcon, corners } = controls;
  assert(
    above && toolbar && edit && editIcon,
    "The selected image shows its controls",
  );
  assert(
    toolbar.y >= picture.y &&
      toolbar.x >= picture.x &&
      toolbar.y > above.y + above.height,
    `The toolbar sits inside the image, clear of the block above; got top ${toolbar.y}, image top ${picture.y}, block above ends ${above.y + above.height}`,
  );
  const left = Math.min(...corners.map((corner) => corner?.x ?? 0));
  const top = Math.min(...corners.map((corner) => corner?.y ?? 0));
  const right = Math.max(...corners.map((c) => (c ? c.x + c.width : 0)));
  const bottom = Math.max(...corners.map((c) => (c ? c.y + c.height : 0)));
  assert(
    near(left, picture.x) &&
      near(top, picture.y) &&
      near(right, picture.x + picture.width) &&
      near(bottom, picture.y + picture.height),
    `The resize corners sit at the image's corners; got ${left},${top}–${right},${bottom} for ${picture.x},${picture.y}–${picture.x + picture.width},${picture.y + picture.height}`,
  );
  assert(
    near(edit.height, 24) &&
      controls.editFont === "12px" &&
      near(editIcon.width, 14),
    `The edit pill is 24px tall with 12px text and a 14px icon; got ${edit.height}px, ${controls.editFont}, ${editIcon.width}px`,
  );
}

/** An image placed at no width keeps to a screenful's share of height. */
export async function checkImageHeightCap(page: Page, id: string) {
  await open(page, id, 1280);
  const portrait = await box(page, 'img[alt="Portrait"]');
  assert(
    portrait.height <= Math.min(900 * 0.6, 28 * 16) + 1,
    `A 400x1000 portrait is at most min(60svh, 28rem) tall; got ${portrait.height}`,
  );
  assert(
    near(portrait.width / portrait.height, 0.4, 0.01),
    `The portrait keeps its shape; got ${portrait.width}x${portrait.height}`,
  );
}

/**
 * A drawing placed wide or full fills that width, so the two differ on a wide
 * screen, and an empty drawing shows a writer a placeholder to select.
 */
export async function checkDrawings(page: Page, id: string) {
  await open(page, id, 1280);
  await page.waitForSelector(".excalidraw-embed");
  const placed = await page.$$eval(
    "[data-lexical-decorator][data-figure-width]:has(.excalidraw-embed)",
    (decorators) =>
      decorators.map((decorator) => ({
        width: decorator.getAttribute("data-figure-width"),
        column: decorator.getBoundingClientRect().width,
        drawing:
          decorator.querySelector(".excalidraw-embed")?.getBoundingClientRect()
            .width ?? 0,
      })),
  );
  const wide = placed.find((drawing) => drawing.width === "wide");
  const full = placed.find((drawing) => drawing.width === "full");
  assert(wide && full, "The wide and full drawings are on the page");
  for (const drawing of [wide, full])
    assert(
      near(drawing.drawing, drawing.column),
      `A drawing placed ${drawing.width} fills its ${drawing.column}px; got ${drawing.drawing}`,
    );
  assert(
    full.drawing > wide.drawing + 32,
    `A full drawing is wider than a wide one; got ${full.drawing} and ${wide.drawing}`,
  );

  const empty = await page.$$eval("[data-lexical-decorator]", (decorators) => {
    const decorator = decorators.find((element) =>
      element.textContent?.includes("Empty drawing"),
    );
    decorator?.scrollIntoView({ block: "center" });
    const { x, y, width, height } = decorator?.getBoundingClientRect() ?? {};
    return decorator ? { x, y, width, height } : null;
  });
  assert(
    empty?.height && empty.height >= 48,
    "An empty drawing shows a placeholder",
  );
  await page.mouse.click(
    (empty.x ?? 0) + (empty.width ?? 0) / 2,
    (empty.y ?? 0) + empty.height / 2,
  );
  await page.waitForSelector('[role="toolbar"][aria-label="Figure"]', {
    timeout: 5000,
  });
}

export async function checkFigures(page: Page, id: string) {
  await signInToDev(page, appUrl);
  await checkFigureShares(page, id);
  await checkInlineImageControls(page, id);
  await checkInlineImagePositions(page, id);
  await checkSelectedImage(page, id);
  await checkImageHeightCap(page, id);
  await checkDrawings(page, id);
}

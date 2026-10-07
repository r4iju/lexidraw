import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { signInToDev } from "@packages/dev-stack";
import { appUrl } from "./app-url";

type Json = Record<string, unknown>;

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
  caption: caption(""),
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
  caption: caption(""),
  ...extra,
});
const PROSE =
  " Text after the image runs on for long enough to wrap around a floated image on a wide screen and on a phone, so the wrap is easy to see.";

/** The document the figure checks read, as `PUT /entities/{id}` takes it. */
export function figuresDocument() {
  return rootOf([
    paragraph("Before the figures."),
    paragraph(image("Quarter", [1600, 500], placedAt("25%"))),
  ]);
}

async function open(page: Page, id: string, width: number) {
  await page.setViewport({ width, height: 900 });
  await page.goto(`${appUrl}/documents/${id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector('img[alt="Quarter"]');
}

/** The text column's left edge and width. */
function column(page: Page) {
  return page.$eval(".document-content > p", (text) => {
    const rect = text.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width };
  });
}

const box = (page: Page, selector: string) =>
  page.$eval(selector, (element) => element.getBoundingClientRect().toJSON());

/** A figure placed at a share of the column is that share of it on a wide screen. */
export async function checkFigureShares(page: Page, id: string) {
  await open(page, id, 1280);
  const text = await column(page);
  const quarter = await box(page, 'img[alt="Quarter"]');
  assert(
    Math.abs(quarter.width - text.width / 4) < 1,
    `An image at 25% is a quarter of the ${text.width}px column; got ${quarter.width}`,
  );
  await open(page, id, 390);
  const phone = await column(page);
  const phoneQuarter = await box(page, 'img[alt="Quarter"]');
  assert(
    Math.abs(phoneQuarter.width - phone.width) < 1,
    `On a phone a share is the whole ${phone.width}px column; got ${phoneQuarter.width}`,
  );
}

export async function checkFigures(page: Page, id: string) {
  await signInToDev(page, appUrl);
  await checkFigureShares(page, id);
}

import assert from "node:assert/strict";
import { PNG } from "pngjs";
import type { Page } from "puppeteer";
import { signInToDev } from "@packages/dev-stack";
import { appUrl } from "./app-url";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Node = Record<string, unknown>;
const text = (value: string): Node => ({
  type: "text",
  version: 1,
  text: value,
  format: 0,
  detail: 0,
  mode: "normal",
  style: "",
});
const block = (type: string, children: Node[], extra: Node = {}): Node => ({
  type,
  version: 1,
  children,
  direction: null,
  format: "",
  indent: 0,
  ...extra,
});
const paragraph = (value: string) =>
  block("paragraph", value ? [text(value)] : []);
const cell = (value: string | Node[], extra: Node = {}): Node =>
  block(
    "tablecell",
    typeof value === "string" ? [paragraph(value)] : value,
    {
      headerState: 0,
      colSpan: 1,
      rowSpan: 1,
      backgroundColor: null,
      ...extra,
    },
  );
const header = (value: string) => cell(value, { headerState: 1 });
const row = (cells: Node[]) => block("tablerow", cells);
const table = (rows: Node[], extra: Node = {}) =>
  block("table", rows, extra);
const checklist = (items: [string, boolean][]) =>
  block(
    "list",
    items.map(([value, checked], index) =>
      block("listitem", [text(value)], { value: index + 1, checked }),
    ),
    { listType: "check", start: 1, tag: "ul" },
  );

const PEOPLE = ["Ada", "Ben", "Cy", "Di", "Eve"];
const people = (extra: Node) =>
  table(
    [
      row([header("Name"), header("Role")]),
      ...PEOPLE.map((name) => row([cell(name), cell("Engineer")])),
    ],
    extra,
  );

/**
 * A document of the table variants whose presentation markdown cannot
 * write: stripes, merged and coloured cells, a frozen column, a lone cell,
 * and a check list in a narrow column.
 */
export const TABLE_PRESENTATION_ROOT = {
  type: "root",
  version: 1,
  direction: null,
  format: "",
  indent: 0,
  children: [
    paragraph("Tables whose look markdown cannot write."),
    people({ rowStriping: true }),
    people({}),
    table([
      row([header("Merged across two"), header("C")].map((h, i) =>
        i === 0 ? { ...h, colSpan: 2 } : h,
      )),
      row([
        cell("Tall", { rowSpan: 2, backgroundColor: "#fef3c7" }),
        cell("Red", { backgroundColor: "#fee2e2" }),
        cell("Blue", { backgroundColor: "#dbeafe" }),
      ]),
      row([
        cell("Green", { backgroundColor: "#dcfce7" }),
        cell("A sentence long enough to wrap and make its row tall."),
      ]),
    ]),
    table(
      [
        row(
          Array.from({ length: 12 }, (_, i) =>
            header(i ? `Column ${i}` : "Frozen"),
          ),
        ),
        ...Array.from({ length: 4 }, (_, r) =>
          row(
            Array.from({ length: 12 }, (_, i) =>
              i
                ? cell(`r${r + 1}c${i}`)
                : cell(`Row ${r + 1}`, { headerState: 2 }),
            ),
          ),
        ),
      ],
      { frozenRowCount: 1, frozenColumnCount: 1 },
    ),
    table([row([cell("Lonely cell")])]),
    table([
      row([header("List"), header("A"), header("B")]),
      row([
        cell([
          checklist([
            ["one", true],
            ["two", false],
          ]),
        ]),
        cell("1"),
        cell("2"),
      ]),
    ]),
    paragraph("End."),
  ],
};

type Rgb = [number, number, number];

/** WCAG relative luminance. */
const luminance = ([r, g, b]: Rgb) => {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};
const distance = (a: Rgb, b: Rgb) =>
  Math.max(...a.map((channel, i) => Math.abs(channel - (b[i] ?? 0))));

/** The colour the screen shows at a point of the viewport. */
async function pixel(page: Page, x: number, y: number): Promise<Rgb> {
  const shot = await page.screenshot({
    clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 },
  });
  const { data } = PNG.sync.read(Buffer.from(shot));
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

const parseRgb = (css: string): Rgb => {
  const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b];
};

/** The document's tables, in order, scrolled into view one at a time. */
const tableAt = (page: Page, index: number) =>
  page.evaluate((index) => {
    const table = document.querySelectorAll<HTMLTableElement>(
      ".document-content table.document-table:not([data-print-table])",
    )[index];
    if (!table) throw new Error(`Missing table ${index}`);
    table.scrollIntoView({ block: "center" });
    const { left, right, top, bottom } = table.getBoundingClientRect();
    return { left, right, top, bottom };
  }, index);

async function open(page: Page, id: string, theme: "light" | "dark") {
  await page.evaluate((theme) => localStorage.setItem("theme", theme), theme);
  await page.goto(`${appUrl}/documents/${id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector(".document-content table");
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await page.mouse.move(0, 0);
  await pause(800);
}

/** Every second body row is shaded, apart from the header and the rest. */
async function checkStripes(page: Page, label: string) {
  const fills = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLTableElement>(
        ".document-content table.document-table:not([data-print-table])",
      ),
    ]
      .slice(0, 2)
      .map((table) =>
        [...table.rows].map((row) =>
          getComputedStyle(row.cells[1] as Element).backgroundColor,
        ),
      ),
  );
  const [striped = [], plain = []] = fills;
  const [head, ...body] = striped;
  assert.equal(new Set(plain.slice(1)).size, 1, `${label}: unstriped rows match`);
  assert.equal(body[0], plain[1], `${label}: the first body row is plain`);
  assert.equal(body[2], body[0], `${label}: stripes alternate`);
  assert.equal(body[4], body[0], `${label}: stripes alternate`);
  assert.notEqual(body[1], body[0], `${label}: the second body row is shaded`);
  assert.equal(body[3], body[1], `${label}: stripes alternate`);
  assert.notEqual(body[1], head, `${label}: a stripe is not the header's fill`);
}

/** The colour of the page behind the document. */
const pageBackground = (page: Page) =>
  page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  ).then(parseRgb);

export async function checkTablePresentation(page: Page, id: string) {
  await signInToDev(page, appUrl);
  await page.setViewport({ width: 1280, height: 900 });
  await open(page, id, "light");
  const background = await pageBackground(page);

  await checkStripes(page, "light");

  // A merged cell in the table's corner takes the table's rounded corner.
  const merged = await tableAt(page, 2);
  await pause(200);
  assert(
    distance(
      await pixel(page, merged.left + 1, merged.bottom - 2),
      background,
    ) < 12,
    "The corner cell of a merged table is rounded with the table",
  );

  // A wide table keeps its frozen column and hints at what scrolls, with
  // no bar over its rows.
  await tableAt(page, 3);
  const wide = await page.evaluate(() => {
    const table = document.querySelectorAll<HTMLTableElement>(
      ".document-content table.document-table:not([data-print-table])",
    )[3] as HTMLTableElement;
    const region = table.parentElement as HTMLElement;
    const first = table.rows[1]?.cells[0] as HTMLElement;
    const before = first.getBoundingClientRect().left;
    region.scrollLeft = 200;
    const rows = [0, 2].map((index) => {
      const rect = table.rows[index]?.cells[5]?.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : 0;
    });
    return {
      before,
      after: first.getBoundingClientRect().left,
      right: region.getBoundingClientRect().right,
      scrolls: region.scrollWidth > region.clientWidth,
      header: rows[0] ?? 0,
      body: rows[1] ?? 0,
      headerFill: getComputedStyle(table.rows[0]?.cells[5] as Element)
        .backgroundColor,
    };
  });
  await pause(300);
  assert(wide.scrolls, "The 12-column table scrolls at 1280px");
  assert(
    Math.abs(wide.before - wide.after) < 1,
    "A frozen first column stays put as the table scrolls",
  );
  const edgeBody = await pixel(page, wide.right - 2, wide.body);
  assert(
    luminance(edgeBody) >= luminance(background) - 0.05,
    `No dark bar where a table scrolls on: ${edgeBody} over ${background}`,
  );
  const edgeHeader = await pixel(page, wide.right - 2, wide.header);
  assert(
    distance(edgeHeader, background) <
      distance(parseRgb(wide.headerFill), background),
    "The edge a table scrolls towards fades its header too",
  );

  // The cell menu's trigger never covers the cell's text.
  for (const value of ["1", "Lonely cell", "List", "one", "Tall"]) {
    const textBox = await page.evaluate((value) => {
      const cell = [
        ...document.querySelectorAll<HTMLElement>(
          ".document-content td, .document-content th",
        ),
      ].find((cell) => cell.textContent?.trim().startsWith(value));
      const span = [...(cell?.querySelectorAll("[data-lexical-text]") ?? [])].find(
        (span) => span.textContent?.startsWith(value),
      );
      if (!cell || !span) throw new Error(`Missing cell ${value}`);
      cell.scrollIntoView({ block: "center" });
      const { left, top, height } = span.getBoundingClientRect();
      return { x: left + 2, y: top + height / 2 };
    }, value);
    await page.mouse.click(textBox.x, textBox.y);
    await page.waitForSelector('button[aria-label="Table cell actions"]', {
      visible: true,
    });
    await pause(200);
    const overlap = await page.evaluate((value) => {
      const trigger = document
        .querySelector('button[aria-label="Table cell actions"]')
        ?.getBoundingClientRect();
      const cell = [
        ...document.querySelectorAll<HTMLElement>(
          ".document-content td, .document-content th",
        ),
      ].find((cell) => cell.textContent?.trim().startsWith(value));
      if (!trigger || !cell) throw new Error("Missing trigger or cell");
      const range = document.createRange();
      range.selectNodeContents(cell);
      const boxes = [
        ...range.getClientRects(),
        ...[...cell.querySelectorAll("li")].map((item) => {
          // A check item's box is drawn in the start of its padding.
          const { left, top } = item.getBoundingClientRect();
          return new DOMRect(left, top, 20, 20);
        }),
      ].filter((box) => box.width > 0);
      return boxes
        .filter(
          (box) =>
            box.left < trigger.right &&
            box.right > trigger.left &&
            box.top < trigger.bottom &&
            box.bottom > trigger.top,
        )
        .map((box) => box.toJSON());
    }, value);
    assert.deepEqual(overlap, [], `The cell menu covers "${value}"`);
  }
  await page.keyboard.press("Escape");

  await checkCheckList(page, "1280");

  await open(page, id, "dark");
  await checkStripes(page, "dark");
  await tableAt(page, 2);
  const tinted = await page.evaluate(() =>
    ["Tall", "Red", "Blue", "Green"].map((value) => {
      const cell = [
        ...document.querySelectorAll<HTMLElement>(".document-content td"),
      ].find((cell) => cell.textContent?.trim() === value) as HTMLElement;
      const { left, top } = cell.getBoundingClientRect();
      const span = cell.querySelector("[data-lexical-text]") as Element;
      return { value, x: left + 3, y: top + 3, color: getComputedStyle(span).color };
    }),
  );
  await pause(200);
  for (const { value, x, y, color } of tinted) {
    const fill = await pixel(page, x, y);
    assert(
      luminance(fill) < 0.15,
      `In the dark theme the ${value} cell is a dark tint: ${fill}`,
    );
    assert(
      contrast(fill, parseRgb(color)) >= 4.5,
      `The ${value} cell's text reads over its tint: ${fill} under ${color}`,
    );
  }
  const [red, blue] = [
    await pixel(page, tinted[1]?.x ?? 0, tinted[1]?.y ?? 0),
    await pixel(page, tinted[2]?.x ?? 0, tinted[2]?.y ?? 0),
  ];
  assert(
    (red?.[0] ?? 0) > (red?.[2] ?? 0) && (blue?.[2] ?? 0) > (blue?.[0] ?? 0),
    `A tint keeps its colour's hue: red ${red}, blue ${blue}`,
  );

  await page.setViewport({
    width: 390,
    height: 844,
    hasTouch: true,
    isMobile: true,
  });
  await open(page, id, "light");
  await checkCheckList(page, "390");
  console.log(
    "Table presentation: stripes, dark tints, scroll edge, frozen column, cell menu, check lists",
  );
}

/** A check item's text starts on its checkbox's line, beside it. */
async function checkCheckList(page: Page, label: string) {
  await tableAt(page, 5);
  const items = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        ".document-content td li.document-task",
      ),
    ].map((item) => {
      const box = getComputedStyle(item, "::before");
      const span = item.querySelector("[data-lexical-text]") as Element;
      const [first] = span.getClientRects();
      const itemBox = item.getBoundingClientRect();
      return {
        text: span.textContent,
        boxTop: itemBox.top + Number.parseFloat(box.top),
        boxRight:
          itemBox.left +
          Number.parseFloat(box.insetInlineStart || box.left) +
          Number.parseFloat(box.width),
        textTop: first?.top ?? 0,
        textLeft: first?.left ?? 0,
        textBottom: first?.bottom ?? 0,
      };
    }),
  );
  assert.equal(items.length, 2);
  for (const item of items) {
    assert(
      item.textTop <= item.boxTop && item.boxTop < item.textBottom,
      `${label}: "${item.text}" starts beside its checkbox: ${JSON.stringify(item)}`,
    );
    assert(item.textLeft >= item.boxRight, `${label}: text after the box`);
  }
}

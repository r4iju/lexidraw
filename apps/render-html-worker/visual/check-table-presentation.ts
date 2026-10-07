import assert from "node:assert/strict";
import { PNG } from "pngjs";
import type { Page } from "puppeteer";
import { signInToDev } from "@packages/dev-stack";
import { appUrl } from "./app-url";

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
  block("tablecell", typeof value === "string" ? [paragraph(value)] : value, {
    headerState: 0,
    colSpan: 1,
    rowSpan: 1,
    backgroundColor: null,
    ...extra,
  });
const header = (value: string) => cell(value, { headerState: 1 });
const row = (cells: Node[]) => block("tablerow", cells);
const table = (rows: Node[], extra: Node = {}) => block("table", rows, extra);
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
      row(
        [header("Merged across two"), header("C")].map((h, i) =>
          i === 0 ? { ...h, colSpan: 2 } : h,
        ),
      ),
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

/** Writes the presentation tables into a new throwaway document, for the
 * caller to delete, and returns its id. */
export async function createTablePresentationDocument(
  cli: (...args: string[]) => Promise<{ id: string; updatedAt?: string }>,
) {
  const { id } = await cli("doc", "create", "--title", "Visual check · tables");
  const { updatedAt } = await cli("doc", "get", id, "--format", "json");
  await cli(
    "api",
    "PUT",
    `/entities/${id}`,
    "--json",
    JSON.stringify({
      elements: JSON.stringify({ root: TABLE_PRESENTATION_ROOT }),
      appState: JSON.stringify({ defaultFontFamily: null, lang: null }),
      ifUnmodifiedSince: updatedAt,
    }),
  );
  return id;
}

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
  // A clip is measured from the document's start, not the viewport's.
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  const shot = await page.screenshot({
    clip: {
      x: Math.round(x) + scroll.x,
      y: Math.round(y) + scroll.y,
      width: 1,
      height: 1,
    },
  });
  const { data } = PNG.sync.read(Buffer.from(shot));
  return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
}

const parseRgb = (css: string): Rgb => {
  const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).map(Number);
  return [r, g, b];
};

/**
 * Waits for the fonts, then for the page to hold still: the scroll, every
 * table and region and the cell menu in place, and no finite transition
 * running, for several frames in a row. A cold load keeps moving well after
 * its first paint, and a fixed pause is either too short or too slow.
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const shape = () =>
      JSON.stringify([
        scrollX,
        scrollY,
        ...[
          ...document.querySelectorAll<HTMLElement>(
            '.document-content :is(table, .document-table-region), button[aria-label="Table cell actions"]',
          ),
        ].map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return [x, y, width, height, element.scrollLeft];
        }),
      ]);
    const moving = () =>
      document
        .getAnimations()
        .some(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getTiming().iterations !==
              Number.POSITIVE_INFINITY,
        );
    let last = shape();
    for (let still = 0, frames = 0; still < 5; frames++) {
      if (frames > 1200) throw new Error("The page never held still");
      await new Promise(requestAnimationFrame);
      const next = shape();
      still = next === last && !moving() ? still + 1 : 0;
      last = next;
    }
  });
}

const TABLES = ".document-content table.document-table:not([data-print-table])";

/** The document's tables, in order, scrolled into view one at a time. */
async function tableAt(page: Page, index: number) {
  await page.evaluate(
    (tables, index) => {
      const table = document.querySelectorAll(tables)[index];
      if (!table) throw new Error(`Missing table ${index}`);
      table.scrollIntoView({ block: "center" });
    },
    TABLES,
    index,
  );
  await settle(page);
  return page.evaluate(
    (tables, index) => {
      const { left, right, top, bottom } = (
        document.querySelectorAll(tables)[index] as Element
      ).getBoundingClientRect();
      return { left, right, top, bottom };
    },
    TABLES,
    index,
  );
}

async function open(page: Page, id: string, theme: "light" | "dark") {
  await page.evaluate((theme) => localStorage.setItem("theme", theme), theme);
  await page.goto(`${appUrl}/documents/${id}`, { waitUntil: "load" });
  // Editable, with every table measured and marked by its plugin.
  await page.waitForFunction(() => {
    const tables = document.querySelectorAll(
      '[contenteditable="true"] table.document-table:not([data-print-table])',
    );
    return (
      tables.length === 6 &&
      [...tables].every(
        (table) => table.parentElement?.getAttribute("role") === "region",
      )
    );
  });
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await page.mouse.move(0, 0);
  await settle(page);
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
        [...table.rows].map(
          (row) => getComputedStyle(row.cells[1] as Element).backgroundColor,
        ),
      ),
  );
  const [striped = [], plain = []] = fills;
  const [head, ...body] = striped;
  assert.equal(
    new Set(plain.slice(1)).size,
    1,
    `${label}: unstriped rows match`,
  );
  assert.equal(body[0], plain[1], `${label}: the first body row is plain`);
  assert.equal(body[2], body[0], `${label}: stripes alternate`);
  assert.equal(body[4], body[0], `${label}: stripes alternate`);
  assert.notEqual(body[1], body[0], `${label}: the second body row is shaded`);
  assert.equal(body[3], body[1], `${label}: stripes alternate`);
  assert.notEqual(body[1], head, `${label}: a stripe is not the header's fill`);
}

/** Runs every step, so one failing presentation does not hide the next. */
async function steps(list: [string, () => Promise<void>][]) {
  const failures: string[] = [];
  for (const [name, run] of list) {
    try {
      await run();
      console.log(`ok   ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name}: ${message}`);
      console.log(`FAIL ${name}: ${message}`);
    }
  }
  assert.deepEqual(failures, [], "Table presentation");
}

/** Clicks into a cell until its menu's trigger shows. A click that lands
 * while the editor is still taking focus selects nothing. */
async function openCellMenu(page: Page, at: { x: number; y: number }) {
  for (let attempt = 1; ; attempt++) {
    await page.mouse.click(at.x, at.y);
    try {
      await page.waitForSelector('button[aria-label="Table cell actions"]', {
        visible: true,
        timeout: 10_000,
      });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
    }
  }
  await settle(page);
}

/** The cell menu's trigger never covers the text of the cell it is for. */
async function checkCellMenu(page: Page) {
  for (const value of ["1", "Lonely cell", "List", "one", "Tall"]) {
    const textBox = await page.evaluate((value) => {
      const cell = [
        ...document.querySelectorAll<HTMLElement>(
          ".document-content td, .document-content th",
        ),
      ].find((cell) => cell.textContent?.trim().startsWith(value));
      const span = [
        ...(cell?.querySelectorAll("[data-lexical-text]") ?? []),
      ].find((span) => span.textContent?.startsWith(value));
      if (!cell || !span) throw new Error(`Missing cell ${value}`);
      cell.scrollIntoView({ block: "center" });
      const { right, top, height } = span.getBoundingClientRect();
      return { x: right - 1, y: top + height / 2 };
    }, value);
    await openCellMenu(page, textBox);
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
}

/** A merged cell in the table's corner takes the table's rounded corner. */
async function checkMergedCorner(page: Page) {
  const merged = await tableAt(page, 2);
  const outside = await pixel(page, merged.left + 1, merged.bottom + 6);
  const corner = await pixel(page, merged.left + 1, merged.bottom - 2);
  const fill = await pixel(page, merged.left + 6, merged.bottom - 8);
  assert(
    distance(corner, outside) < distance(fill, outside) / 2,
    `The corner cell of a merged table is rounded with the table: ${corner} in ${fill} over ${outside}`,
  );
}

/** A wide table keeps its frozen column and hints at what scrolls, with no
 * bar over its rows. */
async function checkWideTable(page: Page) {
  await tableAt(page, 3);
  const firstLeft = () =>
    page.evaluate((tables) => {
      const table = document.querySelectorAll<HTMLTableElement>(tables)[3];
      return table?.rows[1]?.cells[0]?.getBoundingClientRect().left ?? 0;
    }, TABLES);
  // From the start, then partway, so there is more to either side.
  const scrollTo = async (part: number) => {
    await page.evaluate(
      (tables, part) => {
        const region = document.querySelectorAll(tables)[3]
          ?.parentElement as HTMLElement;
        region.scrollLeft = (region.scrollWidth - region.clientWidth) * part;
      },
      TABLES,
      part,
    );
    await settle(page);
  };
  await scrollTo(0);
  const before = await firstLeft();
  await scrollTo(0.5);
  const wide = await page.evaluate((tables) => {
    const table = document.querySelectorAll<HTMLTableElement>(
      tables,
    )[3] as HTMLTableElement;
    const region = table.parentElement as HTMLElement;
    const first = table.rows[1]?.cells[0] as HTMLElement;
    const rows = [0, 2].map((index) => {
      const rect = table.rows[index]?.cells[5]?.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : 0;
    });
    const { right, bottom } = region.getBoundingClientRect();
    return {
      after: first.getBoundingClientRect().left,
      right,
      bottom,
      scrolls: region.scrollWidth > region.clientWidth,
      header: rows[0] ?? 0,
      body: rows[1] ?? 0,
      headerFill: getComputedStyle(table.rows[0]?.cells[5] as Element)
        .backgroundColor,
    };
  }, TABLES);
  assert(wide.scrolls, "The 12-column table scrolls");
  const background = await pixel(page, wide.right - 2, wide.bottom + 6);
  const edgeBody = await pixel(page, wide.right - 2, wide.body);
  const edgeHeader = await pixel(page, wide.right - 2, wide.header);
  const failures: string[] = [];
  if (Math.abs(before - wide.after) >= 1)
    failures.push(
      `A frozen first column stays put as the table scrolls: ${before} then ${wide.after}`,
    );
  if (distance(edgeBody, background) > 12)
    failures.push(
      `No bar where a table scrolls on: ${edgeBody} over ${background}`,
    );
  if (
    distance(edgeHeader, background) >=
    distance(parseRgb(wide.headerFill), background) / 2
  )
    failures.push(
      `The edge a table scrolls towards fades its header too: ${edgeHeader} over ${background}`,
    );
  assert.deepEqual(failures, []);
}

/** In the dark theme a cell's colour is a dark tint of it under light text. */
async function checkDarkTints(page: Page) {
  await tableAt(page, 2);
  const tinted = await page.evaluate(() =>
    ["Tall", "Red", "Blue", "Green"].map((value) => {
      const cell = [
        ...document.querySelectorAll<HTMLElement>(".document-content td"),
      ].find((cell) => cell.textContent?.trim() === value) as HTMLElement;
      const { left, top } = cell.getBoundingClientRect();
      const span = cell.querySelector("[data-lexical-text]") as Element;
      return {
        value,
        x: left + 3,
        y: top + 3,
        color: (() => {
          // Computed colours come back in the theme's spaces, such as lab().
          const canvas = document.createElement("canvas").getContext("2d");
          if (!canvas) throw new Error("No canvas");
          canvas.fillStyle = getComputedStyle(span).color;
          canvas.fillRect(0, 0, 1, 1);
          const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
          return `rgb(${r}, ${g}, ${b})`;
        })(),
      };
    }),
  );
  const fills: Rgb[] = [];
  for (const { value, x, y, color } of tinted) {
    const fill = await pixel(page, x, y);
    fills.push(fill);
    assert(
      luminance(fill) < 0.15,
      `In the dark theme the ${value} cell is a dark tint: ${fill}`,
    );
    assert(
      contrast(fill, parseRgb(color)) >= 4.5,
      `The ${value} cell's text reads over its tint: ${fill} under ${color}`,
    );
  }
  const [, red = [0, 0, 0], blue = [0, 0, 0]] = fills;
  assert(
    red[0] > red[2] && blue[2] > blue[0],
    `A tint keeps its colour's hue: red ${red}, blue ${blue}`,
  );
}

export async function checkTablePresentation(page: Page, id: string) {
  // A loaded machine paints slowly; this checks layout, not speed.
  const timeout = page.getDefaultTimeout();
  page.setDefaultTimeout(120_000);
  try {
    // A tab in the background draws no frames, so nothing that waits on one,
    // such as the cell menu, would ever move.
    await page.bringToFront();
    await signInToDev(page, appUrl);
    await page.setViewport({ width: 1280, height: 900 });
    await open(page, id, "light");
    await steps([
      ["light stripes", () => checkStripes(page, "light")],
      ["merged corner", () => checkMergedCorner(page)],
      ["wide table at 1280", () => checkWideTable(page)],
      ["cell menu", () => checkCellMenu(page)],
      ["check list at 1280", () => checkCheckList(page, "1280")],
      [
        "dark theme",
        async () => {
          await open(page, id, "dark");
          await checkStripes(page, "dark");
        },
      ],
      ["dark tints", () => checkDarkTints(page)],
      ["dark wide table", () => checkWideTable(page)],
      [
        "check list at 390",
        async () => {
          await page.setViewport({
            width: 390,
            height: 844,
            hasTouch: true,
            isMobile: true,
          });
          await open(page, id, "light");
          await checkCheckList(page, "390");
        },
      ],
      ["wide table at 390", () => checkWideTable(page)],
    ]);
    console.log(
      "Table presentation: stripes, dark tints, scroll edge, frozen column, cell menu, check lists",
    );
  } finally {
    page.setDefaultTimeout(timeout);
  }
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

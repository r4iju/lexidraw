import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeyInput, Page } from "puppeteer";
import { devCli, signInToDev } from "@packages/dev-stack";
import { appUrl } from "./app-url";

const EDITOR = '[contenteditable][data-lexical-editor="true"]';
const SEPARATOR = '[role="separator"][aria-label^="Resize columns"]';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Two columns between two paragraphs, as markdown writes them. */
export const COLUMNS_MARKDOWN = [
  "Before",
  "<columns>\n<column>\n\nLeft one\n\nLeft two\n\n</column>\n<column>\n\nRight one\n\n</column>\n</columns>",
  "After",
].join("\n\n");

/** An open toggle, then columns whose first column starts with a heading. */
export const COLUMN_LAYOUT_MARKDOWN = [
  "Before",
  "<details open>\n<summary>Open toggle</summary>\n\nToggle text\n\n</details>",
  "<columns>\n<column>\n\n## Heading in column\n\nUnder the heading\n\n</column>\n<column>\n\nRight one\n\n</column>\n</columns>",
  "After",
].join("\n\n");

type Block = {
  type: string;
  text?: string;
  templateColumns?: string;
  children?: Block[];
};

/** The document as `type(children)`, text as itself, and a row's template. */
async function outline(page: Page) {
  return page.evaluate((selector) => {
    type Node = Block;
    const show = (node: Node): string =>
      node.type === "text"
        ? (node.text ?? "")
        : `${node.type === "layout-container" ? `columns[${node.templateColumns}]` : node.type}(${(node.children ?? []).map(show).join(" ")})`;
    const root = document.querySelector<
      HTMLElement & {
        __lexicalEditor?: { getEditorState(): { toJSON(): { root: Node } } };
      }
    >(selector);
    const json = root?.__lexicalEditor?.getEditorState().toJSON();
    return (json?.root.children ?? []).map(show);
  }, EDITOR);
}

/** Puts the caret in the text `text` at `offset`, -1 for its end. */
async function caret(page: Page, text: string, offset: number) {
  await page.evaluate(
    (selector, text, offset) => {
      const root = document.querySelector<HTMLElement>(selector);
      if (!root) throw new Error("No editor");
      root.focus();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent !== text) continue;
        const at = offset < 0 ? text.length : offset;
        window.getSelection()?.setBaseAndExtent(node, at, node, at);
        return;
      }
      throw new Error(`Missing text ${text}`);
    },
    EDITOR,
    text,
    offset,
  );
  await pause(150);
}

async function press(page: Page, key: KeyInput, modifier?: string) {
  if (modifier) await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  if (modifier) await page.keyboard.up(modifier);
  await pause(150);
}

/** Puts the document back as it was saved, between cases. */
async function reset(page: Page, start: unknown) {
  await page.evaluate(
    (selector, start) => {
      const root = document.querySelector<
        HTMLElement & {
          __lexicalEditor?: {
            setEditorState(state: unknown): void;
            parseEditorState(json: unknown): unknown;
          };
        }
      >(selector);
      const editor = root?.__lexicalEditor;
      editor?.setEditorState(editor.parseEditorState(start));
    },
    EDITOR,
    start,
  );
  await pause(250);
}

async function separator(page: Page) {
  return page.$$eval(SEPARATOR, (handles) =>
    handles.map((handle) => {
      const box = handle.getBoundingClientRect();
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        width: box.width,
        height: box.height,
        orientation: handle.getAttribute("aria-orientation"),
        value: handle.getAttribute("aria-valuenow"),
        tabIndex: handle instanceof HTMLElement ? handle.tabIndex : -1,
        display: getComputedStyle(handle).display,
      };
    }),
  );
}

/** Writes `markdown` as a throwaway document titled `title`: its id. */
async function createDocument(title: string, markdown: string) {
  const folder = await mkdtemp(join(tmpdir(), "columns-"));
  const file = join(folder, "columns.md");
  await writeFile(file, markdown);
  const created = await devCli(appUrl)(
    "doc",
    "create",
    "--title",
    title,
    "--file",
    file,
  );
  if (
    !created ||
    typeof created !== "object" ||
    !("id" in created) ||
    typeof created.id !== "string"
  )
    throw new Error(`The CLI made no document: ${JSON.stringify(created)}`);
  return created.id;
}

/**
 * Columns leave as Notion's do: a line move that would land in the column
 * beside leaves the row instead, select all selects the column first, an
 * HTML-only paste keeps them, and the split between two columns drags,
 * double-clicks back to equal and moves with the arrow keys, but not where
 * the document is read-only, the columns are stacked, or on paper.
 */
export async function checkColumns(page: Page) {
  const id = await createDocument("Visual suite · columns", COLUMNS_MARKDOWN);
  try {
    await signInToDev(page, appUrl);
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaType("screen");
    await page.goto(`${appUrl}/documents/${id}`, {
      waitUntil: "networkidle2",
    });
    await page.waitForSelector(`${EDITOR} [data-lexical-layout-container]`);
    await pause(800);
    const start = await page.evaluate((selector) => {
      const root = document.querySelector<
        HTMLElement & {
          __lexicalEditor?: { getEditorState(): { toJSON(): unknown } };
        }
      >(selector);
      return root?.__lexicalEditor?.getEditorState().toJSON();
    }, EDITOR);
    const row = (left: string, right: string, template = "1fr 1fr") =>
      `columns[${template}](layout-item(${left}) layout-item(${right}))`;
    const unchanged = row(
      "paragraph(Left one) paragraph(Left two)",
      "paragraph(Right one)",
    );
    assert.deepEqual(
      await outline(page),
      ["paragraph(Before)", unchanged, "paragraph(After)"],
      "the columns document loads as written",
    );

    // Down from the last line of the first column lands after the row, not
    // in the column beside it; Up from the top of the second, before it.
    await caret(page, "Left two", -1);
    await press(page, "ArrowDown");
    await page.keyboard.type("Q");
    await pause(150);
    assert.deepEqual(
      await outline(page),
      ["paragraph(Before)", unchanged, "paragraph(QAfter)"],
      "Down from a column's last line leaves the columns",
    );
    await reset(page, start);
    await caret(page, "Right one", 0);
    await press(page, "ArrowUp");
    await page.keyboard.type("Q");
    await pause(150);
    assert.deepEqual(
      await outline(page),
      ["paragraph(BeforeQ)", unchanged, "paragraph(After)"],
      "Up from a column's first line leaves the columns",
    );

    // Select all selects the column, and again the document.
    await reset(page, start);
    await caret(page, "Left one", 2);
    await press(page, "a", "Meta");
    await page.keyboard.type("Z");
    await pause(150);
    assert.deepEqual(
      await outline(page),
      [
        "paragraph(Before)",
        row("paragraph(Z)", "paragraph(Right one)"),
        "paragraph(After)",
      ],
      "select all in a column selects the column",
    );

    // The browser's HTML of a row of columns pastes as columns.
    await reset(page, start);
    await caret(page, "After", -1);
    await page.evaluate((selector) => {
      const data = new DataTransfer();
      data.setData(
        "text/html",
        '<div data-lexical-layout-container="true" style="grid-template-columns: 1fr 3fr"><div data-lexical-layout-item="true"><p>P</p></div><div data-lexical-layout-item="true"><p>Q</p></div></div>',
      );
      data.setData("text/plain", "P\nQ");
      document.querySelector(selector)?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, EDITOR);
    await pause(250);
    assert(
      (await outline(page)).includes(
        row("paragraph(P)", "paragraph(Q)", "1fr 3fr"),
      ),
      `HTML of columns pastes as columns: ${(await outline(page)).join(" ")}`,
    );

    // One split, over the gap, labelled and focusable.
    await reset(page, start);
    let [handle] = await separator(page);
    assert(handle, "a split sits between two columns");
    assert.equal(handle.orientation, "vertical");
    assert.equal(handle.value, "50", "an equal split is at half");
    assert.equal(handle.tabIndex, 0, "the split takes focus");
    const gap = await page.$eval(
      `${EDITOR} [data-lexical-layout-container]`,
      (container) => {
        const [left, right] = [...container.children].map((item) =>
          item.getBoundingClientRect(),
        );
        return {
          from: left?.right ?? 0,
          to: right?.left ?? 0,
          width: container.getBoundingClientRect().width,
        };
      },
    );
    assert(
      handle.x >= gap.from - 1 && handle.x <= gap.to + 1,
      `the split is over the gap: ${handle.x} in ${gap.from}..${gap.to}`,
    );

    // Dragging moves the split, and so the widths.
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + gap.width / 4, handle.y, { steps: 8 });
    await page.mouse.up();
    await pause(250);
    const dragged = (await outline(page))[1] ?? "";
    const [, left = "0", right = "0"] =
      /columns\[([\d.]+)fr ([\d.]+)fr\]/.exec(dragged) ?? [];
    assert(
      Number(left) > Number(right) * 2,
      `dragging right widens the left column: ${dragged}`,
    );
    // One drag is one step to undo.
    await press(page, "z", "Meta");
    assert.equal(
      (await outline(page))[1],
      unchanged,
      "undo puts back the widths before the drag",
    );
    await reset(page, start);

    // The arrow keys move a focused split; a double-click makes it equal.
    await page.focus(SEPARATOR);
    await press(page, "ArrowRight");
    [handle] = await separator(page);
    assert(
      Number(handle?.value) > 50,
      `ArrowRight moves the split right: ${handle?.value}`,
    );
    assert.notEqual((await outline(page))[1], unchanged);
    [handle] = await separator(page);
    if (!handle) throw new Error("The split went away");
    await page.mouse.click(handle.x, handle.y, { count: 2 });
    await pause(250);
    assert.equal(
      (await outline(page))[1],
      unchanged,
      "a double-click makes the columns equal",
    );

    // No split on paper, on a phone where the columns stack, or read-only.
    await page.emulateMediaType("print");
    [handle] = await separator(page);
    assert(!handle || handle.display === "none", "no split prints");
    await page.emulateMediaType("screen");
    await page.setViewport({ width: 390, height: 844 });
    await pause(400);
    assert.equal(
      (await separator(page)).length,
      0,
      "stacked columns have no split",
    );
    await page.setViewport({ width: 1280, height: 900 });
    await pause(400);
    await page.evaluate((selector) => {
      const root = document.querySelector<
        HTMLElement & { __lexicalEditor?: { setEditable(on: boolean): void } }
      >(selector);
      root?.__lexicalEditor?.setEditable(false);
    }, '[data-lexical-editor="true"]');
    await pause(400);
    assert.equal(
      (await separator(page)).length,
      0,
      "read-only columns have no split",
    );
  } finally {
    await devCli(appUrl)("doc", "delete", id);
  }
}

/** Where the row, its columns, their first and last blocks and the blocks
 * around the row are, and whether each column's frame shows. */
async function layout(page: Page) {
  return page.evaluate((selector) => {
    const root = document.querySelector<HTMLElement>(selector);
    const row = root?.querySelector<HTMLElement>(
      "[data-lexical-layout-container]",
    );
    if (!root || !row) throw new Error("No columns");
    const box = (element: Element | null | undefined) => {
      const rect = element?.getBoundingClientRect();
      return {
        top: rect?.top ?? 0,
        bottom: rect?.bottom ?? 0,
        left: rect?.left ?? 0,
        right: rect?.right ?? 0,
      };
    };
    const paragraph = [...root.children].find(
      (block) => block.textContent === "Before",
    );
    return {
      text: box(paragraph),
      row: box(row),
      above: box(row.previousElementSibling),
      aboveThat: box(row.previousElementSibling?.previousElementSibling),
      below: box(row.nextElementSibling),
      columns: [...row.children].map((column) => ({
        ...box(column),
        first: box(column.firstElementChild),
        last: box(column.lastElementChild),
        framed: !/rgba\(\d+, \d+, \d+, 0\)|transparent/.test(
          getComputedStyle(column).borderTopColor,
        ),
      })),
    };
  }, EDITOR);
}

/**
 * Columns sit in the text column as Notion's do: the first column's text in
 * line with a paragraph's start and the last's with its end, a column's
 * blocks evenly inset with the first column's heading level with the next
 * column's first line, the text spaced from a toggle before and a paragraph
 * after as any block's is, and the frames, which stand out into the margin,
 * shown only while the row is hovered or selected in.
 */
export async function checkColumnLayout(page: Page) {
  const id = await createDocument(
    "Visual suite · column layout",
    COLUMN_LAYOUT_MARKDOWN,
  );
  try {
    await signInToDev(page, appUrl);
    await page.setViewport({ width: 1280, height: 900 });
    await page.emulateMediaType("screen");
    await page.goto(`${appUrl}/documents/${id}`, {
      waitUntil: "networkidle2",
    });
    await page.waitForSelector(`${EDITOR} [data-lexical-layout-container]`);
    await pause(800);
    await page.mouse.move(1, 1);
    await caret(page, "Before", 0);
    const rest = await layout(page);
    const near = (a: number, b: number) => Math.abs(a - b) <= 1;

    const [left, right] = rest.columns;
    if (!left || !right) throw new Error("Two columns expected");
    assert(
      near(left.first.left, rest.text.left) &&
        near(right.first.right, rest.text.right),
      `the columns' text is in line with the text column: ${left.first.left}..${right.first.right} in ${rest.text.left}..${rest.text.right}`,
    );
    assert(
      near(left.first.top, right.first.top),
      `a heading starting a column is level with the next column: ${left.first.top} and ${right.first.top}`,
    );
    const inset = left.first.top - left.top;
    assert(
      near(left.bottom - left.last.bottom, inset) &&
        near(left.first.left - left.left, inset),
      `a column's blocks are inset evenly: top ${inset}, left ${left.first.left - left.left}, bottom ${left.bottom - left.last.bottom}`,
    );
    assert(inset >= 8, `a column's text keeps clear of its frame: ${inset}`);
    const blockGap = rest.above.top - rest.aboveThat.bottom;
    const gapBefore = left.first.top - rest.above.bottom;
    const gapAfter = rest.below.top - (rest.row.bottom - inset);
    assert(
      near(gapBefore, blockGap) && near(gapAfter, blockGap),
      `columns' text is spaced from a toggle before and a paragraph after as blocks are, ${blockGap}: ${gapBefore} and ${gapAfter}`,
    );
    assert(
      rest.columns.every((column) => !column.framed),
      "no frame shows at rest",
    );

    await page.mouse.move((right.left + right.right) / 2, right.first.top + 2);
    await pause(250);
    assert(
      (await layout(page)).columns.every((column) => column.framed),
      "hovering a row of columns frames its columns",
    );
    await page.mouse.move(1, 1);
    await caret(page, "Right one", 2);
    assert(
      (await layout(page)).columns.every((column) => column.framed),
      "a selection in a row of columns frames its columns",
    );
    await caret(page, "After", 0);
    assert(
      (await layout(page)).columns.every((column) => !column.framed),
      "the frames go once the selection leaves",
    );
  } finally {
    await devCli(appUrl)("doc", "delete", id);
  }
}

if (import.meta.main) {
  const { default: puppeteer } = await import("puppeteer");
  const browser = await puppeteer.launch({ headless: true });
  try {
    await checkColumnLayout(await browser.newPage());
    console.log("column layout: ok");
    await checkColumns(await browser.newPage());
    console.log("columns: ok");
  } finally {
    await browser.close();
  }
}
